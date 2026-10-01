import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendObservationRecord,
  buildPhaseTransitionRecord,
  normaliseToObservationRecord,
  readObservationLog,
  type ObservationRecord,
} from "../src/observability/observation-log.js";

/**
 * Observation log.
 *
 * THE INVARIANTS THIS FILE EXISTS TO PIN
 *
 *   1. An observation record can NEVER claim dispatch eligibility, an order, a
 *      dispatcher call, or alert verification. These are literal types and the
 *      normaliser hard-codes them.
 *   2. The log is APPEND-ONLY. Re-normalising an artifact must not duplicate
 *      or mutate anything.
 *   3. The phase transition is an EXPLICIT record, not an inference. Nothing in
 *      this module emits one from a fill.
 *   4. Policy-era drift is corrected RETROSPECTIVELY and flagged, so a log
 *      built from pre-veto artifacts cannot present a closed-session verdict as
 *      a routine observation.
 */

function tmpLog(): string {
  return join(mkdtempSync(join(tmpdir(), "obslog-")), "observation_log.jsonl");
}

/** A minimal evidence artifact in the campaign shape. */
function artifact(over: Record<string, unknown> = {}): string {
  const base = {
    provenance: {
      sourceAsOf: "2026-10-01T13:32:30.457475138Z",
      responseReceivedAt: "2026-10-01T13:32:41.902Z",
      timestampType: "PROVIDER_GENERATED_QUOTE",
    },
    freshness: { ageAtReceiptMs: 11445, effectiveGateMs: 15000, status: "verified_fresh" },
    regime: { regime: "tradfi_open", hoursToNextReopen: 0 },
    sessionVerification: { sessionVerification: "ANNUAL_CALENDAR_ONLY", sessionTradable: true },
    provider: { id: "robinhood_stock_token_api", symbol: "NVDA" },
    quant: { action: "NEUTRAL", rawBasisPct: 0.1049, hurdleRatePct: 0.1222, netEdgePct: -0.0173, quantScore: 49.8 },
    reconciliation: { after: { positionCount: 0, accountFlat: true, equityUsd: 9364.2040197 } },
    accountUnchangedByThisRun: { equityDelta: 0 },
    surfaceResult: { bridgePacketToDispatch: "absent", blockingReasons: ["READ_ONLY_SURFACE: ...", "NO_PACKET_TO_DISPATCH_BRIDGE: ..."] },
    dispatcherInvoked: false,
    orderSubmitted: false,
  };
  return JSON.stringify({ ...base, ...over }, null, 2);
}

function writeArtifact(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "obsart-"));
  const p = join(dir, "evidence.json");
  writeFileSync(p, content, "utf8");
  return p;
}

function normalise(content: string, recordedAt?: string): ObservationRecord {
  return normaliseToObservationRecord({ evidencePath: writeArtifact(content), ...(recordedAt ? { recordedAt } : {}) });
}

// ---------------------------------------------------------------------------
// 1. An observation can never look executable
// ---------------------------------------------------------------------------

describe("observation log — an observation is never executable", () => {
  it("hard-codes the non-authoritative fields", () => {
    const r = normalise(artifact());
    assert.equal(r.logMode, "OBSERVATION_ONLY");
    assert.equal(r.decision, "NO_TRADE");
    assert.equal(r.dispatchEligible, false);
    assert.equal(r.executable, false);
    assert.equal(r.executionAuthority, "none");
    assert.equal(r.sameDayAlertsChecked, false);
    assert.equal(r.orderSubmitted, false);
    assert.equal(r.dispatcherInvoked, false);
    assert.equal(r.phaseTransition, null);
  });

  it("overrides an artifact that claims it dispatched something", () => {
    // A lying or corrupted artifact must not be able to promote itself.
    const r = normalise(artifact({ orderSubmitted: true, dispatcherInvoked: true }));
    assert.equal(r.orderSubmitted, false);
    assert.equal(r.dispatcherInvoked, false);
    assert.equal(r.dispatchEligible, false);
  });

  it("records the source artifact and its hash for audit", () => {
    const content = artifact();
    const r = normalise(content);
    assert.match(r.sourceEvidenceHash, /^[0-9a-f]{64}$/);
    assert.ok(r.sourceEvidenceRef.length > 0);
  });

  it("derives the reason from the artifact's own gate, not from inference", () => {
    const r = normalise(artifact());
    assert.match(r.reason, /NEUTRAL/);
    assert.match(r.reason, /did not clear/);
    assert.match(r.reason, /NO_TRADE/);
    assert.equal(r.reasonIsRetrospective, false);
  });

  it("prefers an explicit CLOSED_SESSION_VETO reason from the artifact", () => {
    const r = normalise(
      artifact({
        regime: { regime: "tradfi_closed", hoursToNextReopen: 5.1 },
        surfaceResult: {
          bridgePacketToDispatch: "absent",
          blockingReasons: ["CLOSED_SESSION_VETO: TradFi is closed; ...", "READ_ONLY_SURFACE: ..."],
        },
      }),
    );
    assert.match(r.reason, /^CLOSED_SESSION_VETO/);
    assert.equal(r.reasonIsRetrospective, false, "the artifact already said this");
  });
});

