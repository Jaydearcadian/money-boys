/**
 * DECISION AUTHORITY — who decides, and what can never be decided around.
 *
 * WHY THIS EXISTS
 *   Track 2 asks for an agent that "senses the environment, makes independent
 *   judgments, and autonomously places orders with risk controls". Our risk
 *   controls are a unilateral veto evaluated BEFORE any scoring, so an LLM arm
 *   is cheap to add safely: the LLM cannot reach a score line Risk has already
 *   terminated.
 *
 * THE ONE INVARIANT THIS MODULE ENFORCES
 *
 *   A risk veto is ABSOLUTE and is checked FIRST, before the authority switch is
 *   even read. There is no authority value, no code path and no configuration
 *   that lets an APPROVED decision exist while riskPermitted is false.
 *
 *   This is deliberately structural rather than a check inside a branch. The
 *   veto is evaluated first and returns early, so it is unreachable-by-
 *   construction from the LLM arm, not merely checked-and-overridden.
 *
 * WHAT LLM AUTHORITY DOES AND DOES NOT CHANGE
 *   COUNCIL (default) — composite score + quorum decides, as before. Unchanged.
 *   LLM             — the model's own verdict decides.
 *
 *   In BOTH modes: the LLM never holds credentials, never signs, and never
 *   bypasses the receipt gate. It chooses whether to trade. It cannot choose to
 *   trade unsafely. Those are different powers.
 *
 * FAIL-CLOSED, NOT FAIL-OPEN
 *   LLM authority with no verdict produces VETOED. An absent model output must
 *   never resolve to "no objection, proceed".
 */
import { z } from "zod";

export const DecisionAuthoritySchema = z.enum(["COUNCIL", "LLM"]);
export type DecisionAuthority = z.infer<typeof DecisionAuthoritySchema>;

export const LlmVerdictSchema = z.object({
  decision: z.enum(["APPROVED", "VETOED"]),
  /** Model confidence in [0,1]. Recorded, never used as a gate. */
  confidence: z.number().min(0).max(1).optional(),
  modelId: z.string().min(1),
  rationale: z.string().min(1),
});
export type LlmVerdict = z.infer<typeof LlmVerdictSchema>;

export const AuthorityResolutionSchema = z.object({
  decision: z.enum(["APPROVED", "VETOED"]),
  authority: DecisionAuthoritySchema,
  /** What actually produced the decision, after the veto is applied. */
  authoritySource: z.enum(["RISK_VETO", "LLM", "COUNCIL", "LLM_ABSENT_FAIL_CLOSED"]),
  /** True when Risk terminated the cycle regardless of the requested arm. */
  riskVetoApplied: z.boolean(),
  /** The council's own decision, always computed for measurement. */
  councilDecision: z.enum(["APPROVED", "VETOED"]),
  /** True when both arms reached the same decision. The A/B signal. */
  armsAgree: z.boolean(),
  reasons: z.array(z.string()),
});
export type AuthorityResolution = z.infer<typeof AuthorityResolutionSchema>;

export function resolveDecisionAuthority(input: {
  authority: DecisionAuthority;
  /** Result of reduceCouncilVote. Always required, even in LLM mode. */
  deliberation: { status: string; compositeScore: number; quorum: number };
  riskPermitted: boolean;
  riskReasons: string[];
  llmVerdict?: LlmVerdict;
}): AuthorityResolution {
  const councilDecision: "APPROVED" | "VETOED" =
    input.deliberation.status === "APPROVED" ? "APPROVED" : "VETOED";
  const reasons: string[] = [];

  // ---- THE INVARIANT. Checked first, returns early, no exceptions. --------
  if (!input.riskPermitted) {
    reasons.push(
      `RISK_VETO is absolute: permitted=false (${input.riskReasons.join("; ") || "no reason recorded"}). ` +
        `Decision is VETOED under authority=${input.authority}; no arm can reach APPROVED.`,
    );
    return AuthorityResolutionSchema.parse({
      decision: "VETOED",
      authority: input.authority,
      authoritySource: "RISK_VETO",
      riskVetoApplied: true,
      councilDecision,
      armsAgree: councilDecision === "VETOED",
      reasons,
    });
  }
  // ------------------------------------------------------------------------

  if (input.authority === "COUNCIL") {
    reasons.push(`council decision: ${input.deliberation.status} S=${input.deliberation.compositeScore.toFixed(1)} quorum=${input.deliberation.quorum}`);
    return AuthorityResolutionSchema.parse({
      decision: councilDecision,
      authority: "COUNCIL",
      authoritySource: "COUNCIL",
      riskVetoApplied: false,
      councilDecision,
      armsAgree: true,
      reasons,
    });
  }

  // LLM arm.
  if (input.llmVerdict === undefined) {
    reasons.push(
      "LLM authority requested but no verdict supplied: FAIL-CLOSED to VETOED. " +
        "An absent model output must never resolve to an approval.",
    );
    return AuthorityResolutionSchema.parse({
      decision: "VETOED",
      authority: "LLM",
      authoritySource: "LLM_ABSENT_FAIL_CLOSED",
      riskVetoApplied: false,
      councilDecision,
      armsAgree: councilDecision === "VETOED",
      reasons,
    });
  }

  const v = LlmVerdictSchema.parse(input.llmVerdict);
  reasons.push(
    `llm decision: ${v.decision} via ${v.modelId}` +
      (v.confidence === undefined ? "" : ` confidence=${v.confidence.toFixed(2)}`),
  );
  if (v.decision === "VETOED") reasons.push(`llm rationale: ${v.rationale}`);

  return AuthorityResolutionSchema.parse({
    decision: v.decision,
    authority: "LLM",
    authoritySource: "LLM",
    riskVetoApplied: false,
    councilDecision,
    armsAgree: v.decision === councilDecision,
    reasons,
  });
}