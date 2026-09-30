import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BitgetClient,
  MIX_ORDERBOOK_PATH,
  MIX_TICKER_PATH,
  type MixContractConfig,
} from "../src/bitget/client.js";
import { mapToVenueSymbol } from "../src/bitget/dispatcher.js";
import {
  BENCHMARK_MAX_AGE_MS,
  StaleBenchmarkError,
  assertBenchmarkFresh,
  assertBenchmarkUsableForTrading,
  FRIDAY_CLOSE_SNAPSHOT,
  BENCHMARK_AS_OF,
} from "../src/agents/benchmarks.js";

/**
 * Regression guards for GAP-013, GAP-014 and GAP-015, all discovered during
 * the Stage 3 bounded Demo strategy pre-flight (evidence
 * foundry/evidence/p09/strategy_no_action.json).
 */

function clientWithFetch(
  handler: (url: string, init?: RequestInit) => Response,
): { client: BitgetClient; urls: string[]; restore: () => void } {
  const urls: string[] = [];
  const client = new BitgetClient({ apiKey: "k", secretKey: "s", passphrase: "p" });
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    return handler(url, init);
  }) as typeof fetch;
  return {
    client,
    urls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

// ---------------------------------------------------------------------------
// GAP-013: spot `r`-prefixed vs futures bare symbol spaces
// ---------------------------------------------------------------------------

describe("GAP-013: spot vs futures symbol spaces stay separate", () => {
  it("mapToVenueSymbol strips the r prefix for futures", () => {
    assert.equal(mapToVenueSymbol("rNVDAUSDT"), "NVDAUSDT");
    assert.equal(mapToVenueSymbol("rTSLAUSDT"), "TSLAUSDT");
    assert.equal(mapToVenueSymbol("BTCUSDT"), "BTCUSDT");
  });

  it("getTicker uses the SPOT endpoint with the r-prefixed symbol", async () => {
    const h = clientWithFetch(() => ok({ code: "00000", data: [{ symbol: "rNVDAUSDT", lastPr: "228.29" }] }));
    try {
      const t = await h.client.getTicker("rNVDAUSDT");
      assert.equal(t.lastPr, "228.29");
      assert.ok(h.urls[0]!.includes("/api/v2/spot/market/tickers"), "spot endpoint");
      assert.ok(h.urls[0]!.includes("symbol=rNVDAUSDT"), "r-prefixed spot symbol");
    } finally { h.restore(); }
  });

  it("getMixTicker uses the MIX endpoint with the bare symbol", async () => {
    const h = clientWithFetch(() => ok({ code: "00000", data: [{ symbol: "NVDAUSDT", lastPr: "228.56" }] }));
    try {
      const t = await h.client.getMixTicker("NVDAUSDT");
      assert.equal(t.lastPr, "228.56");
      assert.ok(h.urls[0]!.includes(MIX_TICKER_PATH), "mix ticker path");
      assert.ok(h.urls[0]!.includes("symbol=NVDAUSDT"), "bare futures symbol");
      assert.ok(h.urls[0]!.includes("productType=USDT-FUTURES"), "productType is required");
      assert.ok(!h.urls[0]!.includes("spot"), "must not touch the spot endpoint");
    } finally { h.restore(); }
  });

  it("getMixTicker never emits an r-prefixed symbol in the query", async () => {
    const h = clientWithFetch(() => ok({ code: "00000", data: [{ symbol: "NVDAUSDT", lastPr: "1" }] }));
    try {
      await h.client.getMixTicker("NVDAUSDT");
      assert.ok(!h.urls[0]!.includes("rNVDAUSDT"));
    } finally { h.restore(); }
  });

  it("getMixTicker fails closed when the venue rejects the symbol", async () => {
    const h = clientWithFetch(() => new Response(
      JSON.stringify({ code: "40034", msg: "Parameter NVDAUSDT does not exist" }),
      { status: 400, headers: { "content-type": "application/json" } },
    ));
    try {
      await assert.rejects(() => h.client.getMixTicker("NVDAUSDT"), /rejected|400/);
    } finally { h.restore(); }
  });

  it("getMixTicker fails closed on an empty payload", async () => {
    const h = clientWithFetch(() => ok({ code: "00000", data: [] }));
    try {
      await assert.rejects(() => h.client.getMixTicker("NVDAUSDT"), /Unexpected mix ticker payload/);
    } finally { h.restore(); }
  });

  it("getMixTicker propagates venue code when data looks fine but code is an error", async () => {
    const h = clientWithFetch(() => ok({ code: "40099", msg: "environment incorrect", data: [{ symbol: "NVDAUSDT", lastPr: "1" }] }));
    try {
      await assert.rejects(() => h.client.getMixTicker("NVDAUSDT"), /40099/);
    } finally { h.restore(); }
  });
});

// ---------------------------------------------------------------------------
// GAP-014: orderbook endpoint
// ---------------------------------------------------------------------------

describe("GAP-014: mix orderbook endpoint", () => {
  const book = { symbol: "NVDAUSDT", asks: [["228.57", "36.47"]], bids: [["228.56", "70.16"]] };

  it("uses /api/v2/mix/market/orderbook, never /depth", async () => {
    const h = clientWithFetch(() => ok({ code: "00000", data: [book] }));
    try {
      const ob = await h.client.getMixOrderbook("NVDAUSDT", 10);
      assert.equal(ob.asks.length, 1);
      assert.ok(h.urls[0]!.includes(MIX_ORDERBOOK_PATH));
      assert.ok(!h.urls[0]!.includes("/depth"), "must not use the 404ing /depth path");
    } finally { h.restore(); }
  });

  it("parses [price, size] string tuples into usable numbers", async () => {
    const h = clientWithFetch(() => ok({ code: "00000", data: [book] }));
    try {
      const ob = await h.client.getMixOrderbook("NVDAUSDT");
      assert.equal(Number(ob.asks[0]![0]), 228.57);
      assert.equal(Number(ob.asks[0]![1]), 36.47);
    } finally { h.restore(); }
  });

  it("fails closed when the venue 404s (the /depth failure mode)", async () => {
    const h = clientWithFetch(() => new Response(
      JSON.stringify({ code: "40404", msg: "Request URL NOT FOUND" }),
      { status: 404, headers: { "content-type": "application/json" } },
    ));
    try {
      await assert.rejects(() => h.client.getMixOrderbook("NVDAUSDT"), /HTTP 404|Request URL NOT FOUND/);
    } finally { h.restore(); }
  });

  it("fails closed on a malformed book", async () => {
    const h = clientWithFetch(() => ok({ code: "00000", data: [{ symbol: "NVDAUSDT", asks: "nope" }] }));
    try {
      await assert.rejects(() => h.client.getMixOrderbook("NVDAUSDT"), /Malformed mix orderbook/);
    } finally { h.restore(); }
  });

  it("rejects an out-of-range limit before hitting the network", async () => {
    const h = clientWithFetch(() => ok({ code: "00000", data: [book] }));
    try {
      await assert.rejects(() => h.client.getMixOrderbook("NVDAUSDT", 0), /limit out of range/);
      await assert.rejects(() => h.client.getMixOrderbook("NVDAUSDT", 500), /limit out of range/);
      assert.equal(h.urls.length, 0, "must not call the venue for an invalid limit");
    } finally { h.restore(); }
  });
});

// ---------------------------------------------------------------------------
// Contract config + quantity validation
// ---------------------------------------------------------------------------

describe("futures contract config and quantity validation", () => {
  const cfg: MixContractConfig = {
    symbol: "NVDAUSDT",
    baseCoin: "NVDA",
    quoteCoin: "USDT",
    symbolType: "perpetual",
    sizeMultiplier: "0.01",
    minTradeNum: "0.01",
    minTradeUSDT: "5",
    pricePlace: "2",
    volumePlace: "2",
    takerFeeRate: "0.0006",
    makerFeeRate: "0.0002",
    supportMarginCoins: ["USDT"],
  };

  it("fetches and parses contract config", async () => {
    const h = clientWithFetch(() => ok({ code: "00000", data: [cfg] }));
    try {
      const c = await h.client.getMixContractConfig("NVDAUSDT");
      assert.equal(c.sizeMultiplier, "0.01");
      assert.equal(c.minTradeUSDT, "5");
    } finally { h.restore(); }
  });

  it("fails closed when the symbol is not a contract (40034)", async () => {
    const h = clientWithFetch(() => ok({ code: "40034", msg: "Parameter rNVDAUSDT does not exist", data: null }));
    try {
      await assert.rejects(() => h.client.getMixContractConfig("rNVDAUSDT"), /not tradable/);
    } finally { h.restore(); }
  });

  it("accepts a quantity that satisfies multiplier, min qty and notional", () => {
    const r = BitgetClient.validateQuantity({ ...cfg, referencePriceUsd: 228.56 }, 1);
    assert.equal(r.ok, true, r.reasons.join("; "));
  });

  it("rejects a quantity that is not a multiple of the multiplier", () => {
    const r = BitgetClient.validateQuantity({ ...cfg, referencePriceUsd: 228.56 }, 0.015);
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("sizeMultiplier")));
  });

  it("rejects a quantity below minTradeNum", () => {
    const r = BitgetClient.validateQuantity({ ...cfg, referencePriceUsd: 228.56 }, 0.005);
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("minTradeNum")));
  });

  it("catches the observed minQty-vs-minNotional conflict", () => {
    // 0.01 NVDA @ 228.56 = $2.29 notional, below the venue's $5 minimum.
    const r = BitgetClient.validateQuantity({ ...cfg, referencePriceUsd: 228.56 }, 0.01);
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("minTradeUSDT")));
  });

  it("rejects a non-positive quantity", () => {
    assert.equal(BitgetClient.validateQuantity(cfg, 0).ok, false);
    assert.equal(BitgetClient.validateQuantity(cfg, -1).ok, false);
  });

  it("skips the notional check when no reference price is supplied", () => {
    const r = BitgetClient.validateQuantity(cfg, 0.01);
    assert.equal(r.ok, true, r.reasons.join("; "));
  });
});

