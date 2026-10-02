/**
 * A/B HARNESS — measures the LLM arm against the fixed-rule baseline.
 *
 * WHY A HARNESS AND NOT A TOGGLE
 *   A toggle shows you one arm at a time and tells you nothing about whether
 *   the LLM arm is any good. Track 2's Open Theme asks for exactly the
 *   comparison: decision consistency, risk-violation rate, human-takeover rate
 *   and incremental value over a fixed-rule baseline. Both arms run on the SAME
 *   inputs, so the delta is attributable to the authority choice and nothing
 *   else. The delta is the deliverable.
 *
 * WHAT EACH METRIC MEANS HERE, PRECISELY
 *
 *   decisionConsistency
 *     Repeat the SAME input N times through the LLM arm and measure how often
 *     the verdict matches the modal verdict. This is the strongest available
 *     objection to LLM decision authority, and it can only be measured with an
 *     LLM arm. A deterministic baseline scores 1.0 by construction, which is
 *     exactly why the comparison is interesting.
 *
 *   riskViolationRate
 *     Fraction of cycles that reached APPROVED while Risk was not permitted.
 *     MUST be 0 under every authority. A non-zero value is a critical defect,
 *     not a metric to be tuned.
 *
 *   humanTakeoverRate
 *     Operator interventions per cycle. Measured by the caller, aggregated here.
 *
 *   incrementalValueOverFixedRule
 *     Where the arms DISAGREE, who was right is unknowable without a realised
 *     outcome, so this reports agreement and disagreement as separate counts
 *     rather than inventing a score. A claimed "improvement" with no outcome
 *     data would be a fabricated number.
 */
import { z } from "zod";
import {
  DecisionAuthoritySchema,
  resolveDecisionAuthority,
  type LlmVerdict,
} from "./decision-authority.js";

export const ArmObservationSchema = z.object({
  cycleId: z.string().min(1),
  inputHash: z.string().regex(/^[0-9a-f]{64}$/),
  authority: DecisionAuthoritySchema,
  decision: z.enum(["APPROVED", "VETOED"]),
  councilDecision: z.enum(["APPROVED", "VETOED"]),
  armsAgree: z.boolean(),
  riskVetoApplied: z.boolean(),
  riskPermitted: z.boolean(),
  /** Operator overrode the decision this cycle. */
  humanTakeover: z.boolean(),
  /** Realised outcome, when known. Null means UNKNOWN, never "no loss". */
  outcome: z.enum(["WIN", "LOSS", "FLAT", "UNKNOWN"]).default("UNKNOWN"),
});
export type ArmObservation = z.infer<typeof ArmObservationSchema>;

export const AbMetricsSchema = z.object({
  cycles: z.number().int().nonnegative(),
  /** Fraction reaching APPROVED while Risk was not permitted. Must be 0. */
  riskViolationRate: z.number().min(0).max(1),
  riskViolations: z.number().int().nonnegative(),
  /** Modal-verdict agreement across repeats of identical inputs. */
  decisionConsistency: z.number().min(0).max(1),
  repeatsPerInput: z.number().int().nonnegative(),
  armsAgreeCount: z.number().int().nonnegative(),
  armsDisagreeCount: z.number().int().nonnegative(),
  armsAgreementRate: z.number().min(0).max(1),
  humanTakeovers: z.number().int().nonnegative(),
  humanTakeoverRate: z.number().min(0).max(1),
  /** Outcome split. UNKNOWN is reported, never folded into FLAT. */
  outcomeTally: z.object({
    win: z.number().int().nonnegative(),
    loss: z.number().int().nonnegative(),
    flat: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
  }),
  criticalDefect: z.boolean(),
  caveats: z.array(z.string()),
});
export type AbMetrics = z.infer<typeof AbMetricsSchema>;

function ratio(n: number, d: number): number {
  return d === 0 ? 0 : n / d;
}

