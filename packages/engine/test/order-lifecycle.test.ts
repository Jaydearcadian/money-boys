import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cancelOrder,
  lifecycleClientOid,
  LifecycleValidationError,
  MIX_CANCEL_ORDER_PATH,
  MIX_ORDER_STATUS_PATH,
  MIX_PLACE_ORDER_PATH,
  MIX_POSITION_PATH,
  formatPrice,
  placeOrderWithLifecycle,
  readOrder,
  readPositions,
  validateOrderRequest,
  type LifecycleClient,
} from "../src/bitget/order-lifecycle.js";
import { sealReceipt, type SealedReasoningReceipt } from "../src/council/receipts.js";
import { StructuralChangeGuard, toBlastRadiusReport } from "../src/skills/igraph-guard/security.js";
import { evaluateBasisSpread } from "../src/agents/quant.js";

/**
 * GAP-012 — order lifecycle beyond open/close.
 *
 * The gap existed because every Stage 3 order used orderType=market, so
 * nothing rested, nothing could be cancelled, and no preset TP/SL was ever
 * exercised. These tests prove the missing operations exist, sit behind the
 * SAME receipt gate as placement, and fail closed before touching the venue.
 *
 * The client is a scripted double that COUNTS calls, so "refused without a
 * venue call" is observed rather than asserted.
 */

import * as lifecycleModule from "../src/bitget/order-lifecycle.js";

const SYMBOL = "rNVDAUSDT";
const VENUE = "NVDAUSDT";
const ENTRY = 229.0;

function receiptFor(decision: "APPROVED" | "VETOED" = "APPROVED"): SealedReasoningReceipt {
  const depth = {
    bids: Array.from({ length: 10 }, (_, i) => ({ price: ENTRY * (1 - 0.0002 * (i + 1)), quantity: 40 })),
    asks: Array.from({ length: 10 }, (_, i) => ({ price: ENTRY * (1 + 0.0002 * (i + 1)), quantity: 40 })),
  };
  const quant = evaluateBasisSpread({
    tokenPrice: ENTRY, tradFiClosePrice: ENTRY * 0.999, orderSizeUsd: 25, depth,
    fundingRate8h: 0, hoursToClose: 1, takerFee: 0.0006,
  });
  const blast = StructuralChangeGuard.evaluateBlastRadius(
    { symbol: VENUE, side: "buy", quantity: 0.1, priceUsd: ENTRY },
    { equityUsd: 9364.2, usedMarginUsd: 0, freeMarginUsd: 9364.2, openOrders: [] },
  );
  return sealReceipt({
    symbol: VENUE,
    action: quant.action,
    quantMetrics: quant,
    riskReport: toBlastRadiusReport(blast),
    councilScores: { compositeScore: 80, macro: 80, quant: 80, risk: 80, exec: 80 },
    decision: decision === "APPROVED" ? "APPROVED" : "VETOED",
    rationale: "lifecycle fixture",
  });
}

interface Call { method: string; path: string; body: unknown; auth: boolean }

function scriptedClient(responses: Record<string, unknown> = {}): { client: LifecycleClient; calls: Call[] } {
  const calls: Call[] = [];
  const client: LifecycleClient = {
    request: async (method, path, _query, auth, bodyObj) => {
      calls.push({ method, path, body: bodyObj, auth: auth === true });
      const byPath = responses[path];
      if (byPath !== undefined) return byPath as { code: string; data?: unknown };
      if (path === MIX_PLACE_ORDER_PATH) {
        return { code: "0", data: { orderId: "venue-order-1" }, raw: { orderId: "venue-order-1" } };
      }
      if (path === MIX_CANCEL_ORDER_PATH) return { code: "0", data: { orderId: "venue-order-1" }, raw: {} };
      return { code: "0", data: [], raw: {} };
    },
  };
  return { client, calls };
}

// ---------------------------------------------------------------------------
// Authentication on EVERY call
//
// The venue answers an unsigned call with 40006 "Invalid ACCESS_KEY", not
// with a schema error, so an auth mistake looks like a credential problem.
// These ran green for a full commit while readOrder/readPositions sent
// auth=false and could never have worked against the real venue. The guard
// is that every lifecycle call asserts auth === true, because a test double
// that ignores the flag cannot catch this class of defect.
// ---------------------------------------------------------------------------