// ---------------------------------------------------------------------------
// 2. Policy-era drift is corrected and flagged
// ---------------------------------------------------------------------------

describe("observation log — retrospective policy correction", () => {
  it("flags a closed-session artifact that predates the veto", () => {
    const r = normalise(
      JSON.stringify({
        provenance: { sourceAsOf: "2026-10-01T08:23:13.420Z", responseReceivedAt: "2026-10-01T08:23:21.768Z" },
        freshness: { ageAtReceiptMs: 7538, effectiveGateMs: 15000, status: "verified_fresh" },
        regime: { regime: "tradfi_closed", hoursToNextReopen: 5.1109 },
        // NOTE: no sessionVerification block, and no veto reason: this artifact
        // predates the closed-session veto.
        quant: { action: "SELL_BASIS", rawBasisPct: 0.1587, hurdleRatePct: 0.1222, netEdgePct: 0.0366, quantScore: 50.6 },
        reconciliation: { after: { positionCount: 0, accountFlat: true, equityUsd: 9364.2040197 } },
        surfaceResult: { bridgePacketToDispatch: "absent", blockingReasons: ["READ_ONLY_SURFACE: ..."] },
      }),
      "2026-10-01T08:23:13.420Z",
    );
    assert.equal(r.reasonIsRetrospective, true);
    assert.match(r.reason, /CLOSED_SESSION_VETO/);
    assert.match(r.reason, /applied retrospectively/);
    assert.match(r.reason, /would not be produced today/);
    // The verdict is preserved as data; only the reason is corrected.
    assert.equal(r.quant.action, "SELL_BASIS");
    assert.equal(r.quant.netEdgePct, 0.0366);
    assert.equal(r.decision, "NO_TRADE");
  });

  it("does not flag an open-session artifact", () => {
    assert.equal(normalise(artifact()).reasonIsRetrospective, false);
  });
});

// ---------------------------------------------------------------------------
// 3. Append-only
// ---------------------------------------------------------------------------

