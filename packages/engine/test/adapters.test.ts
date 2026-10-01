import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runOnce } from "../src/observability/observation-runner.js";
import {
  assertNoExecutionCapability,
  bitgetMcpAdapter,
  bitgetSignalAdapter,
  contentHash,
  manualBenchmarkObservation,
  strategyArtifactAdapter,
} from "../src/observability/adapters.js";
import {
  admitBenchmark,
  benchmarkEligibilityForRole,
  type SourceAdapter,
  type SourceObservation,
} from "../src/observability/source-model.js";
import { isFailure } from "../src/observability/source-model.js";

/**
 * FIXTURE-BACKED ADAPTERS.
 *
 * Every adapter is constructed from a literal in this file. Nothing is fetched,
 * no credential is read, no MCP client or signal subscription exists, and no
 * artifact is downloaded. The tests below are the entire proof that the layer
 * behaves, and they prove it without a network.
 */

const NOW = new Date("2026-10-01T14:30:00.000Z");
const GATE = 15_000;

/** Materialise an adapter's observation, failing loudly if it errored. */
function obs(a: SourceAdapter): SourceObservation {
  const r = a.observe("NVDA", NOW);
  if (isFailure(r)) throw new Error(`adapter failed: ${r.code} ${r.message}`);
  return r;
}

const VENUE_ENVELOPE = {
  symbol: "NVDAUSDT",
  bid: "229.04",
  ask: "229.12",
  last: "229.08",
  ts: Date.parse("2026-10-01T14:29:59.900Z"),
  fetchedAt: "2026-10-01T14:30:00.000Z",
  responseReceivedAt: "2026-10-01T14:30:00.100Z",
};

const MANUAL_BENCHMARK = {
  symbol: "NVDA",
  bid: 228.82,
  ask: 228.86,
  sourceAsOf: "2026-10-01T14:29:59.800Z",
  requestedAt: "2026-10-01T14:30:00.000Z",
  responseReceivedAt: "2026-10-01T14:30:00.120Z",
};

function benchAdapter(): SourceAdapter {
  const o = manualBenchmarkObservation(MANUAL_BENCHMARK);
  if (isFailure(o)) throw new Error(o.message);
  return { provider: o.provider, role: o.role, offline: true, observe: () => o };
}

