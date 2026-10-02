import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";
import { resolveDecisionAuthority, type LlmVerdict } from "../src/council/decision-authority.js";
import { computeAbMetrics, runAbCycle, type ArmObservation } from "../src/council/ab-harness.js";

const APPROVED_COUNCIL = { status: "APPROVED", compositeScore: 78, quorum: 4 };
const REJECTED_COUNCIL = { status: "REJECTED", compositeScore: 41, quorum: 2 };
const HASH = createHash("sha256").update("cycle-input").digest("hex");

function verdict(decision: "APPROVED" | "VETOED", modelId = "qwen-plus", confidence = 0.8): LlmVerdict {
  return { decision, modelId, confidence, rationale: `model says ${decision}` };
}

// ---------------------------------------------------------------------------
// THE invariant: a risk veto is absolute
// ---------------------------------------------------------------------------

describe("decision authority — the risk veto is absolute", () => {
  const arms = ["COUNCIL", "LLM"] as const;

  for (const authority of arms) {
    it(`refuses APPROVED under ${authority} when Risk says no`, () => {
      const r = resolveDecisionAuthority({
        authority,
        deliberation: APPROVED_COUNCIL,
        riskPermitted: false,
        riskReasons: ["HARD_VETO: exposure exceeds free margin"],
        llmVerdict: verdict("APPROVED"),
      });
      assert.equal(r.decision, "VETOED");
      assert.equal(r.riskVetoApplied, true);
      assert.equal(r.authoritySource, "RISK_VETO");
    });
  }

  it("vetoes an LLM approval even when the council also approved", () => {
    const r = resolveDecisionAuthority({
      authority: "LLM",
      deliberation: APPROVED_COUNCIL,
      riskPermitted: false,
      riskReasons: ["HARD_VETO: 65% margin ceiling"],
      llmVerdict: verdict("APPROVED", "model", 1),
    });
    assert.equal(r.decision, "VETOED");
    assert.match(r.reasons.join(" "), /absolute/);
  });

  it("ignores LLM confidence entirely when Risk has vetoed", () => {
    const r = resolveDecisionAuthority({
      authority: "LLM",
      deliberation: APPROVED_COUNCIL,
      riskPermitted: false,
      riskReasons: ["cap"],
      llmVerdict: verdict("APPROVED", "model", 1),
    });
    assert.equal(r.decision, "VETOED", "confidence must never soften a veto");
  });

  it("still reports the council decision under a veto, for measurement", () => {
    const r = resolveDecisionAuthority({
      authority: "LLM",
      deliberation: APPROVED_COUNCIL,
      riskPermitted: false,
      riskReasons: ["cap"],
      llmVerdict: verdict("VETOED"),
    });
    assert.equal(r.councilDecision, "APPROVED");
    assert.equal(r.decision, "VETOED");
    assert.equal(r.armsAgree, false);
  });

  it("marks the veto arm as disagreeing when council also said approved", () => {
    const r = resolveDecisionAuthority({
      authority: "LLM",
      deliberation: APPROVED_COUNCIL,
      riskPermitted: false,
      riskReasons: ["cap"],
      llmVerdict: verdict("VETOED"),
    });
    assert.equal(r.armsAgree, false, "council APPROVED, veto forced VETOED");
  });
});

// ---------------------------------------------------------------------------
// COUNCIL arm — must be byte-identical to prior behaviour
// ---------------------------------------------------------------------------

describe("decision authority — COUNCIL arm unchanged", () => {
  it("passes through an approved council result", () => {
    const r = resolveDecisionAuthority({
      authority: "COUNCIL", deliberation: APPROVED_COUNCIL, riskPermitted: true, riskReasons: [],
    });
    assert.equal(r.decision, "APPROVED");
    assert.equal(r.authoritySource, "COUNCIL");
    assert.equal(r.riskVetoApplied, false);
  });

  it("passes through a rejected council result", () => {
    const r = resolveDecisionAuthority({
      authority: "COUNCIL", deliberation: REJECTED_COUNCIL, riskPermitted: true, riskReasons: [],
    });
    assert.equal(r.decision, "VETOED");
  });

  it("ignores any supplied LLM verdict", () => {
    const r = resolveDecisionAuthority({
      authority: "COUNCIL", deliberation: REJECTED_COUNCIL, riskPermitted: true,
      riskReasons: [], llmVerdict: verdict("APPROVED"),
    });
    assert.equal(r.decision, "VETOED", "a stray verdict must not leak into the council arm");
  });
});

