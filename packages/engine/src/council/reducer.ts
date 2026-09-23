import { z } from "zod";

/**
 * CLM-006 / GAP-006 — Council proposal reducer (quorum + weighted vote).
 *
 * Adapted from upstream noema
 * (`/tmp/upstream/noema/packages/noema-ai/src/proposal-reducer.ts`):
 * upstream `reduceAiProposalToCanonical()` promotes proposed claims /
 * relationships to canonical SOURCED/INFERRED states via evidence grounding
 * (source-snapshot + evidence maps, `validateProposal` first). This port keeps
 * that reducer shape — validate input, evaluate members, reduce to a single
 * deliberation outcome with a rationale — but swaps the substrate: instead of
 * claim/relationship promotion, four council personas (Macro / Quant / Risk /
 * Exec) vote 0–100 scores that reduce to APPROVED / SOFT_REJECT / REJECTED /
 * HARD_VETO under quorum and Risk hard-veto rules.
 *
 * Rules (spec §Phase 04):
 *  - Weights: Macro 0.25, Quant 0.35, Risk 0.25, Exec 0.15.
 *  - Thresholds: Macro ≥ 70, Quant ≥ 75, Risk ≥ 80, Exec ≥ 65.
 *  - Quorum: ≥ 3 passing members.
 *  - Risk hard veto: `riskPermitted === false` → HARD_VETO (unilateral,
 *    regardless of scores — Risk Boy I-02 non-negotiable).
 *  - S ≥ 75.0 and quorum → APPROVED.
 *  - 60.0 ≤ S < 75.0 and no veto (quorum met) → SOFT_REJECT with
 *    `reducedExposureUsd = originalExposureUsd * 0.5` (scale down, no drop).
 *  - S < 60.0 or quorum < 3 → REJECTED.
 *
 * Pure TypeScript + Zod. No LLM, no network.
 */

export const COUNCIL_WEIGHTS = {
  macro: 0.25,
  quant: 0.35,
  risk: 0.25,
  exec: 0.15,
} as const;

export const COUNCIL_THRESHOLDS = {
  macro: 70,
  quant: 75,
  risk: 80,
  exec: 65,
} as const;

export const COUNCIL_QUORUM = 3;
export const APPROVAL_SCORE = 75.0;
export const SOFT_REJECT_FLOOR = 60.0;
export const SOFT_REJECT_SCALE = 0.5;

export const CouncilVoteInputSchema = z.object({
  macroScore: z.number().min(0).max(100),
  quantScore: z.number().min(0).max(100),
  riskScore: z.number().min(0).max(100),
  execScore: z.number().min(0).max(100),
  /** Risk Boy blast-radius permission (false = HARD_VETO, unilateral). */
  riskPermitted: z.boolean(),
  /** Original single-trade exposure in USD (for SOFT_REJECT scaling). */
  originalExposureUsd: z.number().nonnegative(),
});
export type CouncilVoteInput = z.infer<typeof CouncilVoteInputSchema>;

export const DeliberationStatusSchema = z.enum([
  "APPROVED",
  "SOFT_REJECT",
  "REJECTED",
  "HARD_VETO",
]);
export type DeliberationStatus = z.infer<typeof DeliberationStatusSchema>;

export const CouncilDeliberationResultSchema = z.object({
  compositeScore: z.number().min(0).max(100),
  quorum: z.number().int().min(0).max(4),
  passingMembers: z.array(z.string()),
  status: DeliberationStatusSchema,
  /** Present only on SOFT_REJECT: scaled-down exposure (50% of original). */
  reducedExposureUsd: z.number().nonnegative().optional(),
  rationale: z.string().min(1),
});
export type CouncilDeliberationResult = z.infer<
  typeof CouncilDeliberationResultSchema
>;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Weighted composite S = 0.25·M + 0.35·Q + 0.25·R + 0.15·E. */
export function compositeScore(v: CouncilVoteInput): number {
  return round1(
    COUNCIL_WEIGHTS.macro * v.macroScore +
      COUNCIL_WEIGHTS.quant * v.quantScore +
      COUNCIL_WEIGHTS.risk * v.riskScore +
      COUNCIL_WEIGHTS.exec * v.execScore,
  );
}

export function reduceCouncilVote(input: CouncilVoteInput): CouncilDeliberationResult {
  const v = CouncilVoteInputSchema.parse(input);
  const s = compositeScore(v);

  // Unilateral Risk hard veto — evaluated before quorum/score gates.
  if (!v.riskPermitted) {
    return CouncilDeliberationResultSchema.parse({
      compositeScore: s,
      quorum: countPassing(v).length,
      passingMembers: countPassing(v),
      status: "HARD_VETO",
      rationale: `Risk hard veto (permitted=false): proposal terminated at S=${s.toFixed(1)} regardless of Macro=${v.macroScore} Quant=${v.quantScore}.`,
    });
  }

  const passing = countPassing(v);
  const quorum = passing.length;

  if (quorum < COUNCIL_QUORUM) {
    return CouncilDeliberationResultSchema.parse({
      compositeScore: s,
      quorum,
      passingMembers: passing,
      status: "REJECTED",
      rationale: `Quorum failure (${quorum}/4 passing, need ≥${COUNCIL_QUORUM}): proposal terminated at S=${s.toFixed(1)}.`,
    });
  }

  if (s >= APPROVAL_SCORE) {
    return CouncilDeliberationResultSchema.parse({
      compositeScore: s,
      quorum,
      passingMembers: passing,
      status: "APPROVED",
      rationale: `Council APPROVED at S=${s.toFixed(1)} with quorum ${quorum}/4.`,
    });
  }

  if (s >= SOFT_REJECT_FLOOR) {
    return CouncilDeliberationResultSchema.parse({
      compositeScore: s,
      quorum,
      passingMembers: passing,
      status: "SOFT_REJECT",
      reducedExposureUsd: round1(v.originalExposureUsd * SOFT_REJECT_SCALE),
      rationale: `Council SOFT_REJECT at S=${s.toFixed(1)}: exposure scaled 50% ($${v.originalExposureUsd} → $${round1(v.originalExposureUsd * SOFT_REJECT_SCALE)}), no drop.`,
    });
  }

  return CouncilDeliberationResultSchema.parse({
    compositeScore: s,
    quorum,
    passingMembers: passing,
    status: "REJECTED",
    rationale: `Council REJECTED at S=${s.toFixed(1)} below ${SOFT_REJECT_FLOOR.toFixed(1)} floor.`,
  });
}

function countPassing(v: CouncilVoteInput): string[] {
  const out: string[] = [];
  if (v.macroScore >= COUNCIL_THRESHOLDS.macro) out.push("macro");
  if (v.quantScore >= COUNCIL_THRESHOLDS.quant) out.push("quant");
  if (v.riskScore >= COUNCIL_THRESHOLDS.risk && v.riskPermitted) out.push("risk");
  if (v.execScore >= COUNCIL_THRESHOLDS.exec) out.push("exec");
  return out;
}

export const CouncilReducer = {
  reduce: reduceCouncilVote,
  composite: compositeScore,
};