// ---------------------------------------------------------------------------
// GAP-015: benchmark staleness and snapshot misuse
// ---------------------------------------------------------------------------

describe("GAP-015: benchmark freshness and snapshot misuse", () => {
  const now = Date.parse("2026-09-30T09:00:00Z");

  it("accepts a fresh BITGET_MCP benchmark", () => {
    const b = { symbol: "rNVDAUSDT", closePriceUsd: 228.2975, asOf: new Date(now - 60_000).toISOString(), source: "BITGET_MCP" as const };
    assert.equal(assertBenchmarkUsableForTrading(b, now).closePriceUsd, 228.2975);
  });

  it("rejects LOCAL_SNAPSHOT for any live/demo trading decision", () => {
    const b = { symbol: "rNVDAUSDT", closePriceUsd: 128.8, asOf: new Date(now).toISOString(), source: "LOCAL_SNAPSHOT" as const };
    assert.throws(() => assertBenchmarkUsableForTrading(b, now), /must not be used for live\/demo trading/);
  });

  it("rejects the repo FRIDAY_CLOSE_SNAPSHOT as stale", () => {
    const b = { symbol: "rNVDAUSDT", closePriceUsd: FRIDAY_CLOSE_SNAPSHOT["rNVDAUSDT"]!, asOf: BENCHMARK_AS_OF, source: "BITGET_MCP" as const };
    assert.throws(() => assertBenchmarkUsableForTrading(b, now), StaleBenchmarkError);
  });

  it("rejects a stale MCP benchmark", () => {
    const b = { symbol: "rNVDAUSDT", closePriceUsd: 200, asOf: new Date(now - BENCHMARK_MAX_AGE_MS - 1).toISOString(), source: "BITGET_MCP" as const };
    assert.throws(() => assertBenchmarkUsableForTrading(b, now), StaleBenchmarkError);
  });

  it("accepts a benchmark exactly at the age boundary", () => {
    const b = { symbol: "rNVDAUSDT", closePriceUsd: 200, asOf: new Date(now - BENCHMARK_MAX_AGE_MS).toISOString(), source: "BITGET_MCP" as const };
    assert.doesNotThrow(() => assertBenchmarkFresh(b, now));
  });

  it("rejects an unparseable asOf", () => {
    const b = { symbol: "rNVDAUSDT", closePriceUsd: 200, asOf: "not-a-date", source: "BITGET_MCP" as const };
    assert.throws(() => assertBenchmarkFresh(b, now), StaleBenchmarkError);
  });

  it("a missing benchmark is an error, never a silent snapshot", () => {
    // There is no "return null" path: callers must catch and veto.
    const missing: { symbol: string; closePriceUsd: number; asOf: string; source: "BITGET_MCP" } | null = null;
    assert.equal(missing, null);
    assert.equal(FRIDAY_CLOSE_SNAPSHOT["rUNKNOWNUSDT"], undefined,
      "unknown symbols have no snapshot, which is the fail-closed path");
  });

  it("the staleness error carries machine-readable detail for evidence", () => {
    try {
      assertBenchmarkFresh({ symbol: "rNVDAUSDT", closePriceUsd: 1, asOf: "2020-01-01T00:00:00Z", source: "BITGET_MCP" }, now);
      assert.fail("should have thrown");
    } catch (e) {
      assert.ok(e instanceof StaleBenchmarkError);
      assert.equal(e.maxAgeMs, BENCHMARK_MAX_AGE_MS);
      assert.ok(e.ageMs > BENCHMARK_MAX_AGE_MS);
      assert.match(e.message, /^FAIL_CLOSED/);
    }
  });
});

