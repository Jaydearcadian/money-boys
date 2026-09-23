import { z } from "zod";
import { evaluateBasisSpread, type QuantAnalysisResult } from "../agents/quant.js";
import { evaluateExecution, type ExecutionAssessment } from "../agents/execution.js";
import {
  StructuralChangeGuard,
  toBlastRadiusReport,
  type BlastRadiusResult,
  type RiskAccount,
} from "../skills/igraph-guard/security.js";
import {
  reduceCouncilVote,
  type CouncilDeliberationResult,
} from "./reducer.js";
import {
  sealReceipt,
  type SealedReasoningReceipt,
} from "./receipts.js";
import {
  MacroCatalystProposalSchema,
  type MacroCatalystProposal,
} from "../skills/noema-qa/schemas.js";
import { MarketDepthSchema } from "../agents/quant.js";
import { RiskAccountSchema } from "../skills/igraph-guard/security.js";

/**
 * CLM-006 / GAP-006 — Council cyclic handoff adapter.
 *
 * Adapted from upstream 0-infinity
 * (`/tmp/upstream/0-infinity/src/reasoning/councilAdapter.ts`):
 * upstream `validateCouncilDecisionCandidate()` binds a council decision to
 * its invocation (workflow/invocation ids, role artifact refs, evidence hash,
 * direction/confidence) and freezes it. This port keeps that adapter shape —
 * a single entrypoint that binds persona outputs to one sealed decision —
 * but swaps the substrate: instead of role-artifact binding, the full
 * Money Boys pipeline runs in order and seals a ReasoningReceipt:
 *
 *   quant.evaluateBasisSpread → security.StructuralChangeGuard
 *   .evaluateBlastRadius → execution.evaluateExecution →
 *   reducer.reduceCouncilVote → receipts.sealReceipt
 *
 * Risk score mapping (deterministic): veto → 0; approved →
 * `100 − utilizationPct × 0.5` (e.g. 8% util → 96, 29.7% → ~85.2), so a
 * safe book still clears the Risk ≥ 80 threshold while utilization drag is
 * visible. Receipt decision: APPROVED → APPROVED, anything else → VETOED
 * (SOFT_REJECT keeps its `reducedExposureUsd` in the deliberation result
 * for scaled resubmission — the receipt still seals, verify stays true).
 *
 * Pure TypeScript + Zod. No LLM, no network.
 */

export const DeliberationCycleParamsSchema = z.object({
  symbol: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  quantity: z.number().positive(),
  priceUsd: z.number().positive(),
  tokenPrice: z.number().positive(),
  tradFiClosePrice: z.number().positive(),
  orderSizeUsd: z.number().positive(),
  fundingRate8h: z.number().finite().default(0),
  hoursToClose: z.number().nonnegative().default(0),
  takerFee: z.number().nonnegative().default(0.0006),
  rationale: z.string().min(1).optional(),
});
export type DeliberationCycleParams = z.infer<typeof DeliberationCycleParamsSchema>;

export const DeliberationCycleResultSchema = z.object({
  receipt: z.custom<SealedReasoningReceipt>((v) => typeof v === "object" && v !== null),
  deliberation: z.custom<CouncilDeliberationResult>(
    (v) => typeof v === "object" && v !== null,
  ),
});
export type DeliberationCycleResult = {
  receipt: SealedReasoningReceipt;
  deliberation: CouncilDeliberationResult;
  quant: QuantAnalysisResult;
  risk: BlastRadiusResult;
  execution: ExecutionAssessment;
};

function riskScoreFor(blast: BlastRadiusResult): number {
  if (blast.decision !== "APPROVED") return 0;
  const utilPct = blast.projectedMarginUtilization * 100;
  const s = 100 - utilPct * 0.5;
  return Math.max(0, Math.min(100, Math.round(s * 10) / 10));
}

export function executeDeliberationCycle(
  catalyst: MacroCatalystProposal,
  depth: unknown,
  account: RiskAccount,
  params: DeliberationCycleParams,
): DeliberationCycleResult {
  const macro = MacroCatalystProposalSchema.parse(catalyst);
  const book = MarketDepthSchema.parse(depth);
  const acct = RiskAccountSchema.parse(account);
  const p = DeliberationCycleParamsSchema.parse(params);

  // 1. Quant Boy: basis dislocation + VWAP walk + hurdle + score.
  const quant = evaluateBasisSpread({
    tokenPrice: p.tokenPrice,
    tradFiClosePrice: p.tradFiClosePrice,
    orderSizeUsd: p.orderSizeUsd,
    depth: book,
    fundingRate8h: p.fundingRate8h,
    hoursToClose: p.hoursToClose,
    takerFee: p.takerFee,
  });

  // 2. Risk Boy: HARD_VETO gate + reconciled report.
  const risk = StructuralChangeGuard.evaluateBlastRadius(
    { symbol: p.symbol, side: p.side, quantity: p.quantity, priceUsd: p.priceUsd },
    acct,
  );
  const riskReport = toBlastRadiusReport(risk);

  // 3. Execution Boy: fill feasibility + fee tier from Quant outputs.
  const execution = evaluateExecution({
    orderSizeUsd: p.orderSizeUsd,
    availableDepthUsd: quant.availableDepthUsd,
    depthCoverage: quant.depthCoverage,
    completeFill: quant.completeFill,
    takerFee: p.takerFee,
    vwapSlippage: quant.vwapSlippage,
  });

  // 4. Council reducer: weighted vote + quorum + veto.
  const originalExposureUsd = Math.round(p.quantity * p.priceUsd * 100) / 100;
  const deliberation: CouncilDeliberationResult = reduceCouncilVote({
    macroScore: macro.score,
    quantScore: quant.quantScore,
    riskScore: riskScoreFor(risk),
    execScore: execution.executionScore,
    riskPermitted: riskReport.permitted,
    originalExposureUsd,
  });

  // 5. Seal: APPROVED → APPROVED, anything else → VETOED (still verifiable).
  const receipt = sealReceipt({
    symbol: p.symbol,
    action: quant.action,
    quantMetrics: quant,
    riskReport,
    councilScores: {
      compositeScore: deliberation.compositeScore,
      macro: macro.score,
      quant: quant.quantScore,
      risk: riskScoreFor(risk),
      exec: execution.executionScore,
    },
    decision: deliberation.status === "APPROVED" ? "APPROVED" : "VETOED",
    rationale:
      p.rationale ??
      `Council ${deliberation.status} (S=${deliberation.compositeScore.toFixed(1)}, quorum ${deliberation.quorum}/4): ${deliberation.rationale}`,
  });

  return { receipt, deliberation, quant, risk, execution };
}

export const CouncilAdapter = {
  execute: executeDeliberationCycle,
};