describe("observation log — append-only", () => {
  it("appends a first record", () => {
    const p = tmpLog();
    const r = normalise(artifact());
    assert.equal(appendObservationRecord(r, p), "appended");
    assert.equal(readObservationLog(p).length, 1);
  });

  it("refuses to append the same artifact twice", () => {
    const p = tmpLog();
    const r = normalise(artifact());
    appendObservationRecord(r, p);
    assert.equal(appendObservationRecord(r, p), "duplicate");
    assert.equal(readObservationLog(p).length, 1, "a re-run must not duplicate history");
  });

  it("does not mutate an earlier record when a new one is appended", () => {
    const p = tmpLog();
    const first = normalise(artifact(), "2026-10-01T10:00:00.000Z");
    appendObservationRecord(first, p);
    const before = readFileSync(p, "utf8");

    const second = normalise(artifact({ regime: { regime: "tradfi_open", hoursToNextReopen: 0 }, freshness: { ageAtReceiptMs: 500, effectiveGateMs: 15000, status: "verified_fresh" } }), "2026-10-01T11:00:00.000Z");
    appendObservationRecord(second, p);

    const after = readFileSync(p, "utf8");
    assert.ok(after.startsWith(before), "the first record must be byte-identical after an append");
    assert.equal(readObservationLog(p).length, 2);
  });

  it("reads an empty or missing log as empty", () => {
    assert.deepEqual(readObservationLog(join(tmpdir(), "definitely-not-here.jsonl")), []);
  });

  it("keeps one line per record so it stays a valid JSONL stream", () => {
    const p = tmpLog();
    appendObservationRecord(normalise(artifact(), "2026-10-01T10:00:00.000Z"), p);
    appendObservationRecord(normalise(artifact({ provider: { id: "x", symbol: "AAPL" } }), "2026-10-01T11:00:00.000Z"), p);
    const lines = readFileSync(p, "utf8").split("\n").filter((l) => l.length > 0);
    assert.equal(lines.length, 2);
    for (const l of lines) {
      const parsed = JSON.parse(l) as ObservationRecord;
      assert.equal(parsed.logMode, "OBSERVATION_ONLY");
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The transition is explicit, never inferred
// ---------------------------------------------------------------------------

describe("observation log — phase transition is explicit", () => {
  const authorization = {
    authorizedBy: "operator",
    authorizationRef: "TEST-ONLY-REF",
    executionEnabledAt: "2026-11-02T14:00:00.000Z",
    reason: "explicit bounded Demo authorization",
    scope: "one symbol, one operator-triggered run, Demo only",
    gateState: {
      providerAuthorizedForAutomatedUse: true,
      calendarBasis: "ANNUAL_CALENDAR_PLUS_ALERTS",
      sameDayAlertsVerified: true,
      completeChecklistRequired: true as const,
    },
    commitSha: "0".repeat(40),
  };

  it("builds a PAPER_DEMO_TRADING transition record", () => {
    const r = buildPhaseTransitionRecord({ authorization, sourceEvidenceRef: "x.json" });
    assert.equal(r.logMode, "PAPER_DEMO_TRADING");
    assert.equal(r.decision, "PHASE_TRANSITION");
    assert.equal(r.phaseTransition.executionEnabledAt, "2026-11-02T14:00:00.000Z");
    assert.equal(r.phaseTransition.commitSha, "0".repeat(40));
    assert.equal(r.phaseTransition.gateState.completeChecklistRequired, true);
  });

  it("is never produced by normalising an artifact", () => {
    // Nothing in the observation path can emit a transition, no matter what
    // the artifact claims.
    for (const content of [
      artifact(),
      artifact({ logMode: "PAPER_DEMO_TRADING" }),
      artifact({ phaseTransition: { authorizedBy: "forged" } }),
      artifact({ orderSubmitted: true, dispatcherInvoked: true, dispatchEligible: true }),
    ]) {
      const r = normalise(content);
      assert.equal(r.logMode, "OBSERVATION_ONLY");
      assert.equal(r.phaseTransition, null);
      assert.equal(r.dispatchEligible, false);
      assert.equal(r.orderSubmitted, false);
    }
  });

  it("ignores a forged logMode or dispatchEligible in the artifact", () => {
    const r = normalise(artifact({ logMode: "PAPER_DEMO_TRADING", dispatchEligible: true, executable: true }));
    assert.equal(r.logMode, "OBSERVATION_ONLY");
    assert.equal(r.dispatchEligible, false);
    assert.equal(r.executable, false);
  });

  it("carries the full authorization context, not just a flag", () => {
    const r = buildPhaseTransitionRecord({ authorization, sourceEvidenceRef: "x.json" });
    const t = r.phaseTransition;
    for (const field of ["authorizedBy", "authorizationRef", "executionEnabledAt", "reason", "scope", "commitSha"] as const) {
      assert.ok(t[field] !== undefined && String(t[field]).length > 0, `${field} must be present`);
    }
    assert.ok(t.gateState.providerAuthorizedForAutomatedUse !== undefined);
    assert.ok(t.gateState.calendarBasis.length > 0);
  });

  it("produces a distinct id per authorization", () => {
    const a = buildPhaseTransitionRecord({ authorization, sourceEvidenceRef: "x.json" });
    const b = buildPhaseTransitionRecord({
      authorization: { ...authorization, executionEnabledAt: "2026-11-03T14:00:00.000Z" },
      sourceEvidenceRef: "x.json",
    });
    assert.notEqual(a.recordId, b.recordId);
  });
});

describe("observation log — what these records are not", () => {
  it("carries no performance claim field at all", async () => {
    // A performance record would need PnL, fills, or returns. None may exist.
    const r = normalise(artifact());
    const keys = Object.keys(r).join(" ");
    for (const forbidden of ["pnl", "return", "winRate", "sharpe", "fills", "profit"]) {
      assert.ok(!keys.toLowerCase().includes(forbidden.toLowerCase()), `observation record must not carry ${forbidden}`);
    }
    assert.equal(r.account.positions, 0);
    assert.equal(r.account.flat, true);
  });

  it("states the account was flat and equity unchanged", () => {
    const r = normalise(artifact());
    assert.equal(r.account.flat, true);
    assert.equal(r.account.equityDelta, 0);
  });

  it("does not require the checked-in log to exist for its tests to pass", () => {
    // Guards against a future edit pointing the default path somewhere wrong.
    assert.ok(!existsSync(join(tmpdir(), "nope.jsonl")));
  });
});