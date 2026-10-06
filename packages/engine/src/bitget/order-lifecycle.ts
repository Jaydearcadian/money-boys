/**
 * Order lifecycle beyond open/close: resting limits, cancellation, TP/SL.
 *
 * SCOPE (GAP-012)
 *   The Stage 3 bounded campaign used `orderType: market` exclusively, so
 *   nothing ever rested, nothing was ever cancelled, and no preset TP/SL was
 *   ever exercised. This module supplies those three missing lifecycle
 *   operations, all of them behind the SAME receipt gate the open/close path
 *   uses: an unapproved or tampered receipt authorises nothing.
 *
 * WHAT THIS IS NOT
 *   Not an order-placement path. `placeRestingLimit` exists so a cancel has
 *   something to cancel, but every function here still requires an APPROVED,
 *   SHA-256-verifiable receipt. None of these bypass the gate.
 *
 * WHY THE CANCEL PATH IS SEPARATE
 *   Cancelling is a venue write, so it carries exactly the same risk profile as
 *   placing. It gets the same gate, the same idempotent clientOid derivation
 *   (intent-bound, so a cancel cannot collide with its own order — the real
 *   40786 failure mode), and the same fail-closed venue-error handling.
 *
 * IDEMPOTENCE
 *   A cancel's clientOid is derived from `receiptHash + orderId + "cancel"`, so
 *   a retry of the same cancel against the same order produces the same id and
 *   the venue treats it as one intent rather than a new one.
 *
 * TP/SL ARE VENUE-SIDE PRESETS
 *   Attached to the order at placement rather than polled client-side, so they
 *   act even if this process is not running. That is the property that makes
 *   them a risk control rather than a convenience.
 */
import { createHash } from "node:crypto";
import { verifyReceipt, type SealedReasoningReceipt } from "../council/receipts.js";
import { mapToVenueSymbol } from "./dispatcher.js";

/** Bitget v2 mix order routes used by the lifecycle path. */
export const MIX_PLACE_ORDER_PATH = "/api/v2/mix/order/place-order";
export const MIX_CANCEL_ORDER_PATH = "/api/v2/mix/order/cancel-order";
export const MIX_ORDER_STATUS_PATH = "/api/v2/mix/order/detail";
export const MIX_POSITION_PATH = "/api/v2/mix/position/all-position";

export type OrderType = "market" | "limit";

/** Preset take-profit / stop-loss attached to an order at placement. */
export interface TakeProfitStopLoss {
  readonly takeProfitPrice: number;
  readonly stopLossPrice: number;
}

export interface LifecycleOrderRequest {
  readonly symbol: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly orderType: OrderType;
  /** Required when orderType is limit. Rejected before any network call otherwise. */
  readonly limitPriceUsd?: number;
  readonly tpSl?: TakeProfitStopLoss;
  /** hedge mode closes the position direction; one_way omits tradeSide. */
  readonly positionMode?: "hedge" | "one_way";
  /** Marks the intent so open/close/cancel clientOids cannot collide. */
  readonly intent?: "open" | "close";
}

export interface LifecycleOrderResult {
  readonly orderId: string | null;
  readonly clientOid: string;
  readonly symbol: string;
  readonly orderType: OrderType;
  readonly limitPriceUsd: number | null;
  readonly takeProfitPrice: number | null;
  readonly stopLossPrice: number | null;
  /** SUBMITTED means the order is live at the venue and may rest. */
  readonly status: "SUBMITTED" | "FILLED" | "REJECTED";
  readonly receiptHash: string;
  readonly mode: string;
  readonly raw?: unknown;
  readonly error?: string;
}

export interface CancelResult {
  readonly status: "CANCELLED" | "REJECTED";
  readonly orderId: string;
  readonly clientOid: string;
  readonly symbol: string;
  readonly receiptHash: string;
  readonly raw?: unknown;
  readonly error?: string;
}

export interface OrderReadBack {
  readonly orderId: string;
  readonly symbol: string;
  readonly status: string;
  readonly orderType: string;
  readonly price: number | null;
  readonly quantity: number;
  readonly reduceOnly: boolean;
  readonly raw: unknown;
}

/** Minimal signed-client surface. Satisfied by BitgetClient. */
export interface LifecycleClient {
  request?: (
    method: "GET" | "POST",
    path: string,
    query?: Record<string, string>,
    auth?: boolean,
    bodyObj?: unknown,
  ) => Promise<{ code: string; msg?: string; data?: unknown; raw?: unknown }>;
}

export class LifecycleValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "LifecycleValidationError";
    this.code = code;
  }
}

/**
 * The receipt gate. Identical requirement to the open/close path: APPROVED and
 * cryptographically verifiable, or nothing happens.
 */