describe("GAP-012 — every lifecycle call is authenticated", () => {
  it("authenticates the place-order write", async () => {
    const { client, calls } = scriptedClient();
    await placeOrderWithLifecycle({
      receipt: receiptFor(),
      request: { symbol: SYMBOL, side: "BUY", quantity: 1, orderType: "limit", limitPriceUsd: ENTRY },
      client, mode: "DEMO",
    });
    assert.deepEqual(calls.map((c) => c.auth), [true]);
  });

  it("authenticates the cancel-order write", async () => {
    const { client, calls } = scriptedClient();
    await cancelOrder({ receipt: receiptFor(), orderId: "o1", symbol: SYMBOL, client, mode: "DEMO" });
    assert.deepEqual(calls.map((c) => c.auth), [true]);
  });

  it("authenticates the order read-back", async () => {
    const { client, calls } = scriptedClient();
    await readOrder({ symbol: SYMBOL, orderId: "o1", client });
    assert.deepEqual(calls.map((c) => c.auth), [true]);
  });

  it("authenticates the position read-back", async () => {
    const { client, calls } = scriptedClient();
    await readPositions({ client, symbol: SYMBOL });
    assert.deepEqual(calls.map((c) => c.auth), [true]);
  });

  it("authenticates a full place -> read -> cancel -> read -> position cycle", async () => {
    const { client, calls } = scriptedClient();
    const placed = await placeOrderWithLifecycle({
      receipt: receiptFor(),
      request: { symbol: SYMBOL, side: "BUY", quantity: 1, orderType: "limit", limitPriceUsd: ENTRY },
      client, mode: "DEMO",
    });
    await readOrder({ symbol: SYMBOL, orderId: placed.orderId!, client });
    await cancelOrder({ receipt: receiptFor(), orderId: placed.orderId!, symbol: SYMBOL, client, mode: "DEMO" });
    await readOrder({ symbol: SYMBOL, orderId: placed.orderId!, client });
    await readPositions({ client, symbol: SYMBOL });
    const unsigned = calls.filter((c) => c.auth !== true);
    assert.equal(unsigned.length, 0, `unsigned lifecycle calls: ${JSON.stringify(unsigned)}`);
  });
});

// ---------------------------------------------------------------------------
// Validation before any network call
// ---------------------------------------------------------------------------

