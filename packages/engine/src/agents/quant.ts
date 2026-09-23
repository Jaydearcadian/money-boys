import { z } from "zod";

/**
 * Quant Boy Alpha Engine (CLM-004 / GAP-004).
 *
 * Pure TypeScript + Zod. Zero external dependencies, no LLM, no network,
 * no Bitget writes. Sub-millisecond math: raw basis dislocation
 * (B_raw = (P_token - P_close) / P_close), orderbook VWAP walk over
 * bids/asks to fill Q (USD), funding-carry hurdle
 * (|r_8h| * (hours / 8)), round-trip friction hurdle
 * H = (2 * fee) + slippage + carry, net edge alpha = |B_raw| - H,
 * Z-score (netEdge / 0.01) and composite 0-100 quantScore.
 * Canonical entrypoint: evaluateBasisSpread(input). analyzeQuant is an alias.
 *
 * Conventions:
 *  - Fraction fields (e.g. `rawBasis`, `hurdleRate`, `netEdge`) are decimals
 *    (0.0293 = 2.93%).
 *  - `*Pct` fields are percentage points (2.93 = 2.93%).
 *  - Prices/quantities in USD / token units; order size Q in USD notional.
 */

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const DEFAULT_TAKER_FEE = 0.0006;
/** Conservative VWAP slippage penalty (fraction) for empty/insufficient book. */
export const CONSERVATIVE_SLIPPAGE_PENALTY = 0.05;
/** Edge scale mapping alpha_net -> score: alpha of 3% saturates the score. */
export const SCORE_EDGE_SCALE = 0.03;

export const OrderBookLevelSchema = z.object({
  price: z.number().positive(),
  quantity: z.number().positive(),
});
export type OrderBookLevel = z.infer<typeof OrderBookLevelSchema>;

export const MarketDepthSchema = z.object({
  bids: z.array(OrderBookLevelSchema).default([]),
  asks: z.array(OrderBookLevelSchema).default([]),
});
export type MarketDepth = z.infer<typeof MarketDepthSchema>;

export const QuantProposalInputSchema = z.object({
  /** Live token price P_token (USD). */
  tokenPrice: z.number().positive(),
  /** Friday TradFi close P_close (USD). */
  tradFiClosePrice: z.number().positive(),
  /** Order size Q in USD notional. */
  orderSizeUsd: z.number().positive(),
  /** Live orderbook depth. */
  depth: MarketDepthSchema,
  /** 8h funding rate as fraction (e.g. 0.0001 = 0.01% per 8h). May be negative. */
  fundingRate8h: z.number().finite().default(0),
  /** Weekend/carry window in hours until TradFi re-open. */
  hoursToClose: z.number().nonnegative().default(0),
  /** Alias of hoursToClose (scope naming: hoursToOpen). Takes precedence if set. */
  hoursToOpen: z.number().nonnegative().optional(),
  /** Taker fee as fraction. Defaults to 0.06%. */
  takerFee: z.number().nonnegative().default(DEFAULT_TAKER_FEE),
  /** Alias of takerFee (scope naming: feePct as fraction). Takes precedence if set. */
  feePct: z.number().nonnegative().optional(),
});
export type QuantProposalInput = z.infer<typeof QuantProposalInputSchema>;

export const QuantActionSchema = z.enum(["BUY_BASIS", "SELL_BASIS", "NEUTRAL"]);
export type QuantAction = z.infer<typeof QuantActionSchema>;