// ---------------------------------------------------------------------------
// LLM arm — including fail-closed behaviour
// ---------------------------------------------------------------------------

describe("decision authority — LLM arm", () => {
  it("honours an LLM approval", () => {
    const r = resolveDecisionAuthority({
      authority: "LLM", deliberation: APPROVED_COUNCIL, riskPermitted: true,
      riskReasons: [], llmVerdict: verdict("APPROVED"),
    });
    assert.equal(r.decision, "APPROVED");
    assert.equal(r.authoritySource, "LLM");
    assert.equal(r.armsAgree, true);
  });

  it("lets the LLM veto a trade the council approved", () => {
    const r = resolveDecisionAuthority({
      authority: "LLM", deliberation: APPROVED_COUNCIL, riskPermitted: true,
      riskReasons: [], llmVerdict: verdict("VETOED"),
    });
    assert.equal(r.decision, "VETOED");
    assert.equal(r.armsAgree, false);
  });

  it("FAIL-CLOSES to VETOED when no verdict is supplied", () => {
    const r = resolveDecisionAuthority({
      authority: "LLM", deliberation: APPROVED_COUNCIL, riskPermitted: true, riskReasons: [],
    });
    assert.equal(r.decision, "VETOED");
    assert.equal(r.authoritySource, "LLM_ABSENT_FAIL_CLOSED");
    assert.match(r.reasons.join(" "), /FAIL-CLOSED/);
  });

  it("never treats a missing verdict as consent", () => {
    const r = resolveDecisionAuthority({
      authority: "LLM", deliberation: APPROVED_COUNCIL, riskPermitted: true, riskReasons: [],
    });
    assert.notEqual(r.decision, "APPROVED");
  });

  it("rejects a malformed verdict", () => {
    assert.throws(() => resolveDecisionAuthority({
      authority: "LLM", deliberation: APPROVED_COUNCIL, riskPermitted: true,
      riskReasons: [], llmVerdict: { decision: "MAYBE", modelId: "m", rationale: "x" } as never,
    }));
  });

  it("records the model id and confidence but gates on neither", () => {
    const r = resolveDecisionAuthority({
      authority: "LLM", deliberation: APPROVED_COUNCIL, riskPermitted: true,
      riskReasons: [], llmVerdict: verdict("VETOED", "qwen-plus", 0.99),
    });
    assert.match(r.reasons.join(" "), /qwen-plus/);
    assert.equal(r.decision, "VETOED", "high confidence must not upgrade a veto");
  });
});

// ---------------------------------------------------------------------------
// A/B harness
// ---------------------------------------------------------------------------

describe("A/B harness — cycle execution", () => {
  it("always runs the council arm, even in an LLM cycle", () => {
    const obs = runAbCycle({
      cycleId: "c1", inputHash: HASH, riskPermitted: true, riskReasons: [],
      deliberation: APPROVED_COUNCIL, llmVerdicts: [verdict("APPROVED")],
    });
    assert.equal(obs.length, 2);
    assert.deepEqual(obs.map((o) => o.authority), ["COUNCIL", "LLM"]);
  });

  it("emits one observation per LLM repeat so consistency is measurable", () => {
    const obs = runAbCycle({
      cycleId: "c1", inputHash: HASH, riskPermitted: true, riskReasons: [],
      deliberation: APPROVED_COUNCIL,
      llmVerdicts: [verdict("APPROVED"), verdict("VETOED"), verdict("APPROVED")],
    });
    assert.equal(obs.length, 4);
    assert.equal(obs.filter((o) => o.authority === "LLM").length, 3);
  });

  it("records the veto on every arm when Risk denies", () => {
    const obs = runAbCycle({
      cycleId: "c1", inputHash: HASH, riskPermitted: false, riskReasons: ["cap"],
      deliberation: APPROVED_COUNCIL, llmVerdicts: [verdict("APPROVED"), verdict("APPROVED")],
    });
    assert.ok(obs.every((o) => o.decision === "VETOED"));
    assert.ok(obs.every((o) => o.riskVetoApplied));
  });
});