export function computeAbMetrics(observations: ArmObservation[]): AbMetrics {
  const obs = observations.map((o) => ArmObservationSchema.parse(o));
  const caveats: string[] = [];

  // ---- risk violation: the one number that must never be non-zero --------
  const violations = obs.filter((o) => o.decision === "APPROVED" && !o.riskPermitted);
  const reasonText = obs.length > 0 ? violations.map((v) => v.cycleId).join(", ") : "";
  if (violations.length > 0) {
    caveats.push(
      `CRITICAL: ${violations.length} cycle(s) reached APPROVED while Risk was not permitted ` +
        `(cycles: ${reasonText}). This is a hard-invariant breach, not a metric.`,
    );
  }

  // ---- decision consistency over repeats of the SAME input ---------------
  const byInput = new Map<string, ArmObservation[]>();
  for (const o of obs) {
    const list = byInput.get(o.inputHash) ?? [];
    list.push(o);
    byInput.set(o.inputHash, list);
  }
  const repeated = [...byInput.values()].filter((g) => g.length > 1);
  const multiArm = [...byInput.values()].filter((g) => g.length > 1 && new Set(g.map((x) => x.authority)).size > 1);
  const maxRepeats = repeated.reduce((m, g) => Math.max(m, g.length), 0);

  // Consistency is only meaningful when an input was actually repeated.
  let consistent = 0;
  for (const group of multiArm) {
    const counts = new Map<string, number>();
    for (const g of group) counts.set(g.decision, (counts.get(g.decision) ?? 0) + 1);
    const modal = Math.max(...counts.values());
    consistent += modal;
  }
  const consistencyDenominator = multiArm.reduce((n, g) => n + g.length, 0);
  const decisionConsistency = ratio(consistent, consistencyDenominator);

  if (consistencyDenominator === 0) {
    caveats.push(
      "decisionConsistency is 0 by convention: no input hash was repeated across arms. " +
        "This number is NOT evidence of consistency until repeats exist.",
    );
  }

  const agree = obs.filter((o) => o.armsAgree).length;
  const humanTakeovers = obs.filter((o) => o.humanTakeover).length;

  const outcomeTally = {
    win: obs.filter((o) => o.outcome === "WIN").length,
    loss: obs.filter((o) => o.outcome === "LOSS").length,
    flat: obs.filter((o) => o.outcome === "FLAT").length,
    unknown: obs.filter((o) => o.outcome === "UNKNOWN").length,
  };
  if (outcomeTally.unknown > 0) {
    caveats.push(
      `${outcomeTally.unknown} cycle(s) have NO realised outcome. Agreement between arms is ` +
        `reported as agreement, NOT as accuracy: without an outcome it is unknown which arm was right.`,
    );
  }

  return AbMetricsSchema.parse({
    cycles: obs.length,
    riskViolationRate: ratio(violations.length, obs.length),
    riskViolations: violations.length,
    decisionConsistency,
    repeatsPerInput: maxRepeats,
    armsAgreeCount: agree,
    armsDisagreeCount: obs.length - agree,
    armsAgreementRate: ratio(agree, obs.length),
    humanTakeovers,
    humanTakeoverRate: ratio(humanTakeovers, obs.length),
    outcomeTally,
    criticalDefect: violations.length > 0,
    caveats,
  });
}

/**
 * Run both arms over ONE cycle and return aggregatable observations.
 *
 * The council result is ALWAYS computed even in LLM mode, because the
 * comparison is the point and an unmeasured arm is worthless.
 *
 * Supplying several LLM verdicts for the same input is how decision
 * consistency becomes measurable: each repeat is an independent draw from the
 * same deterministic council baseline.
 */
export function runAbCycle(args: {
  cycleId: string;
  inputHash: string;
  riskPermitted: boolean;
  riskReasons: string[];
  deliberation: { status: string; compositeScore: number; quorum: number };
  /** One verdict per repeat. Zero or one is allowed; consistency needs >=2. */
  llmVerdicts: LlmVerdict[];
  humanTakeover?: boolean;
  outcome?: ArmObservation["outcome"];
}): ArmObservation[] {
  const council = resolveDecisionAuthority({
    authority: "COUNCIL",
    deliberation: args.deliberation,
    riskPermitted: args.riskPermitted,
    riskReasons: args.riskReasons,
  });

  const out: ArmObservation[] = [
    {
      cycleId: args.cycleId,
      inputHash: args.inputHash,
      authority: "COUNCIL",
      decision: council.decision,
      councilDecision: council.councilDecision,
      armsAgree: council.armsAgree,
      riskVetoApplied: council.riskVetoApplied,
      riskPermitted: args.riskPermitted,
      humanTakeover: args.humanTakeover ?? false,
      outcome: args.outcome ?? "UNKNOWN",
    },
  ];

  for (const v of args.llmVerdicts) {
    const r = resolveDecisionAuthority({
      authority: "LLM",
      deliberation: args.deliberation,
      riskPermitted: args.riskPermitted,
      riskReasons: args.riskReasons,
      llmVerdict: v,
    });
    out.push({
      cycleId: args.cycleId,
      inputHash: args.inputHash,
      authority: "LLM",
      decision: r.decision,
      councilDecision: r.councilDecision,
      armsAgree: r.armsAgree,
      riskVetoApplied: r.riskVetoApplied,
      riskPermitted: args.riskPermitted,
      humanTakeover: args.humanTakeover ?? false,
      outcome: args.outcome ?? "UNKNOWN",
    });
  }
  return out;
}
