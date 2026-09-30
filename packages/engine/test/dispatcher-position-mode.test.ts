import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OrderDispatcher } from "../src/bitget/dispatcher.js";
import type { BitgetOrderClient } from "../src/bitget/dispatcher.js";
import { sealReceipt } from "../src/council/receipts.js";
import { evaluateBasisSpread } from "../src/agents/quant.js";

/**
 * Regression guard for GAP-008 (venue error 40774).
 *
 * Bitget v2 rejects a one-way order body against a hedge-mode account with
 * "The order type for unilateral position must also be the unilateral
 * position type", and rejects a hedge-mode body against a one-way account.
 * `tradeSide` presence is therefore mutually exclusive and must be driven by
 * an explicit positionMode, never inferred.
 */

function approvedReceipt() {
  const mid = 83_000;
  const depth = {
    bids: Array.from({ length: 10 }, (_, i) => ({
      price: mid * (1 - 0.0002 * (i + 1)),
      quantity: 0.28,
    })),
    asks: Array.from({ length: 10 }, (_, i) => ({
      price: mid * (1 + 0.0002 * (i + 1)),
      quantity: 0.28,
    })),
  };
  const quant = evaluateBasisSpread({
    tokenPrice: mid,
    tradFiClosePrice: 60_000,
    orderSizeUsd: 5_000,
    depth,
    fundingRate8h: 0.0001,
    hoursToClose: 8,
    takerFee: 0.0006,
  });
  return sealReceipt({
    symbol: "BTCUSDT",
    action: quant.action,
    quantMetrics: quant,
    riskReport: {
      permitted: true,
      projectedMarginUtilizationPct: 29.7,
      projectedLiquidationPrice: 81_000,
      staleOrdersToCancel: [],
    },
    councilScores: { compositeScore: 86, macro: 85, quant: 90, risk: 85, exec: 80 },
    decision: "APPROVED",
    rationale: "GAP-008 position-mode regression fixture.",
  });
}

/** Captures the request body the dispatcher would send to the venue. */
function captureClient(result: { code: string }) {
  const seen: Record<string, unknown>[] = [];
  const client: BitgetOrderClient = {
    request: async (
      _method: "GET" | "POST",
      _path: string,
      _query?: Record<string, string>,
      _auth?: boolean,
      body?: unknown,
    ) => {
      seen.push((body ?? {}) as Record<string, unknown>);
      return { code: result.code, msg: "success", data: { orderId: "1" }, raw: {} };
    },
  };
  return { client, seen };
}

describe("OrderDispatcher position mode (GAP-008 / venue 40774)", () => {
  it("omits tradeSide in one_way mode", async () => {
    const { client, seen } = captureClient({ code: "0" });
    const d = new OrderDispatcher("DEMO", client, "one_way");
    await d.dispatch(approvedReceipt(), {
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: 0.001,
      fillPriceUsd: 83_000,
    });
    assert.equal(seen.length, 1);
    assert.equal("tradeSide" in seen[0]!, false, "one_way must NOT send tradeSide");
  });

  it("sends tradeSide=open in hedge mode", async () => {
    const { client, seen } = captureClient({ code: "0" });
    const d = new OrderDispatcher("DEMO", client, "hedge");
    await d.dispatch(approvedReceipt(), {
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: 0.001,
      fillPriceUsd: 83_000,
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!["tradeSide"], "open", "hedge mode REQUIRES tradeSide");
  });

  it("never sends both/neither — the two modes are mutually exclusive", async () => {
    const modes = ["one_way", "hedge"] as const;
    const bodies: Record<string, unknown>[] = [];
    for (const m of modes) {
      const { client, seen } = captureClient({ code: "0" });
      const d = new OrderDispatcher("DEMO", client, m);
      await d.dispatch(approvedReceipt(), {
        symbol: "BTCUSDT",
        side: "SELL",
        quantity: 0.001,
        fillPriceUsd: 83_000,
      });
      bodies.push(seen[0]!);
    }
    assert.equal("tradeSide" in bodies[0]!, false);
    assert.equal("tradeSide" in bodies[1]!, true);
    // The two bodies must differ in exactly this one field.
    const diff = Object.keys({ ...bodies[0]!, ...bodies[1]! }).filter(
      (k) => bodies[0]![k] !== bodies[1]![k],
    );
    assert.deepEqual(diff, ["tradeSide"]);
  });

  it("defaults to one_way so the pre-existing request shape is unchanged", async () => {
    const { client, seen } = captureClient({ code: "0" });
    const d = new OrderDispatcher("DEMO", client);
    assert.equal(d.positionMode, "one_way");
    await d.dispatch(approvedReceipt(), {
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: 0.001,
      fillPriceUsd: 83_000,
    });
    assert.equal("tradeSide" in seen[0]!, false);
  });

  it("keeps the venue request shape otherwise identical", async () => {
    const { client, seen } = captureClient({ code: "0" });
    const receipt = approvedReceipt();
    const d = new OrderDispatcher("DEMO", client, "hedge");
    await d.dispatch(receipt, {
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: 0.001,
      fillPriceUsd: 83_000,
    });
    const body = seen[0]!;
    assert.equal(body["symbol"], "BTCUSDT");
    assert.equal(body["productType"], "USDT-FUTURES");
    assert.equal(body["marginMode"], "isolated");
    assert.equal(body["marginCoin"], "USDT");
    assert.equal(body["size"], "0.001");
    assert.equal(body["side"], "sell");
    assert.equal(body["orderType"], "market");
    assert.equal(body["clientOid"], receipt.receiptHash.slice(0, 32));
  });

  it("does not mutate PAPER-mode behaviour", async () => {
    const rec = await new OrderDispatcher("PAPER").dispatch(approvedReceipt(), {
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: 0.001,
      fillPriceUsd: 83_000,
    });
    assert.equal(rec.status, "FILLED");
    assert.match(rec.orderId, /^bg-paper-/);
  });
});
