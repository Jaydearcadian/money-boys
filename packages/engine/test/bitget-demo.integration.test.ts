import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BitgetClient } from "../src/bitget/client.js";
import { OrderDispatcher, DEMO_MIX_ORDER_PATH } from "../src/bitget/dispatcher.js";
import { sealReceipt } from "../src/council/receipts.js";
import { evaluateBasisSpread } from "../src/agents/quant.js";

/**
 * Bitget Demo integration (requires Demo API keys — skipped in default CI).
 *
 * Suite gate: skips automatically when BITGET_API_KEY, BITGET_SECRET_KEY,
 * or BITGET_PASSPHRASE are missing (no network, no spend).
 * Test 3 (live Demo order) is additionally gated behind LIVE_DEMO_RUN=1 so
 * default CI never spends margin even when read keys exist.
 */

const hasCreds = Boolean(
  process.env.BITGET_API_KEY &&
    process.env.BITGET_SECRET_KEY &&
    process.env.BITGET_PASSPHRASE,
);
const describeGated = hasCreds ? describe : describe.skip;
const itLiveOrder = process.env.LIVE_DEMO_RUN === "1" ? it : it.skip;

function fixedDepth(mid: number, availUsd = 24_000) {
  const perLevel = availUsd / 10;
  const bids = Array.from({ length: 10 }, (_, i) => ({
    price: mid * (1 - 0.0002 * (i + 1)),
    quantity: perLevel / mid,
  }));
  const asks = Array.from({ length: 10 }, (_, i) => ({
    price: mid * (1 + 0.0002 * (i + 1)),
    quantity: perLevel / mid,
  }));
  return { bids, asks };
}

function approvedFixture(symbol: string, mid: number) {
  const quant = evaluateBasisSpread({
    tokenPrice: mid,
    tradFiClosePrice: 60_000,
    orderSizeUsd: 5_000,
    depth: fixedDepth(mid),
    fundingRate8h: 0.0001,
    hoursToClose: 8,
    takerFee: 0.0006,
  });
  return sealReceipt({
    symbol,
    action: quant.action,
    quantMetrics: quant,
    riskReport: {
      permitted: true,
      projectedMarginUtilizationPct: 29.7,
      projectedLiquidationPrice: 50_000,
      staleOrdersToCancel: [],
    },
    councilScores: { compositeScore: 86, macro: 85, quant: 90, risk: 85, exec: 80 },
    decision: "APPROVED",
    rationale: "Demo integration fixture approval.",
  });
}

describeGated("bitget demo integration (credential-gated)", () => {
  it("Test 1 auth/asset check: GET /api/v2/spot/account/assets returns code 00000", async () => {
    const client = new BitgetClient({
      apiKey: process.env.BITGET_API_KEY!,
      secretKey: process.env.BITGET_SECRET_KEY!,
      passphrase: process.env.BITGET_PASSPHRASE!,
    });
    const res = await client.request("GET", "/api/v2/spot/account/assets", {}, true);
    assert.equal(String(res.code), "00000");
  });

  it("Test 2 fail-closed on bad ticker: unknown symbol throws (no silent snapshot)", async () => {
    const client = new BitgetClient({
      apiKey: process.env.BITGET_API_KEY!,
      secretKey: process.env.BITGET_SECRET_KEY!,
      passphrase: process.env.BITGET_PASSPHRASE!,
    });
    await assert.rejects(() => client.getTicker("___BAD_TICKER___"));
  });

  itLiveOrder(
    "Test 3 live Demo order: POST /api/v2/mix/order/place-order full cycle (LIVE_DEMO_RUN=1 only)",
    async () => {
      assert.equal(DEMO_MIX_ORDER_PATH, "/api/v2/mix/order/place-order");
      const client = new BitgetClient({
        apiKey: process.env.BITGET_API_KEY!,
        secretKey: process.env.BITGET_SECRET_KEY!,
        passphrase: process.env.BITGET_PASSPHRASE!,
      });
      // Venue sanity: Demo futures symbol/productType must exist before spending margin.
      const ticker = await client.getTicker("BTCUSDT");
      const fillPriceUsd = Number(ticker.lastPr);
      assert.ok(Number.isFinite(fillPriceUsd) && fillPriceUsd > 0);
      const receipt = approvedFixture("BTCUSDT", fillPriceUsd);
      const dispatcher = new OrderDispatcher("DEMO", client);
      const rec = await dispatcher.dispatch(receipt, {
        symbol: "BTCUSDT",
        side: "SELL",
        // Minimal Demo size: full cycle posts symbol/productType=USDT-FUTURES/
        // marginMode=isolated/marginCoin=USDT/size/side/orderType=market/
        // clientOid=receiptHash[0:32] via OrderDispatcher.
        quantity: 0.001,
        fillPriceUsd,
      });
      assert.equal(rec.clientOid, receipt.receiptHash.slice(0, 32));
      if (rec.status === "FILLED") {
        assert.ok(rec.orderId && !rec.orderId.includes("rejected"), rec.orderId);
      } else {
        // Venue error (e.g. 40017/40001) must surface as REJECTED + logged error.
        assert.equal(rec.status, "REJECTED");
        assert.ok(rec.error && rec.error.length > 0, "expected venue error message");
      }
    },
  );
});