export const QuantAnalysisResultSchema = z.object({
  rawBasis: z.number().finite(),
  rawBasisPct: z.number().finite(),
  midPrice: z.number().finite(),
  vwapPrice: z.number().positive().nullable(),
  vwapSlippage: z.number().nonnegative(),
  vwapSlippagePct: z.number().nonnegative(),
  fundingCarry: z.number().nonnegative(),
  fundingCarryPct: z.number().nonnegative(),
  hurdleRate: z.number().nonnegative(),
  hurdleRatePct: z.number().nonnegative(),
  netEdge: z.number().finite(),
  netEdgePct: z.number().finite(),
  /** Z-score of net edge in units of 1% edge (netEdge / 0.01). */
  zScore: z.number().finite(),
  availableDepthUsd: z.number().nonnegative(),
  depthCoverage: z.number().nonnegative(),
  quantScore: z.number().min(0).max(100),
  action: QuantActionSchema,
  sideWalked: z.enum(["bids", "asks", "none"]),
  filledUsd: z.number().nonnegative(),
  completeFill: z.boolean(),
  reasons: z.array(z.string()),
});
export type QuantAnalysisResult = z.infer<typeof QuantAnalysisResultSchema>;

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function notional(level: OrderBookLevel): number {
  return level.price * level.quantity;
}

/** Best bid = max price; best ask = min price. Null when side empty. */
function bestBid(bids: OrderBookLevel[]): number | null {
  if (bids.length === 0) return null;
  let m = bids[0].price;
  for (const l of bids) if (l.price > m) m = l.price;
  return m;
}

function bestAsk(asks: OrderBookLevel[]): number | null {
  if (asks.length === 0) return null;
  let m = asks[0].price;
  for (const l of asks) if (l.price < m) m = l.price;
  return m;
}

// ---------------------------------------------------------------------------
// Core analysis (pure, fail-closed, never throws on book shape)
// ---------------------------------------------------------------------------