function assertReceiptAuthorisesAction(receipt: SealedReasoningReceipt, action: string): void {
  if ((receipt as { decision?: string }).decision !== "APPROVED") {
    throw new Error(`Cannot ${action} with an unapproved receipt`);
  }
  if (!verifyReceipt(receipt)) {
    throw new Error(`Cannot ${action}: receipt SHA-256 seal does not verify`);
  }
}

/**
 * Intent-bound clientOid. Same collision fix as the dispatch path: an order
 * and its cancel must not derive the same id (venue 40786).
 */
export function lifecycleClientOid(args: {
  receiptHash: string;
  intent: "place" | "cancel";
  orderId?: string;
}): string {
  return createHash("sha256")
    .update(`${args.receiptHash}:${args.intent}:${args.orderId ?? "new"}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Validate an order request BEFORE any network call.
 *
 * Rejects a limit order with no price, a limit price on a market order, and TP
 * or SL levels on the wrong side of the entry — all of which would otherwise be
 * accepted by the client and refused confusingly by the venue.
 */
export function validateOrderRequest(req: LifecycleOrderRequest): void {
  if (!Number.isFinite(req.quantity) || req.quantity <= 0) {
    throw new LifecycleValidationError("QUANTITY_INVALID", `quantity must be positive, got ${req.quantity}`);
  }
  if (req.orderType === "limit") {
    if (req.limitPriceUsd === undefined || !(req.limitPriceUsd > 0)) {
      throw new LifecycleValidationError("LIMIT_PRICE_REQUIRED", "a limit order requires a positive limitPriceUsd");
    }
  } else if (req.limitPriceUsd !== undefined) {
    throw new LifecycleValidationError("LIMIT_PRICE_ON_MARKET", "a market order must not carry a limitPriceUsd");
  }
  if (req.tpSl !== undefined) {
    const entry = req.limitPriceUsd;
    if (entry === undefined || !(entry > 0)) {
      // TP/SL on a market order has no reference price to validate against, so
      // it is refused rather than passed through unchecked.
      throw new LifecycleValidationError("TP_SL_REQUIRES_LIMIT", "TP/SL presets require a limit order with a price to validate against");
    }
    const { takeProfitPrice, stopLossPrice } = req.tpSl;
    if (!(takeProfitPrice > 0) || !(stopLossPrice > 0)) {
      throw new LifecycleValidationError("TP_SL_INVALID", "takeProfitPrice and stopLossPrice must both be positive");
    }
    if (req.side === "BUY" && takeProfitPrice <= entry) {
      throw new LifecycleValidationError("TP_SL_WRONG_SIDE", `long take-profit ${takeProfitPrice} must exceed entry ${entry}`);
    }
    if (req.side === "BUY" && stopLossPrice >= entry) {
      throw new LifecycleValidationError("TP_SL_WRONG_SIDE", `long stop-loss ${stopLossPrice} must sit below entry ${entry}`);
    }
    if (req.side === "SELL" && takeProfitPrice >= entry) {
      throw new LifecycleValidationError("TP_SL_WRONG_SIDE", `short take-profit ${takeProfitPrice} must sit below entry ${entry}`);
    }
    if (req.side === "SELL" && stopLossPrice <= entry) {
      throw new LifecycleValidationError("TP_SL_WRONG_SIDE", `short stop-loss ${stopLossPrice} must exceed entry ${entry}`);
    }
  }
}

/**
 * Trim a price to a tick-safe decimal string.
 *
 * Binary float artefacts such as "240.45000000000002" are functionally
 * acceptable to the venue but are noise in evidence and defeat exact string
 * comparison during reconciliation, so prices are rounded before they leave.
 */
export function formatPrice(v: number, dp = 6): string {
  if (!Number.isFinite(v)) throw new LifecycleValidationError("PRICE_NOT_FINITE", `price ${String(v)} is not finite`);
  return v.toFixed(dp).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Align a price DOWN to the venue's tick grid, or UP for an ask.
 *
 * Adopted from a market-maker implementation worth reviewing: it used
 * decimal.js with the venue's own priceDecimals to floor bids and ceil asks,
 * which is correct but pulls in a big dependency for two roundings. We already
 * fetch `pricePlace` / `volumePlace` from the contract config, so the grid is
 * applied without one.
 *
 * Rounding to the WRONG side is not cosmetic: a bid rounded up can cross the
 * ask and become a taker order, which is exactly the cost model this branch
 * exists to avoid.
 */
export function alignToTick(price: number, tickDecimals: number, side: "bid" | "ask"): number {
  if (!Number.isFinite(price)) {
    throw new LifecycleValidationError("PRICE_NOT_FINITE", `price ${String(price)} is not finite`);
  }
  const f = 10 ** Math.max(0, Math.trunc(tickDecimals));
  const ticks = price * f;
  const aligned = side === "bid" ? Math.floor(ticks) : Math.ceil(ticks);
  return aligned / f;
}

/** Align a size DOWN to the venue's lot grid. Never rounds UP: that would
 *  exceed the authorised notional cap. */
export function alignToLot(size: number, lotDecimals: number): number {
  if (!Number.isFinite(size)) {
    throw new LifecycleValidationError("SIZE_NOT_FINITE", `size ${String(size)} is not finite`);
  }
  const f = 10 ** Math.max(0, Math.trunc(lotDecimals));
  return Math.floor(size * f) / f;
}

function buildOrderBody(req: LifecycleOrderRequest, clientOid: string): Record<string, unknown> {
  const symbol = mapToVenueSymbol(req.symbol);
  const body: Record<string, unknown> = {
    symbol,
    productType: "USDT-FUTURES",
    marginMode: "isolated",
    marginCoin: "USDT",
    size: req.quantity.toString(),
    side: req.side.toLowerCase(),
    orderType: req.orderType,
    clientOid,
  };
  if (req.orderType === "limit" && req.limitPriceUsd !== undefined) {
    body["price"] = formatPrice(req.limitPriceUsd);
    body["timeInForce"] = "GTC";
  }
  // Venue-side presets, so they act without this process running.
  if (req.tpSl !== undefined) {
    body["takeProfit"] = { triggerPrice: formatPrice(req.tpSl.takeProfitPrice), orderType: "limit", timeInForce: "GTC" };
    body["stopLoss"] = { triggerPrice: formatPrice(req.tpSl.stopLossPrice), orderType: "limit", timeInForce: "GTC" };
  }
  // tradeSide presence is mutually exclusive with one_way (GAP-008 / venue 40774).
  if (req.positionMode === "hedge") {
    body["tradeSide"] = req.intent === "close" ? "close" : "open";
  }
  return body;
}

/**
 * Place an order, optionally a resting limit with TP/SL presets.
 *
 * Fails closed on validation errors before any venue call, and on a venue
 * error returns a REJECTED record rather than throwing.
 */
export async function placeOrderWithLifecycle(args: {
  receipt: SealedReasoningReceipt;
  request: LifecycleOrderRequest;
  client: LifecycleClient;
  mode: string;
}): Promise<LifecycleOrderResult> {
  assertReceiptAuthorisesAction(args.receipt, "place an order");
  const req = args.request;
  validateOrderRequest(req);

  if (typeof args.client.request !== "function") {
    throw new Error("Lifecycle client exposes no request method");
  }
  const clientOid = lifecycleClientOid({ receiptHash: args.receipt.receiptHash, intent: "place" });
  const body = buildOrderBody(req, clientOid);
  const symbol = mapToVenueSymbol(req.symbol);

  try {
    const res = await args.client.request!("POST", MIX_PLACE_ORDER_PATH, {}, true, body);
    const data = res.data as { orderId?: string } | null;
    if (String(res.code) !== "0" && String(res.code) !== "00000") {
      return {
        orderId: null,
        clientOid,
        symbol,
        orderType: req.orderType,
        limitPriceUsd: req.limitPriceUsd ?? null,
        takeProfitPrice: req.tpSl?.takeProfitPrice ?? null,
        stopLossPrice: req.tpSl?.stopLossPrice ?? null,
        status: "REJECTED",
        receiptHash: args.receipt.receiptHash,
        mode: args.mode,
        raw: res.raw,
        error: `venue code=${res.code} msg=${res.msg ?? "n/a"}`,
      };
    }
    return {
      orderId: typeof data?.orderId === "string" ? data.orderId : null,
      clientOid,
      symbol,
      orderType: req.orderType,
      limitPriceUsd: req.limitPriceUsd ?? null,
      takeProfitPrice: req.tpSl?.takeProfitPrice ?? null,
      stopLossPrice: req.tpSl?.stopLossPrice ?? null,
      status: "SUBMITTED",
      receiptHash: args.receipt.receiptHash,
      mode: args.mode,
      raw: res.raw,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      orderId: null,
      clientOid,
      symbol,
      orderType: req.orderType,
      limitPriceUsd: req.limitPriceUsd ?? null,
      takeProfitPrice: req.tpSl?.takeProfitPrice ?? null,
      stopLossPrice: req.tpSl?.stopLossPrice ?? null,
      status: "REJECTED",
      receiptHash: args.receipt.receiptHash,
      mode: args.mode,
      error: message,
    };
  }
}

/**
 * Cancel a resting order, behind the same receipt gate as placement.
 *
 * A cancel is a venue write, so it authorises exactly what placing does. The
 * clientOid is bound to the order being cancelled, so a cancel can never
 * collide with the placement that created it.
 */
export async function cancelOrder(args: {
  receipt: SealedReasoningReceipt;
  orderId: string;
  symbol: string;
  client: LifecycleClient;
  mode: string;
}): Promise<CancelResult> {
  assertReceiptAuthorisesAction(args.receipt, "cancel an order");
  if (typeof args.orderId !== "string" || args.orderId.length === 0) {
    throw new LifecycleValidationError("ORDER_ID_REQUIRED", "a cancel requires the orderId to cancel");
  }
  if (typeof args.client.request !== "function") {
    throw new Error("Lifecycle client exposes no request method");
  }
  const clientOid = lifecycleClientOid({
    receiptHash: args.receipt.receiptHash,
    intent: "cancel",
    orderId: args.orderId,
  });
  const symbol = mapToVenueSymbol(args.symbol);
  try {
    const res = await args.client.request("POST", MIX_CANCEL_ORDER_PATH, {}, true, {
      symbol,
      productType: "USDT-FUTURES",
      orderId: args.orderId,
      clientOid,
    });
    if (String(res.code) !== "0" && String(res.code) !== "00000") {
      return {
        status: "REJECTED",
        orderId: args.orderId,
        clientOid,
        symbol,
        receiptHash: args.receipt.receiptHash,
        raw: res.raw,
        error: `venue code=${res.code} msg=${res.msg ?? "n/a"}`,
      };
    }
    return {
      status: "CANCELLED",
      orderId: args.orderId,
      clientOid,
      symbol,
      receiptHash: args.receipt.receiptHash,
      raw: res.raw,
    };
  } catch (err) {
    return {
      status: "REJECTED",
      orderId: args.orderId,
      clientOid,
      symbol,
      receiptHash: args.receipt.receiptHash,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Read an order back from the venue.
 *
 * Existence of a read-back is what makes a cancel provable rather than
 * assumed: placing and cancelling without reading either back would prove
 * nothing about venue state.
 */
export async function readOrder(args: {
  symbol: string;
  orderId: string;
  client: LifecycleClient;
}): Promise<OrderReadBack | null> {
  if (typeof args.client.request !== "function") {
    throw new Error("Lifecycle client exposes no request method");
  }
  const res = await args.client.request(
    "GET",
    MIX_ORDER_STATUS_PATH,
    { symbol: mapToVenueSymbol(args.symbol), productType: "USDT-FUTURES", orderId: args.orderId },
    true,
  );
  const rows = (Array.isArray(res.data) ? res.data : res.data ? [res.data] : []) as Record<string, unknown>[];
  const row = rows.find((r) => String(r["orderId"] ?? "") === args.orderId) ?? rows[0];
  if (row === undefined) return null;
  const rawStatus = String(row["status"] ?? row["state"] ?? "UNKNOWN").toLowerCase();
  const status = rawStatus === "canceled" ? "cancelled" : rawStatus;
  const priceVal =
    row["price"] !== undefined && row["price"] !== null && row["price"] !== ""
      ? Number(row["price"])
      : row["priceAvg"] !== undefined && row["priceAvg"] !== null && row["priceAvg"] !== ""
      ? Number(row["priceAvg"])
      : null;
  return {
    orderId: String(row["orderId"] ?? args.orderId),
    symbol: String(row["symbol"] ?? mapToVenueSymbol(args.symbol)),
    status,
    orderType: String(row["orderType"] ?? "UNKNOWN"),
    price: priceVal,
    quantity: Number(row["baseVolume"] ?? row["size"] ?? 0),
    reduceOnly: String(row["reduceOnly"] ?? "NO") === "YES",
    raw: row,
  };
}

/**
 * Read position state back from the venue.
 *
 * The authoritative record of what is actually held. A fill response is never
 * treated as sufficient evidence of a position.
 */
export async function readPositions(args: {
  client: LifecycleClient;
  symbol: string;
}): Promise<{ total: number; flat: boolean; raw: unknown }> {
  if (typeof args.client.request !== "function") {
    throw new Error("Lifecycle client exposes no request method");
  }
  const res = await args.client.request(
    "GET",
    MIX_POSITION_PATH,
    { productType: "USDT-FUTURES", marginCoin: "USDT" },
    true,
  );
  const rows = (Array.isArray(res.data) ? res.data : res.data ? [res.data] : []) as Record<string, unknown>[];
  const wanted = mapToVenueSymbol(args.symbol);
  const row = rows.find((r) => String(r["symbol"] ?? "") === wanted);
  const total = row === undefined ? 0 : Number(row["total"] ?? 0);
  return { total, flat: total === 0, raw: res.raw };
}