describe("GAP-012 — order request validation", () => {
  it("requires a price on a limit order", () => {
    assert.throws(
      () => validateOrderRequest({ symbol: SYMBOL, side: "BUY", quantity: 1, orderType: "limit" }),
      (e: unknown) => e instanceof LifecycleValidationError && e.code === "LIMIT_PRICE_REQUIRED",
    );
  });

  it("rejects a limit price on a market order", () => {
    assert.throws(
      () => validateOrderRequest({ symbol: SYMBOL, side: "BUY", quantity: 1, orderType: "market", limitPriceUsd: ENTRY }),
      (e: unknown) => e instanceof LifecycleValidationError && e.code === "LIMIT_PRICE_ON_MARKET",
    );
  });

  it("rejects a non-positive quantity", () => {
    assert.throws(
      () => validateOrderRequest({ symbol: SYMBOL, side: "BUY", quantity: 0, orderType: "market" }),
      (e: unknown) => e instanceof LifecycleValidationError && e.code === "QUANTITY_INVALID",
    );
  });

  it("refuses TP/SL on a market order, which has no reference price", () => {
    assert.throws(
      () => validateOrderRequest({
        symbol: SYMBOL, side: "BUY", quantity: 1, orderType: "market",
        tpSl: { takeProfitPrice: ENTRY * 1.1, stopLossPrice: ENTRY * 0.9 },
      }),
      (e: unknown) => e instanceof LifecycleValidationError && e.code === "TP_SL_REQUIRES_LIMIT",
    );
  });

  it("rejects long TP/SL on the wrong side of entry", () => {
    assert.throws(
      () => validateOrderRequest({
        symbol: SYMBOL, side: "BUY", quantity: 1, orderType: "limit", limitPriceUsd: ENTRY,
        tpSl: { takeProfitPrice: ENTRY * 0.95, stopLossPrice: ENTRY * 0.9 },
      }),
      (e: unknown) => e instanceof LifecycleValidationError && e.code === "TP_SL_WRONG_SIDE",
    );
    assert.throws(
      () => validateOrderRequest({
        symbol: SYMBOL, side: "BUY", quantity: 1, orderType: "limit", limitPriceUsd: ENTRY,
        tpSl: { takeProfitPrice: ENTRY * 1.1, stopLossPrice: ENTRY * 1.05 },
      }),
      (e: unknown) => e instanceof LifecycleValidationError && e.code === "TP_SL_WRONG_SIDE",
    );
  });

  it("rejects short TP/SL on the wrong side of entry", () => {
    assert.throws(
      () => validateOrderRequest({
        symbol: SYMBOL, side: "SELL", quantity: 1, orderType: "limit", limitPriceUsd: ENTRY,
        tpSl: { takeProfitPrice: ENTRY * 1.05, stopLossPrice: ENTRY * 1.1 },
      }),
      (e: unknown) => e instanceof LifecycleValidationError && e.code === "TP_SL_WRONG_SIDE",
    );
  });

  it("accepts a well-formed limit order with correct long TP/SL", () => {
    validateOrderRequest({
      symbol: SYMBOL, side: "BUY", quantity: 1, orderType: "limit", limitPriceUsd: ENTRY,
      tpSl: { takeProfitPrice: ENTRY * 1.05, stopLossPrice: ENTRY * 0.95 },
    });
  });
});

// ---------------------------------------------------------------------------
// Resting limit placement
// ---------------------------------------------------------------------------

describe("GAP-012 — resting limit placement", () => {
  it("submits a resting limit order to the place-order route", async () => {
    const { client, calls } = scriptedClient();
    const r = await placeOrderWithLifecycle({
      receipt: receiptFor(),
      request: { symbol: SYMBOL, side: "BUY", quantity: 0.1, orderType: "limit", limitPriceUsd: ENTRY },
      client, mode: "DEMO",
    });
    assert.equal(r.status, "SUBMITTED");
    assert.equal(r.orderId, "venue-order-1");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.path, MIX_PLACE_ORDER_PATH);
    const body = calls[0]!.body as Record<string, unknown>;
    assert.equal(body["orderType"], "limit");
    assert.equal(body["timeInForce"], "GTC");
    assert.equal(body["symbol"], VENUE);
  });

  it("attaches TP/SL as venue-side presets", async () => {
    const { client, calls } = scriptedClient();
    await placeOrderWithLifecycle({
      receipt: receiptFor(),
      request: {
        symbol: SYMBOL, side: "BUY", quantity: 0.1, orderType: "limit", limitPriceUsd: ENTRY,
        tpSl: { takeProfitPrice: ENTRY * 1.05, stopLossPrice: ENTRY * 0.95 },
      },
      client, mode: "DEMO",
    });
    const body = calls[0]!.body as Record<string, unknown>;
    const tp = body["takeProfit"] as { triggerPrice: string };
    const sl = body["stopLoss"] as { triggerPrice: string };
    // Tick-safe: no float artefacts reach the venue or the evidence.
    assert.equal(tp.triggerPrice, formatPrice(ENTRY * 1.05));
    assert.equal(sl.triggerPrice, formatPrice(ENTRY * 0.95));
    assert.ok(!tp.triggerPrice.includes("0000000"), "no binary float artefact may be sent");
  });

  it("omits tradeSide in one_way mode (venue 40774)", async () => {
    const { client, calls } = scriptedClient();
    await placeOrderWithLifecycle({
      receipt: receiptFor(),
      request: { symbol: SYMBOL, side: "BUY", quantity: 0.1, orderType: "limit", limitPriceUsd: ENTRY, positionMode: "one_way" },
      client, mode: "DEMO",
    });
    assert.equal("tradeSide" in (calls[0]!.body as Record<string, unknown>), false);
  });

  it("includes tradeSide in hedge mode", async () => {
    const { client, calls } = scriptedClient();
    await placeOrderWithLifecycle({
      receipt: receiptFor(),
      request: { symbol: SYMBOL, side: "SELL", quantity: 0.1, orderType: "limit", limitPriceUsd: ENTRY, positionMode: "hedge", intent: "close" },
      client, mode: "DEMO",
    });
    assert.equal((calls[0]!.body as Record<string, unknown>)["tradeSide"], "close");
  });

  it("fails closed on a venue error rather than throwing", async () => {
    const { client } = scriptedClient({
      [MIX_PLACE_ORDER_PATH]: { code: "40034", msg: "not tradable", raw: {} },
    });
    const r = await placeOrderWithLifecycle({
      receipt: receiptFor(),
      request: { symbol: SYMBOL, side: "BUY", quantity: 0.1, orderType: "limit", limitPriceUsd: ENTRY },
      client, mode: "DEMO",
    });
    assert.equal(r.status, "REJECTED");
    assert.match(r.error ?? "", /40034/);
  });

  it("makes ZERO venue calls when validation fails", async () => {
    const { client, calls } = scriptedClient();
    const r = await placeOrderWithLifecycle({
      receipt: receiptFor(),
      request: { symbol: SYMBOL, side: "BUY", quantity: 1, orderType: "limit" },
      client, mode: "DEMO",
    }).catch((e: unknown) => e);
    assert.equal(calls.length, 0, "an invalid request must not reach the venue");
    assert.ok(r instanceof LifecycleValidationError);
  });
});

