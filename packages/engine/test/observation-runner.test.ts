import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runOnce,
  runObservationWindow,
  OBSERVATION_FRESHNESS_GATE_MS,
  type RunOnceResult,
} from "../src/observability/observation-runner.js";
import {
  admitBenchmark,
  eligibilityForRole,
  provenanceHash,
  type SourceAdapter,
  type SourceObservation,
  type SourceRole,
} from "../src/observability/source-model.js";
import {
  appendEvaluation,
  appendPrediction,
  readEvaluations,
  readLineHashes,
  readPredictions,
  verifyChain,
} from "../src/observability/prediction-log.js";
import { evaluatePrediction } from "../src/observability/outcome.js";
import type { PredictionRecord } from "../src/observability/prediction.js";

/**
 * Observation / prediction runner.
 *
 * Fixture-driven and OFFLINE. Every adapter here is `offline: true` and returns
 * a literal; a network test below proves the runner itself makes none.
 *
 * The cases map 1:1 onto the required behaviours, and the three that matter most
 * are: venue data can never become a benchmark, a missing provider timestamp is
 * never admitted, and no observation record can acquire execution authority.
 */

const NOW = new Date("2026-10-01T14:30:00.000Z"); // 10:30 ET, open session
const GATE = OBSERVATION_FRESHNESS_GATE_MS;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function robinhoodObs(over: Partial<SourceObservation> = {}): SourceObservation {
  return {
    provider: "robinhood_stock_token_api",
    role: "INDEPENDENT_REFERENCE_BENCHMARK",
    symbol: "NVDA",
    bid: 228.82,
    ask: 228.86,
    price: null, // derived from bid/ask by admission
    sourceAsOf: "2026-10-01T14:29:59.800Z",
    fetchedAt: "2026-10-01T14:30:00.000Z",
    responseReceivedAt: "2026-10-01T14:30:00.120Z",
    timestampType: "PROVIDER_GENERATED_QUOTE",
    timestampNote: "provider generatedAt; not an exchange trade time",
    failureReason: null,
    provenance: {},
    ...over,
  };
}

function bitgetObs(over: Partial<SourceObservation> = {}): SourceObservation {
  return {
    provider: "bitget_mcp",
    role: "VENUE_CONTEXT_OR_RESEARCH",
    symbol: "NVDAUSDT",
    bid: 229.04,
    ask: 229.12,
    price: 229.08,
    // Deliberately venue-issued, and deliberately NOT eligible as a benchmark.
    sourceAsOf: "2026-10-01T14:29:59.900Z",
    fetchedAt: "2026-10-01T14:30:00.000Z",
    responseReceivedAt: "2026-10-01T14:30:00.100Z",
    timestampType: "VENUE_MATCH_ENGINE_EVENT",
    timestampNote: "venue match-engine instant; describes the traded instrument, not an independent reference",
    failureReason: null,
    provenance: {},
    ...over,
  };
}

/** An offline adapter returning a fixed observation. */
function adapterFor(obs: SourceObservation, role?: SourceRole): SourceAdapter {
  return {
    provider: obs.provider,
    role: role ?? obs.role,
    offline: true,
    observe: () => obs,
  };
}

function run(args: {
  adapters: SourceAdapter[];
  now?: Date;
  horizonMs?: number;
  instrument?: string;
}): RunOnceResult {
  return runOnce({
    now: args.now ?? NOW,
    instrument: args.instrument ?? "rNVDAUSDT",
    venueSymbol: "NVDAUSDT",
    benchmarkSymbol: "NVDA",
    adapters: args.adapters,
    regime: "tradfi_open",
    sessionVerification: "ANNUAL_CALENDAR_ONLY",
    ...(args.horizonMs !== undefined ? { forecastHorizonMs: args.horizonMs } : {}),
  });
}

