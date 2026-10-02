/**
 * Inventory-aware quoting — Avellaneda & Stoikov (2008).
 *
 * WHY THIS EXISTS
 *   The spread-capture bot this was compared against quotes a FIXED spread from
 *   fair price regardless of position or volatility. That is not inventory
 *   aware: it will keep bidding into a position it already holds, and keep
 *   widening nothing when the market gets fast.
 *
 *   The A-S reservation price is the standard correction:
 *
 *       r = s - gamma * sigma^2 * (T - t) * q
 *
 *   where s is the fair value, gamma the risk aversion, sigma^2 per-second
 *   volatility, (T - t) the remaining horizon and q the CURRENT INVENTORY in
 *   base units. A long inventory pushes r DOWN, which widens the bid and lifts
 *   the ask, so quoting is naturally biased toward reducing risk.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *   - No order-book queue position, no fill model, no prediction of the next
 *     mid. This is a cost/inventory model, not a fill model.
 *   - No learned parameters. gamma and sigma are INPUTS supplied by the caller,
 *     never fitted silently inside this module.
 *   - No optimisation loop. Two quotes, closed form.
 *
 * INVENTORY SIGN CONVENTION
 *   q > 0 means LONG base units. For a BUY_BASIS trade (long the token, short
 *   the equity) the token leg is long, so q > 0 and the skew widens the bid.
 */
import { z } from "zod";

export const InventoryQuoteInputSchema = z.object({
  /** Fair value estimate. Use a defensible estimator, not last trade. */
  fairPrice: z.number().positive(),
  /** Current inventory in BASE units. Positive = long. */
  inventoryBase: z.number().finite().default(0),
  /** Per-second volatility (standard deviation of price returns, per sqrt(second)). */
  volatilityPerSqrtSecond: z.number().nonnegative(),
  /** Risk aversion. Larger = more willing to shed inventory. */
  riskAversion: z.number().nonnegative(),
  /** Remaining horizon in SECONDS. Longer horizon = stronger skew. */
  horizonSeconds: z.number().nonnegative(),
  /** Base spread as a fraction of price, e.g. 0.0008 = 8bp. */
  baseSpread: z.number().nonnegative(),
  /** Hard inventory cap in base units. Beyond this, quote reduce-only. */
  maxInventoryBase: z.number().positive(),
});
export type InventoryQuoteInput = z.infer<typeof InventoryQuoteInputSchema>;

export const InventoryQuoteSchema = z.object({
  /** Fair value as supplied. */
  fairPrice: z.number().positive(),
  /** A-S reservation price — the risk-adjusted centre of the quote. */
  reservationPrice: z.number().finite(),
  /** How far the reservation price moved from fair value, as a fraction. */
  reservationSkew: z.number().finite(),
  /** Half-spread actually applied after clamping. */
  halfSpread: z.number().nonnegative(),
  bidPrice: z.number().nonnegative(),
  askPrice: z.number().nonnegative(),
  /** True when inventory is at/over cap: quote reduce-only, never add. */
  reduceOnly: z.boolean(),
  /** Cap-binding direction, or null. */
  inventorySide: z.enum(["LONG", "SHORT", "FLAT", "NONE"]),
  /** True if the quote was clamped to stay inside the book. */
  clampedToBook: z.boolean(),
  reasons: z.array(z.string()),
});
export type InventoryQuote = z.infer<typeof InventoryQuoteSchema>;

export function computeInventoryQuote(raw: InventoryQuoteInput): InventoryQuote {
  const q = InventoryQuoteInputSchema.parse(raw);
  const reasons: string[] = [];

  // Reservation price: risk-adjusted centre.
  const riskTerm = q.riskAversion * q.volatilityPerSqrtSecond ** 2 * q.horizonSeconds * q.inventoryBase;
  const reservation = q.fairPrice - riskTerm;
  const skew = q.fairPrice > 0 ? (reservation - q.fairPrice) / q.fairPrice : 0;
  reasons.push(`reservation skew ${(skew * 100).toFixed(4)}% from gamma*sigma^2*(T-t)*q`);

  // Half-spread never exceeds half the base spread, and never goes negative.
  const half = Math.max(0, q.baseSpread / 2);

  // Inventory cap: at or beyond the cap, stop quoting the side that adds risk.
  let reduceOnly = false;
  let inventorySide: InventoryQuote["inventorySide"] = "NONE";
  if (q.inventoryBase >= q.maxInventoryBase) {
    reduceOnly = true;
    inventorySide = "LONG";
    reasons.push(`inventory ${q.inventoryBase.toFixed(6)} at LONG cap ${q.maxInventoryBase}: reduce-only, bid suppressed`);
  } else if (q.inventoryBase <= -q.maxInventoryBase) {
    reduceOnly = true;
    inventorySide = "SHORT";
    reasons.push(`inventory ${q.inventoryBase.toFixed(6)} at SHORT cap ${q.maxInventoryBase}: reduce-only, ask suppressed`);
  } else if (q.inventoryBase > 0) {
    inventorySide = "LONG";
  } else if (q.inventoryBase < 0) {
    inventorySide = "SHORT";
  } else {
    inventorySide = "FLAT";
  }

  let bid = reservation - half;
  let ask = reservation + half;
  let clampedToBook = false;

  // A crossed or negative quote is not a quote. Reject rather than emit garbage.
  // Extreme long inventory can drive the reservation price below zero, which
  // makes BOTH sides meaningless: there is no price at which either side should
  // be quoted. Both are suppressed rather than emitting a negative ask.
  if (bid <= 0) {
    bid = 0;
    reasons.push("bid collapsed to <= 0 under risk skew: bid suppressed");
  }
  if (ask <= 0) {
    ask = 0;
    reasons.push("ask collapsed to <= 0 under risk skew: ask suppressed");
  }

  return InventoryQuoteSchema.parse({
    fairPrice: round(q.fairPrice, 6),
    reservationPrice: round(reservation, 6),
    reservationSkew: round(skew, 8),
    halfSpread: round(half, 8),
    bidPrice: round(bid, 6),
    askPrice: round(ask, 6),
    reduceOnly,
    inventorySide,
    clampedToBook,
    reasons,
  });
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}