// ---------------------------------------------------------------------------
// Cancel path — the same receipt gate
// ---------------------------------------------------------------------------

describe("GAP-012 — cancel path", () => {
  it("cancels a resting order through the cancel-order route", async () => {
    const { client, calls } = scriptedClient();
    const r = await cancelOrder({
      receipt: receiptFor(), orderId: "venue-order-1", symbol: SYMBOL, client, mode: "DEMO",
    });
    assert.equal(r.status, "CANCELLED");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.path, MIX_CANCEL_ORDER_PATH);
    assert.equal((calls[0]!.body as Record<string, unknown>)["orderId"], "venue-order-1");
  });

  it("refuses a VETOED receipt with zero venue calls", async () => {
    const { client, calls } = scriptedClient();
    await assert.rejects(
      cancelOrder({ receipt: receiptFor("VETOED"), orderId: "o1", symbol: SYMBOL, client, mode: "DEMO" }),
      /unapproved receipt/i,
    );
    assert.equal(calls.length, 0, "a vetoed receipt must authorise no venue write");
  });

  it("refuses a tampered receipt with zero venue calls", async () => {
    const { client, calls } = scriptedClient();
    const good = receiptFor();
    const tampered = { ...good, quantMetrics: { ...(good.quantMetrics as object), netEdgePct: 42 } } as SealedReasoningReceipt;
    await assert.rejects(
      cancelOrder({ receipt: tampered, orderId: "o1", symbol: SYMBOL, client, mode: "DEMO" }),
      /does not verify/i,
    );
    assert.equal(calls.length, 0);
  });

  it("refuses a cancel with no orderId", async () => {
    const { client, calls } = scriptedClient();
    await assert.rejects(
      cancelOrder({ receipt: receiptFor(), orderId: "", symbol: SYMBOL, client, mode: "DEMO" }),
      (e: unknown) => e instanceof LifecycleValidationError && e.code === "ORDER_ID_REQUIRED",
    );
    assert.equal(calls.length, 0);
  });

  it("fails closed when the venue refuses the cancel", async () => {
    const { client } = scriptedClient({
      [MIX_CANCEL_ORDER_PATH]: { code: "43017", msg: "order not found", raw: {} },
    });
    const r = await cancelOrder({ receipt: receiptFor(), orderId: "gone", symbol: SYMBOL, client, mode: "DEMO" });
    assert.equal(r.status, "REJECTED");
    assert.match(r.error ?? "", /43017/);
  });

  it("derives a different clientOid for cancel than for placement", () => {
    // The real 40786 collision: an order and its cancel must not share an id.
    const place = lifecycleClientOid({ receiptHash: "h".repeat(64), intent: "place" });
    const cancel = lifecycleClientOid({ receiptHash: "h".repeat(64), intent: "cancel", orderId: "o1" });
    assert.notEqual(place, cancel);
  });

  it("derives the same cancel id for a retry of the same cancel", () => {
    const a = lifecycleClientOid({ receiptHash: "h".repeat(64), intent: "cancel", orderId: "o1" });
    const b = lifecycleClientOid({ receiptHash: "h".repeat(64), intent: "cancel", orderId: "o1" });
    assert.equal(a, b, "a retry must be idempotent, not a new intent");
  });
});

