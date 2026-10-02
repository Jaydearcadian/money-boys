/**
 * Fill probability and the cost of NOT filling.
 *
 * WHY THIS EXISTS
 *   Both the Quant hurdle and the A-S reservation price assume an order
 *   transacts. Neither assumes WHEN, or WHETHER. A passive order has three
 *   costs that only exist because it may not fill:
 *
 *     1. Queue-ahead — you are behind everyone at your price.
 *     2. Adverse selection — a fill is more likely when someone knows something.
 *     3. Opportunity cost — an unfilled order ties up capital and, more
 *        importantly, the EDGE you were trying to capture may be gone.
 *
 *   (2) is handled in quant.ts as adverseSelection. This module handles (1)
 *   and (3), and refuses to pretend the fill is certain.
 *
 * HONEST LIMITS OF THE QUEUE MODEL
 *   This is the standard queue-position heuristic, NOT a fill simulator:
 *
 *       P(fill) ≈ 1 - exp(-k * (arrivalRate) * (timeInMarket) / queueAhead)
 *
 *   with the exponential arrival rate k = 1 / meanInterarrivalSeconds. It
 *   assumes a Poisson arrival process and that your order is filled when the
 *   cumulative front-of-queue volume exceeds queueAhead + your size. It does
 *   NOT model cancellations ahead of you (which help you), order-book
 *   replenishment, or price moves away from your level. Real fills are worse
 *   than this predicts on trend days and better on quiet ones.
 *
 *   It is used to DISCOUNT an edge, so its bias is deliberately in the
 *   conservative direction: any doubt about the inputs fails closed to a
 *   lower probability and therefore a higher hurdle.
 */
import { z } from "zod";

export const FillProbabilityInputSchema = z.object({
  /** Quantity at your level, in base units. */
  orderSizeBase: z.number().positive(),
  /** Volume resting ahead of you at your price, in base units. */
  queueAheadBase: z.number().nonnegative().default(0),
  /** Mean seconds between arrivals at your price level (Poisson). */
  meanInterarrivalSeconds: z.number().positive(),
  /** How long the order rests before you give up. */
  timeInMarketSeconds: z.number().nonnegative(),
  /** Volume traded at your level per second. */
  arrivalRateBasePerSecond: z.number().nonnegative(),
  /**
   * Probability that a fill is ADVERSE (counterparty knew something).
   * Multiplies the captured spread. Conservative default 0.5.
   */
  adverseFillProbability: z.number().min(0).max(1).default(0.5),
  /**
   * Fraction of the gross spread actually captured on a fill, after fees.
   * Enter the SPREAD, not the edge: this function applies adverseFillProbability
   * to it. Using netEdge here would double-count selection.
   */
  capturedSpread: z.number().nonnegative(),
  /**
   * Edge forfeited if the order does NOT fill within the horizon.
   * This is the opportunity-cost term and is the whole point of the module.
   */
  foregoneEdgeOnNoFill: z.number().nonnegative().default(0),
});
export type FillProbabilityInput = z.infer<typeof FillProbabilityInputSchema>;

export const FillProbabilitySchema = z.object({
  /** Model fill probability in [0,1]. */
  fillProbability: z.number().min(0).max(1),
  /** Exposure you must clear before you get to the front of the queue. */
  effectiveQueueBase: z.number().nonnegative(),
  /** Fill-weighted adverse selection cost. */
  adverseSelectionCost: z.number().nonnegative(),
  /** Expected capture across filled and unfilled outcomes. */
  expectedCapture: z.number().finite(),
  /** Hurdle adjustment to ADD because the fill is uncertain. */
  opportunityCostHurdle: z.number().nonnegative(),
  /** grossCapture*p - (1-p)*foregoneEdge — the decision-relevant number. */
  riskAdjustedEdge: z.number().finite(),
  model: z.literal("poisson-queue-v1"),
  reasons: z.array(z.string()),
});
export type FillProbability = z.infer<typeof FillProbabilitySchema>;

export function computeFillProbability(raw: FillProbabilityInput): FillProbability {
  const q = FillProbabilityInputSchema.parse(raw);
  const reasons: string[] = [];

  // Fail closed on any input that cannot support a probability.
  if (!(q.meanInterarrivalSeconds > 0)) {
    throw new Error("meanInterarrivalSeconds must be positive");
  }

  // Queue you must clear, plus your own size: you cannot fill until the volume
  // ahead of you AND your order have traded.
  const effectiveQueue = q.queueAheadBase + q.orderSizeBase;
  const k = 1 / q.meanInterarrivalSeconds;

  // Expected arrivals at your level while you rest.
  const expectedArrivals = q.arrivalRateBasePerSecond * q.timeInMarketSeconds;

  // P(no fill) = exp(-k * expectedArrivals / effectiveQueue)
  //   When you are alone at your level (queueAhead = 0) this reduces to
  //   1 - exp(-k*arrivals), the standard single-order fill estimate.
  const exponent = (k * expectedArrivals) / effectiveQueue;
  // exponent >= 0 by construction (k > 0, arrivals >= 0, queue > 0).
  const noFill = Math.exp(-exponent);
  const fillProbability = clamp01(1 - noFill);

  // Adverse selection: you only capture the spread on a fill you were right
  // to be filled on. Prob of a non-adverse fill = 1 - adverseFillProbability.
  const cleanFillFactor = 1 - q.adverseFillProbability;
  const adverseSelectionCost = q.capturedSpread * q.adverseFillProbability;

  // Gross expected capture: only realised if filled.
  const grossCapture = fillProbability * q.capturedSpread * cleanFillFactor;

  // Opportunity cost: the edge you lose by not filling is REAL and is charged
  // in full when the fill fails. This is what stops the model treating a
  // resting order as a free option.
  const opportunityCostHurdle = (1 - fillProbability) * q.foregoneEdgeOnNoFill;

  const riskAdjustedEdge = grossCapture - opportunityCostHurdle;

  reasons.push(`queue ahead ${q.queueAheadBase.toFixed(6)} + size ${q.orderSizeBase.toFixed(6)}`);
  reasons.push(`arrivals ${expectedArrivals.toFixed(4)} vs queue ${effectiveQueue.toFixed(6)}`);
  reasons.push(`P(fill)=${fillProbability.toFixed(4)} model=poisson-queue-v1`);
  if (fillProbability < 0.5) {
    reasons.push("fill probability below 50%: edge heavily discounted");
  }

  return FillProbabilitySchema.parse({
    fillProbability: round(fillProbability, 6),
    effectiveQueueBase: round(effectiveQueue, 6),
    adverseSelectionCost: round(adverseSelectionCost, 8),
    expectedCapture: round(grossCapture, 8),
    opportunityCostHurdle: round(opportunityCostHurdle, 8),
    riskAdjustedEdge: round(riskAdjustedEdge, 8),
    model: "poisson-queue-v1",
    reasons,
  });
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}