export function evaluateBasisSpread(input: QuantProposalInput): QuantAnalysisResult {
  const q = QuantProposalInputSchema.parse(input);
  const { tokenPrice: pToken, tradFiClosePrice: pClose, orderSizeUsd: Q } = q;
  // Scope aliases: hoursToOpen ~= hoursToClose, feePct ~= takerFee (fraction).
  const hours = q.hoursToOpen ?? q.hoursToClose;
  const fee = q.feePct ?? q.takerFee;

  // Raw basis dislocation: B_raw = (P_token - P_close) / P_close.
  const rawBasis = (pToken - pClose) / pClose;

  // Mid price from touch; fallback to token price when book is one-sided/empty.
  const bb = bestBid(q.depth.bids);
  const ba = bestAsk(q.depth.asks);
  const midPrice = bb !== null && ba !== null ? (bb + ba) / 2 : (bb ?? ba ?? pToken);

  // Side to walk: short basis (P_token > P_close) sells into bids;
  // long basis (P_token < P_close) lifts asks. Flat basis defaults to bids
  // (edge is zero anyway -> NEUTRAL).
  const sideWalked: "bids" | "asks" | "none" =
    q.depth.bids.length === 0 && q.depth.asks.length === 0
      ? "none"
      : rawBasis >= 0
        ? "bids"
        : "asks";

  const sideLevels: OrderBookLevel[] =
    sideWalked === "bids"
      ? [...q.depth.bids].sort((a, b) => b.price - a.price)
      : sideWalked === "asks"
        ? [...q.depth.asks].sort((a, b) => a.price - b.price)
        : [];

  const availableDepthUsd = sideLevels.reduce((s, l) => s + notional(l), 0);

  // VWAP walk: absorb Q USD across sorted levels.
  let remaining = Q;
  let filledUsd = 0;
  let filledQty = 0;
  for (const level of sideLevels) {
    if (remaining <= 0) break;
    const lvlUsd = notional(level);
    if (lvlUsd <= 0) continue;
    const takeUsd = Math.min(remaining, lvlUsd);
    filledUsd += takeUsd;
    filledQty += takeUsd / level.price;
    remaining -= takeUsd;
  }
  const completeFill = filledUsd >= Q - 1e-9 && filledQty > 0;
  const vwapPrice: number | null = filledQty > 0 ? filledUsd / filledQty : null;

  // Slippage penalty |P_VWAP - P_mid| / P_mid; conservative 5% fallback when
  // the book is empty or cannot absorb Q (fail-closed: never throw).
  let vwapSlippage: number;
  const reasons: string[] = [];
  if (vwapPrice === null || midPrice <= 0) {
    vwapSlippage = CONSERVATIVE_SLIPPAGE_PENALTY;
    reasons.push("empty book: conservative 5% slippage penalty, fail-closed NEUTRAL");
  } else {
    const realized = Math.abs(vwapPrice - midPrice) / midPrice;
    if (!completeFill) {
      vwapSlippage = Math.max(realized, CONSERVATIVE_SLIPPAGE_PENALTY);
      reasons.push(
        `insufficient depth (${round(filledUsd, 2)}/${round(Q, 2)} USD): conservative 5% slippage floor, fail-closed`,
      );
    } else {
      vwapSlippage = realized;
    }
  }

  // Friction hurdle (round-trip): H = (2 * fee) + slippage + fundingCarry,
  // fundingCarry = |r_8h| * (hours / 8). Absolute funding so elevated
  // rates always expand the hurdle (weekend carry drag).
  const fundingCarry = Math.abs(q.fundingRate8h) * (hours / 8);
  const hurdleRate = 2 * fee + vwapSlippage + fundingCarry;

  // Net edge: alpha_net = |B_raw| - H.
  const netEdge = Math.abs(rawBasis) - hurdleRate;

  // Z-score: net edge in units of 1% (0.01) edge. Positive edge -> positive z.
  const zScoreRaw = netEdge / 0.01;

  // Depth coverage: Lambda = min(1, availableDepth / (2Q)).
  const depthCoverage = Math.min(1, Q > 0 ? availableDepthUsd / (2 * Q) : 0);

  // Quant score 0-100.
  let quantScore: number;
  if (netEdge <= 0) {
    // No edge: score scales with remaining depth but is hard-capped below 50.
    const edgeDrag = Math.max(0, Math.min(0.499, 0.5 + netEdge * 10));
    quantScore = Math.min(49.9, 100 * depthCoverage * edgeDrag);
  } else {
    const edgeRatio = Math.min(1, netEdge / SCORE_EDGE_SCALE);
    const base = 50 + 50 * edgeRatio; // 50..100
    const liquidityFactor = 0.35 + 0.65 * depthCoverage; // 0.35..1.0
    quantScore = Math.min(100, base * liquidityFactor);
  }
  quantScore = Math.max(0, Math.min(100, round(quantScore, 1)));

  // Action trigger.
  let action: QuantAction;
  if (netEdge <= 0) {
    action = "NEUTRAL";
    quantScore = Math.min(quantScore, 49.9);
    if (!reasons.some((r) => r.includes("hurdle"))) {
      reasons.push("net edge <= 0: fails friction hurdle, NEUTRAL");
    }
  } else if (rawBasis > 0) {
    action = "SELL_BASIS";
  } else if (rawBasis < 0) {
    action = "BUY_BASIS";
  } else {
    action = "NEUTRAL";
    quantScore = Math.min(quantScore, 49.9);
  }

  return QuantAnalysisResultSchema.parse({
    rawBasis: round(rawBasis, 6),
    rawBasisPct: round(rawBasis * 100, 4),
    midPrice: round(midPrice, 4),
    vwapPrice: vwapPrice === null ? null : round(vwapPrice, 4),
    vwapSlippage: round(vwapSlippage, 6),
    vwapSlippagePct: round(vwapSlippage * 100, 4),
    fundingCarry: round(fundingCarry, 6),
    fundingCarryPct: round(fundingCarry * 100, 4),
    hurdleRate: round(hurdleRate, 6),
    hurdleRatePct: round(hurdleRate * 100, 4),
    netEdge: round(netEdge, 6),
    netEdgePct: round(netEdge * 100, 4),
    zScore: round(zScoreRaw, 4),
    availableDepthUsd: round(availableDepthUsd, 2),
    depthCoverage: round(depthCoverage, 4),
    quantScore,
    action,
    sideWalked,
    filledUsd: round(filledUsd, 2),
    completeFill,
    reasons,
  });
}

export const analyzeQuant = evaluateBasisSpread;

export const QuantBoy = { analyze: evaluateBasisSpread, evaluate: evaluateBasisSpread };
