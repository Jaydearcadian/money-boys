import { z } from "zod";

/**
 * Risk Boy HARD_VETO — StructuralChangeGuard (CLM-002 / GAP-002).
 *
 * Pure TypeScript + Zod. No LLM, no network, no Bitget writes.
 * Non-negotiable invariants (checked in order):
 *   R1: single-order exposure (qty * price) must be <= $5,000 USD.
 *   R2: exposure must be <= available freeMarginUsd.
 *   R3: projected margin utilization (usedMargin + exposure) / equity
 *       must be <= 65.0%.
 *
 * Margin model is deliberately conservative spot-style: required margin
 * for the new order is assumed equal to full notional exposure (1x,
 * no leverage netting). Utilization denominator is account equityUsd.
 * Liquidation price is a deterministic conservative *estimate*, not an
 * exchange-accurate value — it exists so downstream dispatch has a
 * number to seal into the ReasoningReceipt (CLM-003), not to predict
 * the venue's engine.
 */

export const MAX_SINGLE_EXPOSURE_USD = 5_000;
export const MAX_MARGIN_UTILIZATION = 0.65;

export const OrderSideSchema = z.enum(["buy", "sell"]);
export type OrderSide = z.infer<typeof OrderSideSchema>;

export const RiskOrderRequestSchema = z.object({
  symbol: z.string().min(1),
  side: OrderSideSchema,
  quantity: z.number().positive(),
  priceUsd: z.number().positive(),
});
export type RiskOrderRequest = z.infer<typeof RiskOrderRequestSchema>;

export const OpenOrderSchema = z.object({
  orderId: z.string().min(1),
  symbol: z.string().min(1),
});
export type OpenOrder = z.infer<typeof OpenOrderSchema>;

export const RiskAccountSchema = z.object({
  equityUsd: z.number().positive(),
  usedMarginUsd: z.number().nonnegative(),
  freeMarginUsd: z.number().nonnegative(),
  openOrders: z.array(OpenOrderSchema).default([]),
});
export type RiskAccount = z.infer<typeof RiskAccountSchema>;

export const BlastRadiusDecisionSchema = z.enum(["APPROVED", "HARD_VETO"]);
export type BlastRadiusDecision = z.infer<typeof BlastRadiusDecisionSchema>;

export const BlastRadiusResultSchema = z.object({
  decision: BlastRadiusDecisionSchema,
  reasons: z.array(z.string()),
  exposureUsd: z.number().nonnegative(),
  projectedMarginUtilization: z.number().nonnegative(),
  cancelCandidates: z.array(z.string()),
  /** Null when vetoed — no projection is emitted for rejected orders. */
  projectedLiquidationPrice: z.number().nonnegative().nullable(),
});
export type BlastRadiusResult = z.infer<typeof BlastRadiusResultSchema>;

/**
 * Upstream-reconciled change-request verification report (pre-flight audit).
 *
 * Canonical verification keys shared with the iGraph change-guard surface
 * and sealed into the ReasoningReceipt (`riskReport`):
 *   { permitted, projectedMarginUtilizationPct, projectedLiquidationPrice,
 *     staleOrdersToCancel, rejectionReason? }
 *
 * `projectedMarginUtilizationPct` is percentage points (e.g. 8.0 = 8%).
 * `projectedLiquidationPrice` is null when vetoed (no projection emitted).
 * `rejectionReason` is present only when `permitted` is false.
 */
export const BlastRadiusReportSchema = z.object({
  permitted: z.boolean(),
  projectedMarginUtilizationPct: z.number().nonnegative(),
  projectedLiquidationPrice: z.number().nonnegative().nullable(),
  staleOrdersToCancel: z.array(z.string()),
  rejectionReason: z.string().min(1).optional(),
});
export type BlastRadiusReport = z.infer<typeof BlastRadiusReportSchema>;

/** Map the internal HARD_VETO evaluation result onto the reconciled report shape. */
export function toBlastRadiusReport(result: BlastRadiusResult): BlastRadiusReport {
  return BlastRadiusReportSchema.parse({
    permitted: result.decision === "APPROVED",
    projectedMarginUtilizationPct: Math.round(result.projectedMarginUtilization * 10000) / 100,
    projectedLiquidationPrice: result.projectedLiquidationPrice,
    staleOrdersToCancel: result.cancelCandidates,
    ...(result.decision === "HARD_VETO"
      ? { rejectionReason: result.reasons.join("; ") || "HARD_VETO" }
      : {}),
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Conservative liquidation-price *estimate*.
 * Long/buy:  liq = entry * (1 - freeMargin / equity)
 * Short/sell: liq = entry * (1 + freeMargin / equity)
 * Clamped at >= 0 and rounded to 2dp. Pure function of inputs.
 */
export function estimateLiquidationPrice(
  side: OrderSide,
  entryPriceUsd: number,
  freeMarginUsd: number,
  equityUsd: number,
): number {
  const cushion = freeMarginUsd / equityUsd;
  const raw =
    side === "buy" ? entryPriceUsd * (1 - cushion) : entryPriceUsd * (1 + cushion);
  return Math.max(0, round2(raw));
}

export const StructuralChangeGuard = {
  evaluateBlastRadius(
    request: RiskOrderRequest,
    account: RiskAccount,
  ): BlastRadiusResult {
    const req = RiskOrderRequestSchema.parse(request);
    const acct = RiskAccountSchema.parse(account);

    const exposureUsd = round2(req.quantity * req.priceUsd);
    const projectedMarginUtilization =
      acct.equityUsd === 0
        ? Number.POSITIVE_INFINITY
        : round2((acct.usedMarginUsd + exposureUsd) / acct.equityUsd);

    const reasons: string[] = [];

    // R1 — $5k single-trade cap.
    if (exposureUsd > MAX_SINGLE_EXPOSURE_USD) {
      reasons.push(
        `HARD_VETO: exposure $${exposureUsd} exceeds $${MAX_SINGLE_EXPOSURE_USD} single-trade cap`,
      );
    }

    // R2 — free-margin floor.
    if (exposureUsd > acct.freeMarginUsd) {
      reasons.push(
        `HARD_VETO: exposure $${exposureUsd} exceeds free margin $${acct.freeMarginUsd}`,
      );
    }

    // R3 — 65% utilization ceiling.
    if (projectedMarginUtilization > MAX_MARGIN_UTILIZATION) {
      reasons.push(
        `HARD_VETO: projected margin utilization ${(projectedMarginUtilization * 100).toFixed(1)}% exceeds 65.0%`,
      );
    }

    // Same-symbol open orders are always surfaced as cancel candidates
    // so dispatch can flatten before placing the new order.
    const cancelCandidates = acct.openOrders
      .filter((o) => o.symbol === req.symbol)
      .map((o) => o.orderId);

    if (reasons.length > 0) {
      return BlastRadiusResultSchema.parse({
        decision: "HARD_VETO",
        reasons,
        exposureUsd,
        projectedMarginUtilization,
        cancelCandidates,
        projectedLiquidationPrice: null,
      });
    }

    return BlastRadiusResultSchema.parse({
      decision: "APPROVED",
      reasons: [],
      exposureUsd,
      projectedMarginUtilization,
      cancelCandidates,
      projectedLiquidationPrice: estimateLiquidationPrice(
        req.side,
        req.priceUsd,
        acct.freeMarginUsd,
        acct.equityUsd,
      ),
    });
  },
};