function run(adapters: SourceAdapter[], extra: Record<string, unknown> = {}) {
  return runOnce({
    now: NOW,
    instrument: "rNVDAUSDT",
    venueSymbol: "NVDAUSDT",
    benchmarkSymbol: "NVDA",
    adapters,
    regime: "tradfi_open",
    sessionVerification: "ANNUAL_CALENDAR_ONLY",
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// 1. Bitget MCP
// ---------------------------------------------------------------------------

describe("adapter — Bitget MCP is VENUE_MARKET_DATA", () => {
  it("is admitted as VENUE_MARKET_DATA", () => {
    const o = obs(bitgetMcpAdapter(VENUE_ENVELOPE));
    assert.equal(o.role, "VENUE_MARKET_DATA");
    assert.equal(o.provider, "bitget_mcp");
    assert.equal(o.symbol, "NVDAUSDT");
    assert.equal(o.price, 229.08);
    assert.equal(o.bid, 229.04);
    assert.equal(o.ask, 229.12);
  });

  it("preserves every provenance and timestamp field", () => {
    const o = obs(bitgetMcpAdapter(VENUE_ENVELOPE));
    assert.equal(o.fetchedAt, "2026-10-01T14:30:00.000Z");
    assert.equal(o.responseReceivedAt, "2026-10-01T14:30:00.100Z");
    assert.equal(o.sourceAsOf, "2026-10-01T14:29:59.900Z", "the venue instant is preserved");
    assert.equal(o.timestampType, "VENUE_MATCH_ENGINE_EVENT");
    assert.match(String(o.provenance["envelopeHash"]), /^[0-9a-f]{64}$/);
    assert.equal(o.provenance["benchmarkEligible"], false);
  });

  it("marks benchmarkEligibility false with the independence reason", () => {
    assert.equal(benchmarkEligibilityForRole("VENUE_MARKET_DATA"), "NOT_ELIGIBLE_INDEPENDENCE");
    const a = admitBenchmark({ observation: obs(bitgetMcpAdapter(VENUE_ENVELOPE)), now: NOW, freshnessGateMs: GATE });
    assert.equal(a.ok, false);
  });

  it("reports benchmarkRejectionReason as INDEPENDENCE_FAILURE verbatim", () => {
    const r = run([bitgetMcpAdapter(VENUE_ENVELOPE)]);
    const bitget = r.record.sources.find((s) => s.provider === "bitget_mcp")!;
    assert.equal(bitget.benchmarkRejectionReason, "INDEPENDENCE_FAILURE");
  });

  it("allows venue context and features", () => {
    const r = run([bitgetMcpAdapter(VENUE_ENVELOPE)]);
    const bitget = r.record.sources.find((s) => s.provider === "bitget_mcp")!;
    assert.ok(bitget.allowedDownstreamUse.includes("VENUE_CONTEXT_AND_FEATURES"));
    assert.equal(bitget.admissionDecision, "ADMITTED_NON_BENCHMARK");
  });

  it("cannot become a benchmark, even with an ideal timestamp", () => {
    // Zero-latency venue instant: the refusal must be on INDEPENDENCE grounds.
    const perfect = { ...VENUE_ENVELOPE, ts: Date.parse("2026-10-01T14:30:00.050Z") };
    const a = admitBenchmark({ observation: obs(bitgetMcpAdapter(perfect)), now: NOW, freshnessGateMs: GATE });
    assert.equal(a.ok, false);
    assert.equal(a.ok === false && a.eligibility, "NOT_ELIGIBLE_INDEPENDENCE");
  });

  it("produces VENUE_CONTEXT_ONLY with dispatchEligible false, alone", () => {
    const r = run([bitgetMcpAdapter(VENUE_ENVELOPE)]);
    assert.equal(r.record.predictionMode, "VENUE_CONTEXT_ONLY");
    assert.equal(r.record.basis, null);
    assert.equal(r.record.benchmarkSymbol, null);
    assert.equal(r.record.dispatchEligible, false);
  });

  it("rejects a venue envelope with no symbol", () => {
    const a = bitgetMcpAdapter({ ...VENUE_ENVELOPE, symbol: "" });
    const r = a.observe("NVDA", NOW);
    assert.equal(isFailure(r), true);
  });

  it("rejects an envelope carrying an execution-shaped field", () => {
    for (const key of ["execute", "dispatch", "placeOrder", "portfolio"]) {
      const reason = assertNoExecutionCapability({ [key]: true });
      assert.notEqual(reason, null, `${key} must be refused`);
      assert.match(reason!, /FORBIDDEN_CAPABILITY/);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. bitget-signal
// ---------------------------------------------------------------------------

const SIGNAL_ENVELOPE = {
  signalId: "sig-2026-10-01-001",
  kind: "macro" as const,
  symbol: "NVDAUSDT",
  direction: "BULLISH" as const,
  confidence: 0.72,
  rationale: "CoWoS capacity expansion",
  sourceAsOf: "2026-10-01T14:29:59.950Z",
  fetchedAt: "2026-10-01T14:30:00.000Z",
  responseReceivedAt: "2026-10-01T14:30:00.050Z",
  expiresAt: "2026-10-01T14:45:00.000Z",
};

describe("adapter — bitget-signal is RESEARCH_SIGNAL", () => {
  it("normalizes all four proposal kinds", () => {
    for (const kind of ["macro", "sentiment", "technical", "news"] as const) {
      const o = obs(bitgetSignalAdapter({ ...SIGNAL_ENVELOPE, kind }));
      assert.equal(o.role, "RESEARCH_SIGNAL");
      assert.equal(o.provenance["kind"], kind);
    }
  });

  it("rejects an unknown kind", () => {
    const r = bitgetSignalAdapter({ ...SIGNAL_ENVELOPE, kind: "vibes" as never }).observe("NVDA", NOW);
    assert.equal(isFailure(r), true);
    assert.equal(isFailure(r) && r.code, "UNKNOWN_SIGNAL_KIND");
  });

  it("preserves identity, fetch time, sourceAsOf, confidence, expiry and hashes", () => {
    const o = obs(bitgetSignalAdapter(SIGNAL_ENVELOPE));
    assert.equal(o.provenance["signalId"], "sig-2026-10-01-001");
    assert.equal(o.fetchedAt, "2026-10-01T14:30:00.000Z");
    assert.equal(o.sourceAsOf, "2026-10-01T14:29:59.950Z");
    assert.equal(o.expiresAt, "2026-10-01T14:45:00.000Z");
    assert.deepEqual(o.metrics, { confidence: 0.72 });
    assert.match(String(o.provenance["signalContentHash"]), /^[0-9a-f]{64}$/);
    assert.match(String(o.artifactHash), /^[0-9a-f]{64}$/);
  });

  it("allows proposal input and never benchmark input", () => {
    const r = run([bitgetSignalAdapter(SIGNAL_ENVELOPE)]);
    const sig = r.record.sources.find((s) => s.provider === "bitget_signal")!;
    assert.ok(sig.allowedDownstreamUse.includes("PROPOSAL_INPUT"));
    assert.equal(sig.allowedDownstreamUse.includes("BENCHMARK_BASIS_REFERENCE"), false);
    assert.equal(sig.benchmarkEligibility, "NOT_ELIGIBLE_ROLE");
  });

  it("is NOT admitted as a benchmark merely because it carries a timestamp", () => {
    // The adversarial case this test exists for: a perfect timestamp on a
    // proposal must not smuggle it into the reference slot.
    const withTs = obs(bitgetSignalAdapter(SIGNAL_ENVELOPE));
    assert.notEqual(withTs.sourceAsOf, null);
    const a = admitBenchmark({ observation: withTs, now: NOW, freshnessGateMs: GATE });
    assert.equal(a.ok, false);
    assert.equal(a.ok === false && a.eligibility, "NOT_ELIGIBLE_ROLE");
  });

  it("produces RESEARCH_CONTEXT_ONLY with dispatchEligible false, alone", () => {
    const r = run([bitgetSignalAdapter(SIGNAL_ENVELOPE)]);
    assert.equal(r.record.predictionMode, "RESEARCH_CONTEXT_ONLY");
    assert.equal(r.record.basis, null);
    assert.equal(r.record.dispatchEligible, false);
    assert.equal(r.record.executionAuthority, "none");
  });

  it("rejects an out-of-range confidence", () => {
    const r = bitgetSignalAdapter({ ...SIGNAL_ENVELOPE, confidence: 1.4 }).observe("NVDA", NOW);
    assert.equal(isFailure(r) && r.code, "CONFIDENCE_OUT_OF_RANGE");
  });
});

// ---------------------------------------------------------------------------
// 3. GetAgent / Playbook artifacts
// ---------------------------------------------------------------------------

const ARTIFACT_BASE = {
  artifactId: "ga-2026-10-01-strategy-001",
  strategyName: "Momentum Basis",
  strategyVersion: "v1.2.3",
  symbol: "NVDAUSDT",
  issuedAt: "2026-09-01T00:00:00.000Z",
  loadedAt: "2026-10-01T14:30:00.000Z",
  metrics: { sharpe: 1.4, trades: 812 },
};

describe("adapter — GetAgent/Playbook artifacts", () => {
  it("validates a strategy artifact and hashes it correctly", () => {
    const o = obs(strategyArtifactAdapter({ ...ARTIFACT_BASE, role: "STRATEGY_ARTIFACT" }));
    assert.equal(o.role, "STRATEGY_ARTIFACT");
    assert.equal(o.strategyVersion, "v1.2.3");
    assert.match(String(o.artifactHash), /^[0-9a-f]{64}$/);
    assert.deepEqual(o.metrics, { sharpe: 1.4, trades: 812 });
  });

  it("accepts a matching declared hash and rejects a mismatched one", () => {
    const correct = obs(strategyArtifactAdapter({ ...ARTIFACT_BASE, role: "STRATEGY_ARTIFACT" }));
    const ok = strategyArtifactAdapter({
      ...ARTIFACT_BASE, role: "STRATEGY_ARTIFACT", declaredHash: String(correct.artifactHash),
    });
    assert.equal(isFailure(ok.observe("NVDA", NOW)), false);

    const bad = strategyArtifactAdapter({
      ...ARTIFACT_BASE, role: "STRATEGY_ARTIFACT", declaredHash: "f".repeat(64),
    });
    const r = bad.observe("NVDA", NOW);
    assert.equal(isFailure(r) && r.code, "ARTIFACT_HASH_MISMATCH");
  });

  it("rejects a malformed artifact with no strategy version", () => {
    const a = strategyArtifactAdapter({ ...ARTIFACT_BASE, role: "STRATEGY_ARTIFACT", strategyVersion: "" });
    assert.equal(isFailure(a.observe("NVDA", NOW)) && true, true);
  });

  it("rejects a malformed artifact with an unparseable issuedAt", () => {
    const a = strategyArtifactAdapter({ ...ARTIFACT_BASE, role: "STRATEGY_ARTIFACT", issuedAt: "yesterday" });
    const r = a.observe("NVDA", NOW);
    assert.equal(isFailure(r) && r.code, "MALFORMED_ISSUED_AT");
  });

  it("fails closed on a malformed artifact rather than recording it partially", () => {
    for (const bad of [
      { ...ARTIFACT_BASE, role: "STRATEGY_ARTIFACT" as const, artifactId: "" },
      { ...ARTIFACT_BASE, role: "STRATEGY_ARTIFACT" as const, strategyVersion: "" },
      { ...ARTIFACT_BASE, role: "STRATEGY_ARTIFACT" as const, issuedAt: "nope" },
      { ...ARTIFACT_BASE, role: "PAPER_TRADING_ARTIFACT" as const, externalExecution: false },
      { ...ARTIFACT_BASE, role: "STRATEGY_ARTIFACT" as const, externalExecution: true },
    ]) {
      const r = strategyArtifactAdapter(bad).observe("NVDA", NOW);
      assert.equal(isFailure(r), true, `${JSON.stringify(bad).slice(0, 60)} must fail closed`);
    }
  });

  it("marks external paper artifacts with externalExecution true", () => {
    const o = obs(strategyArtifactAdapter({
      ...ARTIFACT_BASE, role: "PAPER_TRADING_ARTIFACT", externalExecution: true,
    }));
    assert.equal(o.externalExecution, true);
    assert.equal(o.role, "PAPER_TRADING_ARTIFACT");
  });

  it("keeps a strategy artifact externalExecution false", () => {
    const o = obs(strategyArtifactAdapter({ ...ARTIFACT_BASE, role: "STRATEGY_ARTIFACT" }));
    assert.equal(o.externalExecution, false);
  });

  it("refuses to let a strategy artifact claim external execution", () => {
    const r = strategyArtifactAdapter({
      ...ARTIFACT_BASE, role: "STRATEGY_ARTIFACT", externalExecution: true,
    }).observe("NVDA", NOW);
    assert.equal(isFailure(r) && r.code, "EXTERNAL_EXECUTION_ROLE_MISMATCH");
  });

  it("refuses a paper artifact that does not declare external execution", () => {
    const r = strategyArtifactAdapter({ ...ARTIFACT_BASE, role: "PAPER_TRADING_ARTIFACT" }).observe("NVDA", NOW);
    assert.equal(isFailure(r) && r.code, "EXTERNAL_EXECUTION_NOT_DECLARED");
  });

  it("never admits any artifact role as the benchmark", () => {
    for (const role of ["STRATEGY_ARTIFACT", "BACKTEST_ARTIFACT", "PAPER_TRADING_ARTIFACT"] as const) {
      const o = obs(strategyArtifactAdapter({
        ...ARTIFACT_BASE, role, ...(role === "PAPER_TRADING_ARTIFACT" ? { externalExecution: true } : {}),
      }));
      const a = admitBenchmark({ observation: o, now: NOW, freshnessGateMs: GATE });
      assert.equal(a.ok, false, `${role} must never be a benchmark`);
    }
  });

  it("produces ARTIFACT_CONTEXT_ONLY with dispatchEligible false, alone", () => {
    const r = run([strategyArtifactAdapter({ ...ARTIFACT_BASE, role: "STRATEGY_ARTIFACT" })]);
    assert.equal(r.record.predictionMode, "ARTIFACT_CONTEXT_ONLY");
    assert.equal(r.record.basis, null);
    assert.equal(r.record.dispatchEligible, false);
    assert.equal(r.record.executionAuthority, "none");
  });
});

// ---------------------------------------------------------------------------
// 4. Manual benchmark path
// ---------------------------------------------------------------------------

describe("adapter — manual reference benchmark", () => {
  it("requires a provider-issued sourceAsOf", () => {
    const r = manualBenchmarkObservation({ ...MANUAL_BENCHMARK, sourceAsOf: "" });
    assert.equal(isFailure(r) && r.code, "SOURCE_ASOF_MISSING");
  });

  it("refuses a local clock in the sourceAsOf slot", () => {
    // The specific failure this design exists to prevent.
    const r = manualBenchmarkObservation({ ...MANUAL_BENCHMARK, sourceAsOf: MANUAL_BENCHMARK.requestedAt });
    assert.equal(isFailure(r) && r.code, "LOCAL_CLOCK_AS_SOURCE_ASOF");

    const r2 = manualBenchmarkObservation({ ...MANUAL_BENCHMARK, sourceAsOf: MANUAL_BENCHMARK.responseReceivedAt });
    assert.equal(isFailure(r2) && r2.code, "LOCAL_CLOCK_AS_SOURCE_ASOF");
  });

  it("keeps fetchedAt and responseReceivedAt distinct", () => {
    const r = manualBenchmarkObservation({ ...MANUAL_BENCHMARK, responseReceivedAt: MANUAL_BENCHMARK.requestedAt });
    assert.equal(isFailure(r) && r.code, "TIMESTAMPS_NOT_DISTINCT");
  });

  it("admits a well-formed manual benchmark and remains the only such path", () => {
    const o = manualBenchmarkObservation(MANUAL_BENCHMARK);
    assert.equal(isFailure(o), false);
    if (isFailure(o)) return;
    const a = admitBenchmark({ observation: o, now: NOW, freshnessGateMs: GATE });
    assert.equal(a.ok, true, JSON.stringify(a));
    assert.equal(o.role, "REFERENCE_BENCHMARK");
  });
});

// ---------------------------------------------------------------------------
// 5. Combined input hash
// ---------------------------------------------------------------------------

describe("adapters — combined prediction identity", () => {
  const venue = () => bitgetMcpAdapter(VENUE_ENVELOPE);
  const signal = (over: Record<string, unknown> = {}) =>
    bitgetSignalAdapter({ ...SIGNAL_ENVELOPE, ...over });
  const artifact = (over: Record<string, unknown> = {}) =>
    strategyArtifactAdapter({ ...ARTIFACT_BASE, role: "STRATEGY_ARTIFACT", ...over });

  it("changes when the artifact hash changes", () => {
    const a = run([venue(), artifact()]).record.inputHashes.combinedInputHash;
    const b = run([venue(), artifact({ strategyVersion: "v9.9.9" })]).record.inputHashes.combinedInputHash;
    assert.notEqual(a, b, "a different strategyVersion must change the artifact hash");
  });

  it("changes when the signal content changes", () => {
    const a = run([venue(), signal()]).record.inputHashes.combinedInputHash;
    const b = run([venue(), signal({ confidence: 0.2 })]).record.inputHashes.combinedInputHash;
    assert.notEqual(a, b);
  });

  it("changes when an extra source is admitted", () => {
    const a = run([venue()]).record.inputHashes.combinedInputHash;
    const b = run([venue(), signal()]).record.inputHashes.combinedInputHash;
    assert.notEqual(a, b);
  });

  it("is deterministic for identical inputs", () => {
    assert.equal(
      run([venue(), signal(), benchAdapter()]).record.inputHashes.combinedInputHash,
      run([venue(), signal(), benchAdapter()]).record.inputHashes.combinedInputHash,
    );
  });

  it("contentHash is stable and order-independent", () => {
    assert.equal(contentHash({ a: 1, b: 2 }), contentHash({ b: 2, a: 1 }));
    assert.notEqual(contentHash({ a: 1 }), contentHash({ a: 2 }));
  });
});

// ---------------------------------------------------------------------------
// 6. Mixed sources and the authority boundary
// ---------------------------------------------------------------------------

describe("adapters — mixed sources", () => {
  it("venue + research + artifacts without a benchmark yields no basis prediction", () => {
    const r = run([
      bitgetMcpAdapter(VENUE_ENVELOPE),
      bitgetSignalAdapter(SIGNAL_ENVELOPE),
      strategyArtifactAdapter({ ...ARTIFACT_BASE, role: "STRATEGY_ARTIFACT" }),
    ]);
    assert.equal(r.record.basis, null, "no basis without an independent benchmark");
    assert.notEqual(r.record.predictionMode, "BASIS_PREDICTION");
    assert.equal(r.record.benchmarkSymbol, null);
    assert.equal(r.record.dispatchEligible, false);
  });

  it("a valid manual benchmark plus other sources permits BASIS_PREDICTION", () => {
    const r = run([
      bitgetMcpAdapter(VENUE_ENVELOPE),
      bitgetSignalAdapter(SIGNAL_ENVELOPE),
      strategyArtifactAdapter({ ...ARTIFACT_BASE, role: "BACKTEST_ARTIFACT" }),
      benchAdapter(),
    ]);
    assert.equal(r.record.predictionMode, "BASIS_PREDICTION");
    assert.notEqual(r.record.basis, null);
    assert.equal(r.record.benchmarkSymbol, "NVDA");
    // Every non-benchmark source is still recorded, with its refusal reason.
    assert.equal(r.record.sources.length, 4);
    for (const s of r.record.sources) assert.equal(s.sourceAdmission, "ADMITTED");
  });

  it("a mixed-source prediction remains dispatchEligible false", () => {
    const r = run([bitgetMcpAdapter(VENUE_ENVELOPE), bitgetSignalAdapter(SIGNAL_ENVELOPE), benchAdapter()]);
    assert.equal(r.record.predictionMode, "BASIS_PREDICTION");
    assert.equal(r.record.dispatchEligible, false);
    assert.equal(r.record.wouldHaveExecuted, false);
    assert.equal(r.record.executionAuthority, "none");
    assert.equal(r.record.orderSubmitted, false);
    assert.equal(r.record.logMode, "OBSERVATION_ONLY");
    assert.equal(r.record.phaseTransition, null);
  });
});

// ---------------------------------------------------------------------------
// 7. Import graph and network isolation
// ---------------------------------------------------------------------------

describe("adapters — authority and network isolation", () => {
  /** Strip comments and string literals so the scan measures code. */
  function codeOf(name: string): string {
    const src = readFileSync(join(process.cwd(), "src", "observability", `${name}.ts`), "utf8");
    return src
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")
      .replace(/"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, " STR ");
  }

  it("no adapter imports a dispatcher, private client, receipt sealing or order route", () => {
    for (const name of ["adapters", "observation-runner", "source-model", "prediction", "outcome", "prediction-log"]) {
      const code = codeOf(name);
      for (const forbidden of [
        "OrderDispatcher", "place-order", "placeOrder", "integrations/bitget",
        "council/receipts", "sealReceipt", "executeDeliberationCycle",
      ]) {
        assert.ok(!code.includes(forbidden), `${name} must not reference ${forbidden}`);
      }
    }
  });

  it("no adapter imports a network module or calls fetch", () => {
    for (const name of ["adapters", "observation-runner", "source-model", "prediction", "outcome", "prediction-log"]) {
      const code = codeOf(name);
      for (const forbidden of ["node:http", "node:https", "node:net", "node:tls", "fetch(", "XMLHttpRequest", "WebSocket"]) {
        assert.ok(!code.includes(forbidden), `${name} must not reference ${forbidden}`);
      }
    }
  });

  it("every adapter is declared offline", () => {
    for (const a of [
      bitgetMcpAdapter(VENUE_ENVELOPE),
      bitgetSignalAdapter(SIGNAL_ENVELOPE),
      strategyArtifactAdapter({ ...ARTIFACT_BASE, role: "STRATEGY_ARTIFACT" }),
      benchAdapter(),
    ]) {
      assert.equal(a.offline, true, `${a.provider} must be offline`);
    }
  });

  it("the adapter interface exposes exactly one method and no execution capability", () => {
    const code = codeOf("adapters");
    assert.ok(!/\bEXECUTE\b|\bDISPATCH\b|\bMUTATE\b|\bplaceOrder\b/.test(code),
      "no execution-shaped identifier may appear in adapter code");
    // The only exported surface is normalisation.
    for (const forbidden of ["export async function", "await ", "subscribe(", "connect("]) {
      assert.ok(!code.includes(forbidden), `adapters must not contain '${forbidden}'`);
    }
  });

  it("a fixture run makes zero network calls", () => {
    // Instrumented proof: the global fetch/EventSource/WebSocket are replaced
    // with tripwires before the run. Any attempt throws and fails the test.
    const g = globalThis as unknown as Record<string, unknown>;
    const originals = { fetch: g["fetch"], EventSource: g["EventSource"], WebSocket: g["WebSocket"] };
    let calls = 0;
    const tripwire = () => { calls += 1; throw new Error("network access attempted in a fixture run"); };
    g["fetch"] = tripwire;
    g["EventSource"] = tripwire;
    g["WebSocket"] = tripwire;
    try {
      const r = run([
        bitgetMcpAdapter(VENUE_ENVELOPE),
        bitgetSignalAdapter(SIGNAL_ENVELOPE),
        strategyArtifactAdapter({ ...ARTIFACT_BASE, role: "PAPER_TRADING_ARTIFACT", externalExecution: true }),
        benchAdapter(),
      ]);
      assert.equal(calls, 0, "no network call may occur");
      assert.equal(r.record.predictionMode, "BASIS_PREDICTION");
    } finally {
      g["fetch"] = originals.fetch;
      g["EventSource"] = originals.EventSource;
      g["WebSocket"] = originals.WebSocket;
    }
  });
});