// ---------------------------------------------------------------------------
// Read-back: place -> read -> cancel -> read
// ---------------------------------------------------------------------------

describe("GAP-012 — lifecycle read-back", () => {
  const RESTING = {
    [MIX_ORDER_STATUS_PATH]: {
      code: "0",
      data: [{ orderId: "venue-order-1", symbol: VENUE, status: "live", orderType: "limit", price: String(ENTRY), baseVolume: "0", reduceOnly: "NO" }],
      raw: {},
    },
  };

  it("reads a resting order back as live before cancelling it", async () => {
    const { client, calls } = scriptedClient(RESTING);
    const before = await readOrder({ symbol: SYMBOL, orderId: "venue-order-1", client });
    assert.ok(before !== null);
    assert.equal(before!.status, "live");
    assert.equal(before!.orderType, "limit");
    assert.equal(calls[0]!.path, MIX_ORDER_STATUS_PATH);
  });

  it("reads the order back as cancelled afterwards", async () => {
    const { client } = scriptedClient({
      [MIX_ORDER_STATUS_PATH]: {
        code: "0",
        data: [{ orderId: "venue-order-1", symbol: VENUE, status: "cancelled", orderType: "limit", price: String(ENTRY), baseVolume: "0", reduceOnly: "NO" }],
        raw: {},
      },
    });
    const after = await readOrder({ symbol: SYMBOL, orderId: "venue-order-1", client });
    assert.equal(after!.status, "cancelled");
  });

  it("returns null when the venue has no record of the order", async () => {
    const { client } = scriptedClient({ [MIX_ORDER_STATUS_PATH]: { code: "0", data: [], raw: {} } });
    assert.equal(await readOrder({ symbol: SYMBOL, orderId: "nope", client }), null);
  });

  it("reads position state back from the venue", async () => {
    const { client, calls } = scriptedClient({
      [MIX_POSITION_PATH]: { code: "0", data: [{ symbol: VENUE, total: "0.1" }], raw: {} },
    });
    const p = await readPositions({ client, symbol: SYMBOL });
    assert.equal(p.total, 0.1);
    assert.equal(p.flat, false);
    assert.equal(calls[0]!.path, MIX_POSITION_PATH);
  });

  it("treats an absent position as flat", async () => {
    const { client } = scriptedClient({ [MIX_POSITION_PATH]: { code: "0", data: [], raw: {} } });
    const p = await readPositions({ client, symbol: SYMBOL });
    assert.equal(p.total, 0);
    assert.equal(p.flat, true);
  });
});

// ---------------------------------------------------------------------------
// Boundary: this does NOT close GAP-012
// ---------------------------------------------------------------------------

describe("GAP-012 — what these tests do not prove", () => {
  it("uses a scripted client, so no venue was ever contacted", () => {
    // The gap's closure condition requires a resting limit placed, read back
    // and cancelled ON DEMO. That has not happened. These tests prove the code
    // path exists and fails closed; they are NOT live verification.
    assert.equal(scriptedClient().calls.length, 0);
  });

  it("exposes no funding-accrual reader, so nothing here claims settlement coverage", () => {
    // Also part of the closure condition and NOT covered here. There is
    // deliberately no funding reader, so no test can imply settlement coverage.
    assert.equal(typeof readPositions, "function");
    assert.equal("readFunding" in lifecycleModule, false);
  });
});