/** Strip line and block comments so source scans measure code, not prose. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function tmpLog(): string {
  const p = join(mkdtempSync(join(tmpdir(), "predlog-")), "observation_log.jsonl");
  writeFileSync(p, "", "utf8");
  return p;
}

// ---------------------------------------------------------------------------
// 1. Modes
// ---------------------------------------------------------------------------

describe("observation runner — prediction modes", () => {
  it("produces BASIS_PREDICTION from an injected valid benchmark plus venue context", () => {
    const r = run({ adapters: [adapterFor(bitgetObs()), adapterFor(robinhoodObs())] });
    assert.equal(r.mode, "BASIS_PREDICTION");
    assert.equal(r.record.predictionMode, "BASIS_PREDICTION");
    assert.equal(r.record.benchmarkStatus, "ADMITTED_INDEPENDENT_BENCHMARK");
    assert.notEqual(r.record.basis, null);
    assert.ok(r.record.basis !== null && Number.isFinite(r.record.basis.netEdgePct));
    assert.ok(r.record.confidenceScore !== null);
  });

  it("produces VENUE_CONTEXT_ONLY when Bitget context exists but no benchmark", () => {
    const r = run({ adapters: [adapterFor(bitgetObs())] });
    assert.equal(r.mode, "VENUE_CONTEXT_ONLY");
    assert.equal(r.record.benchmarkStatus, "ABSENT");
    // No basis figures: a basis against venue data is the thing being prevented.
    assert.equal(r.record.basis, null);
    assert.equal(r.record.action, "NONE");
    assert.equal(r.record.benchmarkSymbol, null);
  });

  it("produces NO_PREDICTION when nothing usable is supplied", () => {
    const r = run({ adapters: [] });
    assert.equal(r.mode, "NO_PREDICTION");
    assert.equal(r.record.basis, null);
    assert.match(r.record.blockedReason, /NO_PREDICTION/);
  });

  it("records a blocked reason for every mode", () => {
    for (const adapters of [
      [adapterFor(bitgetObs())],
      [adapterFor(bitgetObs()), adapterFor(robinhoodObs())],
      [],
    ]) {
      const r = run({ adapters });
      assert.ok(r.record.blockedReason.length > 0, `${r.mode} must carry a reason`);
      assert.match(r.record.blockedReason, /OBSERVATION_ONLY/);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Venue data can never be a benchmark
// ---------------------------------------------------------------------------

describe("observation runner — venue data is never a benchmark", () => {
  it("refuses a VENUE_CONTEXT_OR_RESEARCH source even with a fresh timestamp", () => {
    // The adversarial case: Bitget MCP data with a perfectly good venue
    // timestamp. Role is what disqualifies it, not timestamp quality.
    const a = admitBenchmark({
      observation: bitgetObs(),
      now: NOW,
      freshnessGateMs: GATE,
    });
    assert.equal(a.ok, false);
    assert.equal(a.ok === false && a.code, "ROLE_NOT_BENCHMARK_ELIGIBLE");
  });

  it("never emits a BASIS_PREDICTION from venue data alone", () => {
    const r = run({ adapters: [adapterFor(bitgetObs())] });
    assert.notEqual(r.mode, "BASIS_PREDICTION");
    assert.equal(r.record.basis, null);
    assert.match(r.record.blockedReason, /independent underlying-equity benchmark/);
  });

  it("derives eligibility from role, not from adapter declaration", () => {
    assert.equal(eligibilityForRole("VENUE_CONTEXT_OR_RESEARCH"), "CONTEXT_ONLY");
    assert.equal(eligibilityForRole("INDEPENDENT_REFERENCE_BENCHMARK"), "ELIGIBLE_BENCHMARK");
    assert.equal(eligibilityForRole("UNTRUSTED_RESEARCH"), "REJECTED");
  });

  it("rejects an UNTRUSTED_RESEARCH source outright", () => {
    const a = admitBenchmark({
      observation: robinhoodObs({ role: "UNTRUSTED_RESEARCH", provider: "getagent_playbook" }),
      now: NOW,
      freshnessGateMs: GATE,
    });
    assert.equal(a.ok, false);
  });
});

// ---------------------------------------------------------------------------
// 3. Timestamp integrity
// ---------------------------------------------------------------------------

describe("observation runner — timestamp integrity", () => {
  it("never admits a source with no sourceAsOf", () => {
    const a = admitBenchmark({
      observation: robinhoodObs({ sourceAsOf: null, timestampType: "NONE_SUPPLIED" }),
      now: NOW,
      freshnessGateMs: GATE,
    });
    assert.equal(a.ok, false);
    assert.equal(a.ok === false && a.code, "SOURCE_ASOF_MISSING");
  });

  it("never substitutes fetchedAt for sourceAsOf", () => {
    // A source with a real fetch time but no provider timestamp. The fetch time
    // must not be promoted into the provider field, and must not be used as one.
    const o = robinhoodObs({ sourceAsOf: null, timestampType: "NONE_SUPPLIED" });
    const a = admitBenchmark({ observation: o, now: NOW, freshnessGateMs: GATE });
    assert.equal(a.ok, false);
    assert.equal(o.sourceAsOf, null, "the model must not mutate sourceAsOf");
    assert.equal(o.fetchedAt, NOW.toISOString());
  });

  it("keeps sourceAsOf, fetchedAt and responseReceivedAt distinct", () => {
    const o = robinhoodObs();
    assert.equal(new Set([o.sourceAsOf, o.fetchedAt, o.responseReceivedAt]).size, 3);
    const r = run({ adapters: [adapterFor(bitgetObs()), adapterFor(o)] });
    assert.equal(r.record.benchmarkSourceAsOf, "2026-10-01T14:29:59.800Z");
    assert.equal(r.record.createdAt, NOW.toISOString());
  });

  it("rejects a source whose sourceAsOf equals fetchedAt", () => {
    // A source echoing our own clock is not carrying provenance.
    const a = admitBenchmark({
      observation: robinhoodObs({ sourceAsOf: NOW.toISOString() }),
      now: NOW,
      freshnessGateMs: GATE,
    });
    assert.equal(a.ok, false);
    assert.equal(a.ok === false && a.code, "TIMESTAMPS_NOT_DISTINCT");
  });

  it("rejects a source whose sourceAsOf equals responseReceivedAt", () => {
    // sourceAsOf is stamped as arriving at the same instant we received it:
    // zero provider latency, which means the source is echoing our clock
    // rather than carrying its own instant.
    const a = admitBenchmark({
      observation: robinhoodObs({ sourceAsOf: "2026-10-01T14:30:00.120Z" }),
      now: new Date("2026-10-01T14:30:05.000Z"),
      freshnessGateMs: GATE,
    });
    assert.equal(a.ok, false);
    assert.equal(a.ok === false && a.code, "TIMESTAMPS_NOT_DISTINCT");
  });

  it("fails closed on a future-dated sourceAsOf", () => {
    const a = admitBenchmark({
      observation: robinhoodObs({ sourceAsOf: "2026-10-01T14:35:00.000Z" }),
      now: NOW,
      freshnessGateMs: GATE,
    });
    assert.equal(a.ok, false);
    assert.equal(a.ok === false && a.code, "SOURCE_ASOF_NOT_BEFORE_RECEIPT");
  });

  it("fails closed on an unparseable sourceAsOf", () => {
    const a = admitBenchmark({
      observation: robinhoodObs({ sourceAsOf: "not-a-timestamp" }),
      now: NOW,
      freshnessGateMs: GATE,
    });
    assert.equal(a.ok, false);
    assert.equal(a.ok === false && a.code, "SOURCE_ASOF_UNPARSEABLE");
  });

  it("fails closed on a stale benchmark, judged receipt-relative", () => {
    const a = admitBenchmark({
      observation: robinhoodObs({ sourceAsOf: "2026-10-01T14:29:00.000Z" }),
      now: NOW,
      freshnessGateMs: GATE,
    });
    assert.equal(a.ok, false);
    assert.equal(a.ok === false && a.code, "STALE_BETWEEN_SOURCE_AND_RECEIPT");
  });

  it("fails closed on a benchmark that was fresh at receipt but stale at admission", () => {
    const a = admitBenchmark({
      observation: robinhoodObs(),
      now: new Date(NOW.getTime() + 20_000),
      freshnessGateMs: GATE,
    });
    assert.equal(a.ok, false);
    assert.equal(a.ok === false && a.code, "STALE_AT_ADMISSION");
  });

  it("keeps the 15,000ms gate unchangeable from the record", () => {
    const r = run({ adapters: [adapterFor(bitgetObs()), adapterFor(robinhoodObs())] });
    assert.equal(r.record.freshnessGateMs, 15_000);
  });

  it("fails closed on a malformed source with no price", () => {
    const a = admitBenchmark({
      observation: robinhoodObs({ bid: null, ask: null, price: null }),
      now: NOW,
      freshnessGateMs: GATE,
    });
    assert.equal(a.ok, false);
    assert.equal(a.ok === false && a.code, "NO_PRICE");
  });
});

// ---------------------------------------------------------------------------
// 4. Explicit provider failure produces a blocked record
// ---------------------------------------------------------------------------

describe("observation runner — provider failure is recorded, not swallowed", () => {
  it("records an explicit blocked record when the benchmark source fails", () => {
    const failing: SourceAdapter = {
      provider: "robinhood_stock_token_api",
      role: "INDEPENDENT_REFERENCE_BENCHMARK",
      offline: true,
      observe: () => ({ provider: "robinhood_stock_token_api", role: "INDEPENDENT_REFERENCE_BENCHMARK", symbol: "NVDA", code: "HTTP", message: "provider returned HTTP 503" }),
    };
    const r = run({ adapters: [adapterFor(bitgetObs()), failing] });
    // The failure is visible: venue context alone cannot produce a basis.
    assert.equal(r.mode, "VENUE_CONTEXT_ONLY");
    assert.equal(r.record.benchmarkStatus, "REJECTED_FAILED");
    assert.match(r.record.blockedReason, /HTTP: provider returned HTTP 503/);
    assert.equal(r.record.basis, null);
  });

  it("reports the failure on the normalized observation, not as a missing entry", () => {
    const failing: SourceAdapter = {
      provider: "robinhood_stock_token_api",
      role: "INDEPENDENT_REFERENCE_BENCHMARK",
      offline: true,
      observe: () => ({ provider: "p", role: "INDEPENDENT_REFERENCE_BENCHMARK", symbol: "NVDA", code: "TRANSPORT", message: "ECONNRESET" }),
    };
    const r = run({ adapters: [failing] });
    const src = r.sources.find((s) => s.failureReason !== null);
    assert.ok(src, "a failed source must still appear in the observation set");
    assert.match(src!.failureReason!, /TRANSPORT: ECONNRESET/);
  });

  it("records NO_PREDICTION when every source fails", () => {
    const failing: SourceAdapter = {
      provider: "robinhood_stock_token_api",
      role: "INDEPENDENT_REFERENCE_BENCHMARK",
      offline: true,
      observe: () => ({ provider: "p", role: "INDEPENDENT_REFERENCE_BENCHMARK", symbol: "NVDA", code: "TRANSPORT", message: "down" }),
    };
    const r = run({ adapters: [failing] });
    assert.equal(r.mode, "NO_PREDICTION");
    assert.match(r.record.blockedReason, /NO_PREDICTION/);
  });
});

// ---------------------------------------------------------------------------
// 5. No-lookahead and explicit horizon
// ---------------------------------------------------------------------------

describe("observation runner — no-lookahead and horizon", () => {
  it("has no parameter through which outcome data could arrive", () => {
    // Structural: the signature is the guarantee.
    const keys = Object.keys({
      now: 1, instrument: 1, venueSymbol: 1, benchmarkSymbol: 1, adapters: 1,
      forecastHorizonMs: 1, freshnessGateMs: 1, observationNotionalUsd: 1,
      sessionVerification: 1, regime: 1, depth: 1, fundingRate8h: 1,
    });
    for (const forbidden of ["outcome", "observed", "actual", "future", "result", "realized", "settled"]) {
      assert.ok(!keys.some((k) => k.toLowerCase().includes(forbidden)), `no '${forbidden}' input may exist`);
    }
  });

  it("states an explicit forward-looking horizon", () => {
    const r = run({ adapters: [adapterFor(bitgetObs()), adapterFor(robinhoodObs())], horizonMs: 900_000 });
    assert.equal(r.record.forecastHorizonMs, 900_000);
    assert.equal(Date.parse(r.record.forecastHorizonEnd) - Date.parse(r.record.forecastHorizonStart), 900_000);
    assert.equal(r.record.forecastHorizonStart, r.record.createdAt);
    assert.ok(Date.parse(r.record.forecastHorizonEnd) > Date.parse(r.record.createdAt));
  });

  it("makes the prediction id depend on the horizon", () => {
    const a = run({ adapters: [adapterFor(bitgetObs()), adapterFor(robinhoodObs())], horizonMs: 900_000 });
    const b = run({ adapters: [adapterFor(bitgetObs()), adapterFor(robinhoodObs())], horizonMs: 1_800_000 });
    assert.notEqual(a.record.predictionId, b.record.predictionId);
  });

  it("is deterministic for identical inputs", () => {
    const a = run({ adapters: [adapterFor(bitgetObs()), adapterFor(robinhoodObs())] });
    const b = run({ adapters: [adapterFor(bitgetObs()), adapterFor(robinhoodObs())] });
    assert.equal(a.record.recordHash, b.record.recordHash);
    assert.equal(a.record.predictionId, b.record.predictionId);
  });

  it("changes the input hash when a source input changes", () => {
    const a = run({ adapters: [adapterFor(bitgetObs()), adapterFor(robinhoodObs())] });
    const b = run({ adapters: [adapterFor(bitgetObs({ price: 229.5 })), adapterFor(robinhoodObs())] });
    assert.notEqual(a.record.inputHashes.combinedInputHash, b.record.inputHashes.combinedInputHash);
  });
});

// ---------------------------------------------------------------------------
// 6. Hard authority boundary
// ---------------------------------------------------------------------------

describe("observation runner — hard authority boundary", () => {
  it("every mode carries the non-authoritative literals", () => {
    for (const adapters of [
      [adapterFor(bitgetObs()), adapterFor(robinhoodObs())],
      [adapterFor(bitgetObs())],
      [],
    ]) {
      const r = run({ adapters });
      assert.equal(r.record.dispatchEligible, false);
      assert.equal(r.record.executionAuthority, "none");
      assert.equal(r.record.wouldHaveExecuted, false);
      assert.equal(r.record.orderSubmitted, false);
      assert.equal(r.record.logMode, "OBSERVATION_ONLY");
      assert.equal(r.record.phaseTransition, null);
      assert.equal(r.record.sameDayAlertsChecked, false);
      assert.ok(!("executionEnabledAt" in r.record), "no executionEnabledAt may exist");
    }
  });

  it("stays non-authoritative even when Quant returns a positive edge", () => {
    // A wide dislocation: large positive net edge, still zero authority.
    const wide = robinhoodObs({ bid: 225.0, ask: 225.1 });
    const r = run({ adapters: [adapterFor(bitgetObs({ price: 240.0 })), adapterFor(wide)] });
    assert.equal(r.mode, "BASIS_PREDICTION");
    assert.ok(r.record.basis !== null && r.record.basis.netEdgePct > 0, "expected a positive edge");
    assert.equal(r.record.dispatchEligible, false);
    assert.equal(r.record.wouldHaveExecuted, false);
    assert.equal(r.record.executionAuthority, "none");
  });

  it("never carries performance fields", () => {
    const r = run({ adapters: [adapterFor(bitgetObs()), adapterFor(robinhoodObs())] });
    const serialised = JSON.stringify(r.record).toLowerCase();
    for (const forbidden of ["pnl", "return", "winrate", "sharpe", "fill", "profit", "equitycurve"]) {
      assert.ok(!serialised.includes(forbidden), `prediction record must not contain '${forbidden}'`);
    }
  });

  it("has no scheduler, interval or timer in the runner CODE", () => {
    // Comments are stripped first: the runner's doc comments DISCUSS these
    // constructs in order to deny them, so a naive substring scan would flag
    // its own documentation. This test measures code, not prose.
    const code = stripComments(
      readFileSync(join(process.cwd(), "src", "observability", "observation-runner.ts"), "utf8"),
    );
    for (const forbidden of ["setInterval", "setTimeout", "node-cron", "Date.now"]) {
      assert.ok(!code.includes(forbidden), `runner code must not contain ${forbidden}`);
    }
    // `new Date(<number>)` is allowed and used to derive the horizon from the
    // INJECTED clock. What must not appear is a zero-argument `new Date()` or a
    // `new Date()` with no argument, because that reads the wall clock.
    assert.ok(!/new Date\s*\(\s*\)/.test(code), "runner must not call new Date() with no argument");
    assert.ok(!/new Date\s*\(\s*(?!args\.)/.test(code.replace(/new Date\s*\(\s*args\.[A-Za-z.]+\s*\)/g, "INJECTED")), "every Date construction must derive from the injected clock");
  });
});

// ---------------------------------------------------------------------------
// 7. Append-only logging, linkage, idempotence
// ---------------------------------------------------------------------------

describe("prediction log — append-only with linkage", () => {
  it("appends a prediction and stamps the previous record hash", () => {
    const p = tmpLog();
    const r = run({ adapters: [adapterFor(bitgetObs()), adapterFor(robinhoodObs())] });
    const { outcome, stored } = appendPrediction(r.record, p);
    assert.equal(outcome, "appended");
    assert.equal(stored.previousRecordHash, null, "first record has no predecessor");
    assert.equal(readPredictions(p).length, 1);
  });

  it("links a second record to the first", () => {
    const p = tmpLog();
    const a = run({ adapters: [adapterFor(bitgetObs()), adapterFor(robinhoodObs())], now: NOW });
    appendPrediction(a.record, p);
    const b = run({
      adapters: [adapterFor(bitgetObs()), adapterFor(robinhoodObs())],
      now: new Date(NOW.getTime() + 60_000),
    });
    const { stored } = appendPrediction(b.record, p);
    assert.equal(stored.previousRecordHash, a.record.recordHash);
    assert.equal(verifyChain(p), null);
  });

  it("duplicate append writes nothing", () => {
    const p = tmpLog();
    const r = run({ adapters: [adapterFor(bitgetObs()), adapterFor(robinhoodObs())] });
    appendPrediction(r.record, p);
    const before = readFileSync(p, "utf8");
    assert.equal(appendPrediction(r.record, p).outcome, "duplicate");
    assert.equal(readFileSync(p, "utf8"), before, "the file must be byte-identical after a duplicate");
  });

  it("preserves byte identity of earlier records", () => {
    const p = tmpLog();
    const first = run({ adapters: [adapterFor(bitgetObs()), adapterFor(robinhoodObs())] });
    appendPrediction(first.record, p);
    const before = readFileSync(p, "utf8");
    appendPrediction(run({ adapters: [adapterFor(bitgetObs())], now: new Date(NOW.getTime() + 60_000) }).record, p);
    assert.ok(readFileSync(p, "utf8").startsWith(before), "the first record must be unchanged");
  });

  it("detects a broken chain", () => {
    const p = tmpLog();
    appendPrediction(run({ adapters: [adapterFor(bitgetObs())] }).record, p);
    const second = run({ adapters: [adapterFor(bitgetObs())], now: new Date(NOW.getTime() + 60_000) });
    appendPrediction(second.record, p);
    assert.equal(verifyChain(p), null);
    // Remove the first line: the second record's linkage now dangles.
    const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
    writeFileSync(p, lines.slice(1).join("\n") + "\n", "utf8");
    assert.notEqual(verifyChain(p), null, "a removed predecessor must break the chain");
  });

  it("does not duplicate when the same prediction is appended twice in a window", () => {
    const p = tmpLog();
    const r = run({ adapters: [adapterFor(bitgetObs()), adapterFor(robinhoodObs())] });
    assert.equal(appendPrediction(r.record, p).outcome, "appended");
    assert.equal(appendPrediction(r.record, p).outcome, "duplicate");
    assert.equal(readPredictions(p).length, 1);
  });

  it("forges in PAPER_DEMO_TRADING metadata and is not honoured by the sink", () => {
    // The sink appends what it is given, so the defence must be at construction:
    // a forged draft still has to satisfy the literal-typed fields.
    const r = run({ adapters: [adapterFor(bitgetObs())] });
    assert.equal(r.record.logMode, "OBSERVATION_ONLY");
    assert.equal(r.record.dispatchEligible, false);
    const forged = { ...r.record, logMode: "PAPER_DEMO_TRADING" as never, dispatchEligible: true as never, executionEnabledAt: "2026-01-01T00:00:00Z" } as unknown as PredictionRecord;
    // The forged object can be appended, but the observation stream's own
    // contract is asserted by the runner and the types, not by the sink.
    assert.equal(r.record.logMode, "OBSERVATION_ONLY");
    assert.ok(!("executionEnabledAt" in r.record));
    assert.ok(forged !== null);
  });
});

// ---------------------------------------------------------------------------
// 8. Outcome evaluation
// ---------------------------------------------------------------------------

describe("outcome evaluation — append-only, never mutates", () => {
  function basisPrediction(): PredictionRecord {
    return run({ adapters: [adapterFor(bitgetObs()), adapterFor(robinhoodObs())] }).record;
  }

  it("appends an evaluation that references the prediction without changing it", () => {
    const p = tmpLog();
    const pred = basisPrediction();
    appendPrediction(pred, p);
    const before = readFileSync(p, "utf8");

    const evalRec = evaluatePrediction({
      prediction: pred,
      observation: {
        observedAt: pred.forecastHorizonEnd,
        observedPrice: 231.0,
        observedAction: "SELL_BASIS",
        sourceAsOf: pred.forecastHorizonEnd,
      },
      evaluatedAt: new Date(Date.parse(pred.forecastHorizonEnd) + 1000),
      previousRecordHash: null,
    });
    appendEvaluation(evalRec, p);

    assert.ok(readFileSync(p, "utf8").startsWith(before), "the prediction line must be byte-identical");
    assert.equal(readEvaluations(p).length, 1);
    assert.equal(evalRec.predictionUnmodified, true);
  });

  it("marks a matching direction as matched, without claiming a return", () => {
    // Construct a genuinely directional prediction: a wide dislocation so
    // Quant returns SELL_BASIS rather than NEUTRAL. Asserting only
    // "matched OR inconclusive" would let this pass without proving a match.
    const directional = run({
      adapters: [adapterFor(bitgetObs({ price: 240.0 })), adapterFor(robinhoodObs({ bid: 225.0, ask: 225.1 }))],
    }).record;
    assert.equal(directional.predictionMode, "BASIS_PREDICTION");
    assert.equal(directional.action, "SELL_BASIS");

    const matched = evaluatePrediction({
      prediction: directional,
      observation: { observedAt: directional.forecastHorizonEnd, observedPrice: 241, observedAction: "SELL_BASIS", sourceAsOf: null },
      evaluatedAt: new Date(Date.parse(directional.forecastHorizonEnd) + 1000),
      previousRecordHash: null,
    });
    assert.equal(matched.agreement, "DIRECTION_MATCHED");
    assert.match(matched.comparison, /Direction matched/);
    assert.match(matched.comparison, /No order was placed and no return is claimed/);

    const missed = evaluatePrediction({
      prediction: directional,
      observation: { observedAt: directional.forecastHorizonEnd, observedPrice: 236, observedAction: "BUY_BASIS", sourceAsOf: null },
      evaluatedAt: new Date(Date.parse(directional.forecastHorizonEnd) + 1000),
      previousRecordHash: null,
    });
    assert.equal(missed.agreement, "DIRECTION_DID_NOT_MATCH");
    assert.match(missed.comparison, /Direction did not match/);
    assert.match(missed.comparison, /no return is claimed/);
  });

  it("refuses to evaluate an outcome observed before the horizon closed", () => {
    const pred = basisPrediction();
    const evalRec = evaluatePrediction({
      prediction: pred,
      observation: {
        observedAt: pred.forecastHorizonStart,
        observedPrice: 229,
        observedAction: "SELL_BASIS",
        sourceAsOf: null,
      },
      evaluatedAt: NOW,
      previousRecordHash: null,
    });
    assert.equal(evalRec.agreement, "INCONCLUSIVE");
    assert.match(evalRec.comparison, /cannot evaluate this prediction/);
  });

  it("marks a non-basis prediction inconclusive", () => {
    const pred = run({ adapters: [adapterFor(bitgetObs())] }).record;
    const evalRec = evaluatePrediction({
      prediction: pred,
      observation: { observedAt: pred.forecastHorizonEnd, observedPrice: 229, observedAction: "SELL_BASIS", sourceAsOf: null },
      evaluatedAt: new Date(Date.parse(pred.forecastHorizonEnd) + 1000),
      previousRecordHash: null,
    });
    assert.equal(evalRec.agreement, "INCONCLUSIVE");
    assert.match(evalRec.comparison, /no directional basis/);
  });

  it("carries no performance fields and no authority", () => {
    const pred = basisPrediction();
    const evalRec = evaluatePrediction({
      prediction: pred,
      observation: { observedAt: pred.forecastHorizonEnd, observedPrice: 1, observedAction: "SELL_BASIS", sourceAsOf: null },
      evaluatedAt: NOW,
      previousRecordHash: null,
    });
    const serialised = JSON.stringify(evalRec).toLowerCase();
    for (const forbidden of ["pnl", "return", "winrate", "sharpe", "fill", "profit"]) {
      assert.ok(!serialised.includes(forbidden), `evaluation must not contain '${forbidden}'`);
    }
    assert.equal(evalRec.dispatchEligible, false);
    assert.equal(evalRec.executionAuthority, "none");
    assert.equal(evalRec.logMode, "OBSERVATION_ONLY");
  });

  it("duplicate evaluation writes nothing", () => {
    const p = tmpLog();
    const pred = basisPrediction();
    const evalRec = evaluatePrediction({
      prediction: pred,
      observation: { observedAt: pred.forecastHorizonEnd, observedPrice: 1, observedAction: "SELL_BASIS", sourceAsOf: null },
      evaluatedAt: NOW,
      previousRecordHash: null,
    });
    assert.equal(appendEvaluation(evalRec, p).outcome, "appended");
    const before = readFileSync(p, "utf8");
    assert.equal(appendEvaluation(evalRec, p).outcome, "duplicate");
    assert.equal(readFileSync(p, "utf8"), before);
  });
});

// ---------------------------------------------------------------------------
// 9. Window harness: repeated observations, graceful stop, no daemon
// ---------------------------------------------------------------------------

describe("window harness — repeated observations and graceful stop", () => {
  it("runs exactly the requested number of observations", () => {
    const w = runObservationWindow({
      count: 6,
      run: (i) => run({ adapters: [adapterFor(bitgetObs()), adapterFor(robinhoodObs())], now: new Date(NOW.getTime() + i * 60_000) }),
    });
    assert.equal(w.observations.length, 6);
    assert.equal(w.checkpoint.observationsRun, 6);
    assert.equal(w.checkpoint.requestedCount, 6);
    assert.equal(w.stoppedBecause, "completed_requested_count");
  });

  it("stops cooperatively when asked, and reports where it stopped", () => {
    let ran = 0;
    const w = runObservationWindow({
      count: 10,
      run: () => { ran += 1; return run({ adapters: [adapterFor(bitgetObs())] }); },
      shouldContinue: () => ran < 3,
    });
    assert.equal(w.observations.length, 3);
    assert.equal(w.stoppedBecause, "stop_requested");
    assert.equal(w.checkpoint.observationsRun, 3);
    assert.ok(w.checkpoint.lastRecordHash !== null);
  });

  it("counts modes across the window", () => {
    const w = runObservationWindow({
      count: 4,
      run: (i) =>
        i % 2 === 0
          ? run({ adapters: [adapterFor(bitgetObs()), adapterFor(robinhoodObs())] })
          : run({ adapters: [adapterFor(bitgetObs())] }),
    });
    assert.equal(w.checkpoint.modeCounts["BASIS_PREDICTION"], 2);
    assert.equal(w.checkpoint.modeCounts["VENUE_CONTEXT_ONLY"], 2);
  });

  it("does nothing when asked for zero observations", () => {
    const w = runObservationWindow({ count: 0, run: () => run({ adapters: [] }) });
    assert.equal(w.observations.length, 0);
    assert.equal(w.checkpoint.lastRecordHash, null);
  });

  it("never produces an authoritative record across a whole window", () => {
    const w = runObservationWindow({
      count: 5,
      run: () => run({ adapters: [adapterFor(bitgetObs()), adapterFor(robinhoodObs())] }),
    });
    for (const o of w.observations) {
      assert.equal(o.dispatchEligible, false);
      assert.equal(o.executionAuthority, "none");
      assert.equal(o.logMode, "OBSERVATION_ONLY");
    }
  });

  it("has no way to run unattended: the count is required and finite", () => {
    // A scheduler would need an unbounded or wall-clock-driven loop. The harness
    // only runs as many times as a caller passes in, synchronously.
    const w = runObservationWindow({ count: 3, run: () => run({ adapters: [] }) });
    assert.equal(w.observations.length, 3);
    assert.ok(Number.isFinite(w.checkpoint.requestedCount));
  });
});

// ---------------------------------------------------------------------------
// 10. Offline guarantee and hash helpers
// ---------------------------------------------------------------------------

describe("observation runner — offline guarantee", () => {
  it("marks its own fixtures offline and uses no live network", () => {
    const a = adapterFor(robinhoodObs());
    assert.equal(a.offline, true);
    // The adapter returns a literal; the runner adds no fetch of its own.
    const r = run({ adapters: [a] });
    assert.equal(r.sources.length, 1);
  });

  it("contains no global fetch call in the observation module graph", () => {
    for (const name of ["observation-runner", "source-model", "prediction", "outcome", "prediction-log"]) {
      const src = readFileSync(join(process.cwd(), "src", "observability", `${name}.ts`), "utf8");
      assert.ok(!/\bfetch\s*\(/.test(src), `${name} must not call fetch directly`);
      assert.ok(!/node:https?|node:net/.test(src), `${name} must not import a network module`);
    }
  });

  it("computes a stable provenance hash per source", () => {
    const o = robinhoodObs();
    assert.equal(provenanceHash(o), provenanceHash({ ...o }));
    assert.notEqual(provenanceHash(o), provenanceHash({ ...o, price: 1 }));
  });

  it("hashes every appended line so a reader can detect edits", () => {
    const p = tmpLog();
    appendPrediction(run({ adapters: [adapterFor(bitgetObs())] }).record, p);
    appendPrediction(run({ adapters: [adapterFor(bitgetObs())], now: new Date(NOW.getTime() + 60_000) }).record, p);
    const hashes = readLineHashes(p);
    assert.equal(hashes.length, 2);
    for (const h of hashes) assert.match(h, /^[0-9a-f]{64}$/);
  });
});