describe("A/B harness — metrics", () => {
  const base = (o: Partial<ArmObservation> = {}): ArmObservation => ({
    cycleId: "c1", inputHash: HASH, authority: "COUNCIL", decision: "APPROVED",
    councilDecision: "APPROVED", armsAgree: true, riskVetoApplied: false,
    riskPermitted: true, humanTakeover: false, outcome: "UNKNOWN", ...o,
  });

  it("reports riskViolationRate 0 on clean data", () => {
    const m = computeAbMetrics([base(), base({ authority: "LLM" })]);
    assert.equal(m.riskViolationRate, 0);
    assert.equal(m.criticalDefect, false);
  });

  it("flags a risk violation as a CRITICAL defect", () => {
    const m = computeAbMetrics([base({ riskPermitted: false, decision: "APPROVED" })]);
    assert.equal(m.riskViolations, 1);
    assert.equal(m.criticalDefect, true);
    assert.match(m.caveats.join(" "), /CRITICAL/);
  });

  it("measures perfect consistency when an input repeats identically", () => {
    const obs = [
      base(), base({ authority: "LLM" }), base({ authority: "LLM" }), base({ authority: "LLM" }),
    ];
    const m = computeAbMetrics(obs);
    assert.equal(m.decisionConsistency, 1);
    assert.equal(m.repeatsPerInput, 4);
  });

  it("measures low consistency when the LLM flip-flops on one input", () => {
    const obs = [
      base(),
      base({ authority: "LLM", decision: "APPROVED" }),
      base({ authority: "LLM", decision: "VETOED" }),
      base({ authority: "LLM", decision: "VETOED" }),
    ];
    // APPROVED appears twice (council + one LLM repeat), VETOED twice.
    // Modal count is 2 of 4, so consistency is exactly 0.5 — a perfect split
    // across repeats of one identical input. A deterministic baseline scores
    // 1.0 here, which is the whole comparison.
    const m = computeAbMetrics(obs);
    assert.equal(m.decisionConsistency, 0.5);
    assert.ok(m.decisionConsistency < 1, "a flip-flopping LLM must not score 1.0");
  });

  it("scores a deterministic baseline at 1.0 on the same inputs", () => {
    const m = computeAbMetrics([
      base(), base(), base({ authority: "LLM" }), base({ authority: "LLM" }),
    ]);
    assert.equal(m.decisionConsistency, 1);
  });

  it("refuses to claim consistency with no repeated input", () => {
    const m = computeAbMetrics([base({ inputHash: createHash("sha256").update("other").digest("hex") })]);
    assert.equal(m.decisionConsistency, 0);
    assert.match(m.caveats.join(" "), /NOT evidence of consistency/);
  });

  it("counts disagreement between arms separately from agreement", () => {
    const m = computeAbMetrics([
      base(),
      base({ authority: "LLM", decision: "VETOED", armsAgree: false }),
    ]);
    assert.equal(m.armsAgreeCount, 1);
    assert.equal(m.armsDisagreeCount, 1);
    assert.equal(m.armsAgreementRate, 0.5);
  });

  it("reports UNKNOWN outcomes rather than folding them into FLAT", () => {
    const m = computeAbMetrics([
      base({ outcome: "UNKNOWN" }),
      base({ outcome: "UNKNOWN" }),
      base({ authority: "LLM", outcome: "WIN" }),
    ]);
    assert.equal(m.outcomeTally.unknown, 2);
    assert.equal(m.outcomeTally.flat, 0);
    assert.match(m.caveats.join(" "), /NOT as accuracy/);
  });

  it("measures human takeover rate", () => {
    const m = computeAbMetrics([base(), base({ humanTakeover: true }), base({ humanTakeover: true })]);
    assert.equal(m.humanTakeovers, 2);
    assert.ok(Math.abs(m.humanTakeoverRate - 2 / 3) < 1e-9);
  });

  it("handles an empty observation set without dividing by zero", () => {
    const m = computeAbMetrics([]);
    assert.equal(m.cycles, 0);
    assert.equal(m.riskViolationRate, 0);
    assert.equal(m.armsAgreementRate, 0);
  });

  it("rejects a malformed observation", () => {
    assert.throws(() => computeAbMetrics([base({ decision: "MAYBE" as never })]));
  });
});