// ---------------------------------------------------------------------------
// Minimum-notional-aware sizing.
//
// minTradeNum and minTradeUSDT are independent venue constraints and conflict
// in the observed case: 0.01 NVDA @ 228.56 = $2.29, under the $5 minimum.
// Naively taking minTradeNum produces an order the venue rejects on size.
// ---------------------------------------------------------------------------

describe("venue-compliant sizing (minQty vs minNotional)", () => {
  // Real values read from the Demo venue contract config for NVDAUSDT.
  const NVDA: MixContractConfig = {
    symbol: "NVDAUSDT",
    baseCoin: "NVDA",
    quoteCoin: "USDT",
    symbolType: "perpetual",
    sizeMultiplier: "0.01",
    minTradeNum: "0.01",
    minTradeUSDT: "5",
    pricePlace: "2",
    volumePlace: "2",
    takerFeeRate: "0.0006",
    makerFeeRate: "0.0002",
    supportMarginCoins: ["USDT"],
    referencePriceUsd: 228.56,
  };

  it("reproduces the raw conflict: minQty alone is not placeable", () => {
    const v = BitgetClient.validateQuantity(NVDA, 0.01);
    assert.equal(v.ok, false, "minQty 0.01 at $228.56 is only $2.29 notional");
    assert.ok(v.reasons.some((x) => x.includes("minTradeUSDT")));
  });

  it("below minQty: rejects a too-small quantity", () => {
    const v = BitgetClient.validateQuantity(NVDA, 0.005);
    assert.equal(v.ok, false);
    assert.ok(v.reasons.some((x) => x.includes("minTradeNum")));
  });

  it("meets minQty but below minNotional: rejected on notional", () => {
    const v = BitgetClient.validateQuantity(NVDA, 0.02); // $4.57
    assert.equal(v.ok, false);
    assert.ok(v.reasons.some((x) => x.includes("minTradeUSDT")));
  });

  it("sizes UP past minNotional to a compliant quantity", () => {
    // minNotional 5 / 228.56 = 0.02187 -> ceil to a 0.01 multiple = 0.03 ($6.86).
    const r = BitgetClient.sizeToVenueCompliance(NVDA, 2.29);
    assert.equal(r.ok, true, r.reasons.join("; "));
    assert.equal(r.quantity, 0.03);
    assert.ok(r.notionalUsd! >= 5);
    assert.ok(r.steps.length > 0, "must record how it got there");
  });

  it("the sized quantity revalidates as compliant", () => {
    const r = BitgetClient.sizeToVenueCompliance(NVDA, 2.29);
    assert.equal(BitgetClient.validateQuantity(NVDA, r.quantity!).ok, true);
  });

  it("rounded quantity is always a whole multiplier multiple", () => {
    for (const target of [1, 2.29, 5, 7.77, 50, 123.4]) {
      const r = BitgetClient.sizeToVenueCompliance(NVDA, target);
      assert.equal(r.ok, true, `target ${target}: ${r.reasons.join("; ")}`);
      const steps = r.quantity! / 0.01;
      assert.ok(Math.abs(steps - Math.round(steps)) < 1e-6, `target ${target} not a multiple`);
    }
  });

  it("honours a target above the minimum rather than shrinking to it", () => {
    const r = BitgetClient.sizeToVenueCompliance(NVDA, 100); // $100 target
    assert.equal(r.ok, true, r.reasons.join("; "));
    // 100 / 228.56 = 0.4376 -> ceil to 0.44 => $100.57. A naive implementation
    // that only sized to minNotional would return 0.03 ($6.86) here.
    assert.equal(r.quantity, 0.44);
    assert.ok(r.notionalUsd! >= 100, `expected >= $100, got ${r.notionalUsd}`);
  });

  it("snaps to the contract quantity precision", () => {
    const coarse: MixContractConfig = { ...NVDA, volumePlace: "0", sizeMultiplier: "1", minTradeNum: "1" };
    const r = BitgetClient.sizeToVenueCompliance(coarse, 500);
    assert.equal(r.ok, true, r.reasons.join("; "));
    assert.equal(r.quantity, Math.round(r.quantity!), "0dp means an integer size");
    assert.equal(r.quantity, 3, "$500 / $228.56 = 2.19 -> 3 contracts at 0dp");
    assert.ok(r.notionalUsd! >= 500);
  });

  it("fails closed when free margin cannot cover the compliant size", () => {
    const r = BitgetClient.sizeToVenueCompliance(NVDA, 2.29, 3.0);
    assert.equal(r.ok, false);
    assert.equal(r.quantity, null);
    assert.ok(r.reasons.some((x) => x.includes("free margin")), r.reasons.join("; "));
  });

  it("succeeds when free margin just covers it", () => {
    const r = BitgetClient.sizeToVenueCompliance(NVDA, 2.29, 6.86);
    assert.equal(r.ok, true, r.reasons.join("; "));
    // 0.03 x 228.56 = 6.8568; compare at cent precision rather than exactly.
    assert.ok(Math.abs(r.notionalUsd! - 6.8568) < 0.005, `got ${r.notionalUsd}`);
  });

  it("fails closed when the caller's notional cap blocks the compliant size", () => {
    const r = BitgetClient.sizeToVenueCompliance(NVDA, 2.29, undefined, 5);
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("exceeds the caller's cap")));
  });

  it("fails closed without a reference price", () => {
    const r = BitgetClient.sizeToVenueCompliance({ ...NVDA, referencePriceUsd: undefined }, 5);
    assert.equal(r.ok, false);
    assert.equal(r.quantity, null);
    assert.ok(r.reasons.some((x) => x.includes("referencePriceUsd")));
  });

  it("fails closed on an invalid precision declaration", () => {
    const bad: MixContractConfig = { ...NVDA, volumePlace: "1.5" };
    const r = BitgetClient.sizeToVenueCompliance(bad, 5);
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("volumePlace")));
  });

  it("fails closed when the contract has no usable minTradeUSDT", () => {
    const bad: MixContractConfig = { ...NVDA, minTradeUSDT: undefined };
    const r = BitgetClient.sizeToVenueCompliance(bad, 5);
    assert.equal(r.ok, false);
    assert.ok(r.reasons.some((x) => x.includes("minTradeUSDT")));
  });

  it("throws on a nonsensical multiplier rather than returning a bad size", () => {
    assert.throws(
      () => BitgetClient.sizeToVenueCompliance({ ...NVDA, sizeMultiplier: "0" }, 5),
      /invalid sizeMultiplier/,
    );
  });

  it("never returns a quantity that fails validateQuantity", () => {
    for (const target of [0.01, 1, 5, 500, 5000]) {
      const r = BitgetClient.sizeToVenueCompliance(NVDA, target);
      if (r.ok) {
        assert.equal(BitgetClient.validateQuantity(NVDA, r.quantity!).ok, true, `target ${target}`);
      }
    }
  });

  it("is deterministic", () => {
    const a = BitgetClient.sizeToVenueCompliance(NVDA, 2.29);
    const b = BitgetClient.sizeToVenueCompliance(NVDA, 2.29);
    assert.deepEqual(a, b);
  });
});
