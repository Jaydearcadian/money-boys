import { z } from "zod";

/**
 * CLM-006 / GAP-006 — Execution Boy fill feasibility + fee tier.
 *
 * Pure TypeScript + Zod. No LLM, no network, no Bitget writes.
 * Scores how feasibly an order of `orderSizeUsd` can be filled from the
 * currently observed book state (via Quant Boy VWAP-walk outputs) and the
 * configured Bitget taker fee tier.
 *
 * Inputs are the deterministic Quant outputs plus the taker fee:
 *  - `availableDepthUsd` / `depthCoverage` / `completeFill` come straight
 *    from `evaluateBasisSpread()` (agents/quant.ts).
 *  - `vwapSlippage` is the fraction slippage from the same result.
 *  - `takerFee` is the fraction fee (default 0.06% spot).
 *
 * Scoring (deterministic, 0–100):
 *  - liquidity 55%: completeFill ? 70 + 30*coverage : 30*coverage
 *  - fee tier  25%: <=0.06% → 100, <=0.08% → 85, <=0.10% → 70,
 *                   <=0.20% → 40, else 10
 *  - slippage  20%: max(0, 100 − slippagePct*10) — 1% slip → 90,
 *                   2% → 80, ≥10% → 0
 * `orderReady` is the dispatch gate: completeFill && score ≥ 65 &&
 * fee ≤ 0.20% && slippage ≤ 2%. `estFillLatencyMs` is a deterministic
 * estimate (base 150ms + depth shortfall + incomplete-fill penalty).
 */

export const ExecutionInputSchema = z.object({
  orderSizeUsd: z.number().positive(),
  availableDepthUsd: z.number().nonnegative(),
  depthCoverage: z.number().nonnegative(),
  completeFill: z.boolean(),
  takerFee: z.number().nonnegative().default(0.0006),
  vwapSlippage: z.number().nonnegative().default(0),
});
export type ExecutionInput = z.infer<typeof ExecutionInputSchema>;

export const ExecutionAssessmentSchema = z.object({
  executionScore: z.number().min(0).max(100),
  estFillLatencyMs: z.number().nonnegative(),
  orderReady: z.boolean(),
});
export type ExecutionAssessment = z.infer<typeof ExecutionAssessmentSchema>;

export const EXECUTION_SCORE_THRESHOLD = 65;
export const MAX_ACCEPTABLE_TAKER_FEE = 0.002;
export const MAX_ACCEPTABLE_SLIPPAGE = 0.02;

function feeTierScore(takerFee: number): number {
  if (takerFee <= 0.0006) return 100;
  if (takerFee <= 0.0008) return 85;
  if (takerFee <= 0.001) return 70;
  if (takerFee <= 0.002) return 40;
  return 10;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function evaluateExecution(input: ExecutionInput): ExecutionAssessment {
  const q = ExecutionInputSchema.parse(input);
  const coverage = Math.min(1, q.depthCoverage);

  const liquidity = q.completeFill ? 70 + 30 * coverage : 30 * coverage;
  const feeScore = feeTierScore(q.takerFee);
  const slipScore = Math.max(0, 100 - q.vwapSlippage * 100 * 10);

  const executionScore = Math.max(
    0,
    Math.min(100, round1(0.55 * liquidity + 0.25 * feeScore + 0.2 * slipScore)),
  );

  const estFillLatencyMs = Math.round(
    150 + (1 - coverage) * 900 + (q.completeFill ? 0 : 500),
  );

  const orderReady =
    q.completeFill &&
    executionScore >= EXECUTION_SCORE_THRESHOLD &&
    q.takerFee <= MAX_ACCEPTABLE_TAKER_FEE &&
    q.vwapSlippage <= MAX_ACCEPTABLE_SLIPPAGE;

  return ExecutionAssessmentSchema.parse({
    executionScore,
    estFillLatencyMs,
    orderReady,
  });
}

export const ExecutionBoy = {
  evaluate: evaluateExecution,
};
