import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BENCHMARK_PROVIDER,
  BenchmarkSourceError,
  fetchRobinhoodBenchmark,
  parseBenchmarkQuote,
  toUnderlyingReferenceSymbol,
  type FetchLike,
} from "../src/integrations/robinhood/benchmark.js";
import { TIMESTAMP_TYPE_PROVIDER_QUOTE } from "../src/integrations/robinhood/schemas.js";
import { robinhoodToEvidence } from "../src/bitget/strategy-packet.js";

/**
 * Fixtures derive from a real captured public payload:
 *   GET https://api.robinhood.com/rhj/prices/NVDA  -> HTTP 200
 *   generatedAt 2026-09-30T11:05:44.407540216Z, bid 227.69, ask 227.85,
 *   isTradingHalt false, currency USD
 *   GET https://api.robinhood.com/rhj/assets       -> NVDA ASSET_STATUS_ACTIVE,
 *   currentMultiplier 1.000775159164630595
 * No credentials are involved; the endpoints are public.
 */

const GENERATED_AT = "2026-09-30T11:05:44.407540216Z";
const FETCHED_AT = "2026-09-30T11:06:02.788272Z";

const quoteFixture = (over: Record<string, unknown> = {}) => ({
  tokenSymbol: "NVDA",
  deployments: [{ contractAddress: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", chainId: 4663 }],
  bid: "227.69",
  ask: "227.85",
  currency: "USD",
  dailyTradingVolume: "578572",
  isTradingHalt: false,
  generatedAt: GENERATED_AT,
  ...over,
});

const assetFixture = (over: Record<string, unknown> = {}) => ({
  id: "0x00000000000000000000000000000000915f477416294f5099a5e0e09f327ce5",
  tokenSymbol: "NVDA",
  tokenName: "NVIDIA • Robinhood Token",
  deployments: [{ contractAddress: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", chainId: 4663 }],
  currentMultiplier: "1.000775159164630595",
  pendingMultiplier: "",
  status: "ASSET_STATUS_ACTIVE",
  tradingCapabilities: {
    market: { whole: "TRADING_STATUS_TRADABLE", fractional: "TRADING_STATUS_TRADABLE" },
    extended: { whole: "TRADING_STATUS_TRADABLE", fractional: "TRADING_STATUS_TRADABLE" },
    overnight: { whole: "TRADING_STATUS_TRADABLE", fractional: "TRADING_STATUS_TRADABLE" },
  },
  tokenDecimals: 18,
  isin: "US67066G1040",
  ...over,
});

/** Serves the two documented endpoints from fixtures. No network. */
function fixtureFetch(overrides: {
  quotes?: unknown;
  assets?: unknown;
  quoteStatus?: number;
} = {}): FetchLike {
  return (async (url: string) => {
    if (url.includes("/rhj/prices/")) {
      const status = overrides.quoteStatus ?? 200;
      if (status !== 200) return { ok: false, status, json: async () => ({}) };
      return {
        ok: true,
        status,
        json: async () => (overrides.quotes ?? { quotes: [quoteFixture()] }),
      };
    }
    if (url.includes("/rhj/assets")) {
      return {
        ok: true,
        status: 200,
        json: async () => (overrides.assets ?? { assets: [assetFixture()] }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }) as FetchLike;
}

const SOURCE_URL = "https://api.robinhood.com/rhj/prices/NVDA";
const MAX_AGE = 96 * 60 * 60 * 1000;

describe("robinhood benchmark adapter", () => {
  it("1. valid generatedAt yields a usable benchmark", async () => {
    const b = await fetchRobinhoodBenchmark({
      symbol: "NVDA", fetchImpl: fixtureFetch(), fetchedAt: FETCHED_AT,
    });
    assert.equal(b.provider, BENCHMARK_PROVIDER);
    assert.equal(b.symbol, "NVDA");
    assert.equal(b.bid, 227.69);
    assert.equal(b.ask, 227.85);
    assert.equal(b.midpoint, 227.77);
    assert.equal(b.currency, "USD");
    assert.equal(b.timestampType, TIMESTAMP_TYPE_PROVIDER_QUOTE);
    assert.equal(b.cacheWindowMs, 15_000);
    assert.equal(b.isTradingHalt, false);
    assert.equal(b.sourceUrl, SOURCE_URL);
  });

  it("2. missing generatedAt fails closed", () => {
    const q = quoteFixture();
    delete (q as Record<string, unknown>).generatedAt;
    assert.throws(
      () => parseBenchmarkQuote({ quote: q as never, expectedSymbol: "NVDA", fetchedAt: FETCHED_AT, sourceUrl: SOURCE_URL }),
      (e: unknown) => e instanceof BenchmarkSourceError && /generatedAt|shape/i.test(e.message),
    );
  });

  it("3. malformed generatedAt fails closed", async () => {
    await assert.rejects(
      fetchRobinhoodBenchmark({
        symbol: "NVDA", fetchImpl: fixtureFetch({ quotes: { quotes: [quoteFixture({ generatedAt: "not-a-date" })] } }),
        fetchedAt: FETCHED_AT,
      }),
      (e: unknown) => e instanceof BenchmarkSourceError && e.code === "MALFORMED_GENERATED_AT",
    );
  });

  it("4. stale generatedAt is classified stale, not fresh", async () => {
    const staleAt = new Date(Date.parse(FETCHED_AT) - MAX_AGE - 60_000).toISOString();
    const b = await fetchRobinhoodBenchmark({
      symbol: "NVDA", fetchImpl: fixtureFetch({ quotes: { quotes: [quoteFixture({ generatedAt: staleAt })] } }),
      fetchedAt: FETCHED_AT,
    });
    const e = robinhoodToEvidence(b, MAX_AGE);
    assert.equal(e.freshness, "verified_stale");
  });

  it("5. fetchedAt is distinct from sourceAsOf", async () => {
    const b = await fetchRobinhoodBenchmark({ symbol: "NVDA", fetchImpl: fixtureFetch(), fetchedAt: FETCHED_AT });
    assert.equal(b.sourceAsOf, GENERATED_AT, "sourceAsOf must be the provider value verbatim");
    assert.equal(b.fetchedAt, FETCHED_AT);
    assert.notEqual(b.sourceAsOf, b.fetchedAt);
  });

  it("6. invalid bid/ask fails closed", async () => {
    for (const over of [{ bid: "0" }, { ask: "0" }, { bid: "-1" }, { ask: "-5" }, { bid: "abc" }]) {
      await assert.rejects(
        fetchRobinhoodBenchmark({
          symbol: "NVDA", fetchImpl: fixtureFetch({ quotes: { quotes: [quoteFixture(over)] } }),
          fetchedAt: FETCHED_AT,
        }),
        (e: unknown) => e instanceof BenchmarkSourceError &&
          /NON_POSITIVE_PRICE|MALFORMED_PRICE|SHAPE_DRIFT/.test(e.message),
        JSON.stringify(over),
      );
    }
  });

  it("6b. a crossed quote fails closed", async () => {
    await assert.rejects(
      fetchRobinhoodBenchmark({
        symbol: "NVDA", fetchImpl: fixtureFetch({ quotes: { quotes: [quoteFixture({ bid: "300", ask: "200" })] } }),
        fetchedAt: FETCHED_AT,
      }),
      (e: unknown) => e instanceof BenchmarkSourceError && e.code === "CROSSED_QUOTE",
    );
  });

  it("7. trading halt fails closed", async () => {
    await assert.rejects(
      fetchRobinhoodBenchmark({
        symbol: "NVDA", fetchImpl: fixtureFetch({ quotes: { quotes: [quoteFixture({ isTradingHalt: true })] } }),
        fetchedAt: FETCHED_AT,
      }),
      (e: unknown) => e instanceof BenchmarkSourceError && e.code === "TRADING_HALT",
    );
  });

  it("8. symbol mapping resolves the underlying reference", () => {
    assert.equal(toUnderlyingReferenceSymbol("rNVDAUSDT"), "NVDA");
    assert.equal(toUnderlyingReferenceSymbol("rTSLAUSDT"), "TSLA");
    assert.equal(toUnderlyingReferenceSymbol("rAAPLUSDT"), "AAPL");
    assert.equal(toUnderlyingReferenceSymbol("NVDAUSDT"), "NVDAUSDT");
  });

  it("8b. a symbol mismatch fails closed", async () => {
    await assert.rejects(
      fetchRobinhoodBenchmark({
        symbol: "NVDA", fetchImpl: fixtureFetch({ quotes: { quotes: [quoteFixture({ tokenSymbol: "TSLA" })] } }),
        fetchedAt: FETCHED_AT,
      }),
      (e: unknown) => e instanceof BenchmarkSourceError && e.code === "SYMBOL_NOT_RETURNED",
    );
  });

  it("8c. an inactive asset fails closed", async () => {
    await assert.rejects(
      fetchRobinhoodBenchmark({
        symbol: "NVDA", fetchImpl: fixtureFetch({ assets: { assets: [assetFixture({ status: "ASSET_STATUS_INACTIVE" })] } }),
        fetchedAt: FETCHED_AT,
      }),
      (e: unknown) => e instanceof BenchmarkSourceError && e.code === "ASSET_INACTIVE",
    );
  });

  it("9. the multiplier is metadata only and never applied to the price", async () => {
    const b = await fetchRobinhoodBenchmark({ symbol: "NVDA", fetchImpl: fixtureFetch(), fetchedAt: FETCHED_AT });
    assert.equal(b.priceBasis, "RAW_UNDERLYING_EQUITY_NOT_MULTIPLIER_ADJUSTED");
    assert.equal(b.multiplierMetadata.currentMultiplier, "1.000775159164630595");
    assert.equal(b.multiplierMetadata.appliedToPrice, false);
    // The price must be the raw midpoint, NOT midpoint * multiplier.
    const m = Number(b.multiplierMetadata.currentMultiplier);
    assert.notEqual(b.midpoint, Number((b.midpoint * m).toFixed(6)));
    assert.equal(b.midpoint, 227.77);
  });

  it("10. response shape drift fails closed", async () => {
    for (const bad of [{}, { quotes: "nope" }, { quotes: [{ tokenSymbol: "NVDA" }] }, []]) {
      await assert.rejects(
        fetchRobinhoodBenchmark({
          symbol: "NVDA", fetchImpl: fixtureFetch({ quotes: bad }), fetchedAt: FETCHED_AT,
        }),
        BenchmarkSourceError,
        JSON.stringify(bad),
      );
    }
  });

  it("10b. an HTTP error fails closed", async () => {
    await assert.rejects(
      fetchRobinhoodBenchmark({
        symbol: "NVDA", fetchImpl: fixtureFetch({ quoteStatus: 503 }), fetchedAt: FETCHED_AT,
      }),
      (e: unknown) => e instanceof BenchmarkSourceError && e.code === "HTTP",
    );
  });

  it("10c. an empty quotes array fails closed", async () => {
    await assert.rejects(
      fetchRobinhoodBenchmark({
        symbol: "NVDA", fetchImpl: fixtureFetch({ quotes: { quotes: [] } }), fetchedAt: FETCHED_AT,
      }),
      (e: unknown) => e instanceof BenchmarkSourceError && e.code === "EMPTY_QUOTES",
    );
  });

  it("tolerates undocumented extra fields without weakening validation", async () => {
    const b = await fetchRobinhoodBenchmark({
      symbol: "NVDA",
      fetchImpl: fixtureFetch({
        quotes: { quotes: [quoteFixture({ dailyHigh: "228.91", tokenBid: "227.866495990194740176", somethingNew: 1 })] },
      }),
      fetchedAt: FETCHED_AT,
    });
    assert.equal(b.midpoint, 227.77);
  });
});

describe("robinhood -> BenchmarkEvidence bridge", () => {
  it("a fresh provider quote becomes verified_fresh", async () => {
    const b = await fetchRobinhoodBenchmark({ symbol: "NVDA", fetchImpl: fixtureFetch(), fetchedAt: FETCHED_AT });
    const e = robinhoodToEvidence(b, MAX_AGE);
    assert.equal(e.freshness, "verified_fresh");
    assert.equal(e.sourceAsOf, GENERATED_AT);
    assert.equal(e.fetchedAt, FETCHED_AT);
    assert.equal(e.provider, BENCHMARK_PROVIDER);
    assert.ok(e.ageMs! > 0 && e.ageMs! < 60_000);
    assert.match(e.notes, /PROVIDER_GENERATED_QUOTE/);
    assert.match(e.notes, /not an exchange trade time/);
  });

  it("a future provider instant is unverifiable, never fresh", async () => {
    const future = new Date(Date.parse(FETCHED_AT) + 120_000).toISOString();
    const b = await fetchRobinhoodBenchmark({
      symbol: "NVDA", fetchImpl: fixtureFetch({ quotes: { quotes: [quoteFixture({ generatedAt: future })] } }),
      fetchedAt: FETCHED_AT,
    });
    assert.equal(robinhoodToEvidence(b, MAX_AGE).freshness, "unverifiable");
  });
});

// ---------------------------------------------------------------------------
// The benchmark gate through the REAL packet path (Stages 3 and 5).
//
// A failing Robinhood benchmark must stop the packet BEFORE Quant Boy runs.
// ---------------------------------------------------------------------------

const ACCOUNT = { equityUsd: 9364.2, freeMarginUsd: 9364.2 };

import { buildPacket, resolveSizing } from "../src/bitget/strategy-packet.js";
import { evaluateBasisSpread } from "../src/agents/quant.js";
type MixContractConfig = import("../src/bitget/client.js").MixContractConfig;

const NVDA: MixContractConfig = {
  symbol: "NVDAUSDT", baseCoin: "NVDA", quoteCoin: "USDT", symbolType: "perpetual",
  sizeMultiplier: "0.01", minTradeNum: "0.01", minTradeUSDT: "5",
  pricePlace: "2", volumePlace: "2", takerFeeRate: "0.0006", makerFeeRate: "0.0002",
  supportMarginCoins: ["USDT"], referencePriceUsd: 227.8,
};

const quantFor = (benchPrice: number) => {
    const mid = 227.8;
    const depth = {
      bids: Array.from({ length: 10 }, (_, i) => ({ price: mid * (1 - 0.0002 * (i + 1)), quantity: 40 })),
      asks: Array.from({ length: 10 }, (_, i) => ({ price: mid * (1 + 0.0002 * (i + 1)), quantity: 40 })),
    };
  return evaluateBasisSpread({
    tokenPrice: mid, tradFiClosePrice: benchPrice, orderSizeUsd: 25, depth,
    fundingRate8h: 0, hoursToClose: 2, takerFee: 0.0006,
  });
};

describe("robinhood benchmark drives the real packet gate", () => {
  const evidenceFor = async (over: Record<string, unknown> = {}, fetchedAt = FETCHED_AT) => {
    const b = await fetchRobinhoodBenchmark({
      symbol: "NVDA",
      fetchImpl: fixtureFetch(over.quotes ? { quotes: over.quotes as never } : {}),
      fetchedAt,
    });
    return robinhoodToEvidence(b, MAX_AGE);
  };

  it("12. a valid benchmark reaches Quant and can produce an executable packet", async () => {
    const evidence = await evidenceFor();
    assert.equal(evidence.freshness, "verified_fresh");
    const p = buildPacket({
      config: NVDA, quant: quantFor(evidence.price), account: ACCOUNT,
      targetNotionalUsd: 25, benchmark: evidence,
      regime: "tradfi_closed", hoursToNextReopen: 2,
    });
    assert.equal(p.quantEvaluated, true);
    assert.notEqual(p.quant, null);
    assert.equal(p.benchmark!.usable, true);
  });

  it("11. benchmark failure prevents Quant evaluation entirely", async () => {
    // A halt makes the adapter throw, so there is no benchmark at all.
    await assert.rejects(
      fetchRobinhoodBenchmark({
        symbol: "NVDA", fetchImpl: fixtureFetch({ quotes: { quotes: [quoteFixture({ isTradingHalt: true })] } }),
        fetchedAt: FETCHED_AT,
      }),
    );
    // And with benchmark=null the packet must not evaluate Quant.
    const p = buildPacket({
      config: NVDA, quant: quantFor(227.7), account: ACCOUNT,
      targetNotionalUsd: 25, benchmark: null,
      regime: "tradfi_closed", hoursToNextReopen: 2,
    });
    assert.equal(p.quantEvaluated, false);
    assert.equal(p.quant, null);
    assert.equal(p.risk, null);
    assert.equal(p.executable, false);
    assert.ok(p.blockingReasons.some((r: string) => r.includes("no benchmark")));
  });

  it("11b. an intraday-stale quote blocks during OPEN hours", async () => {
    // Older than the 96h intraday ceiling, so tradfi_open must refuse it.
    const staleAt = new Date(Date.parse(FETCHED_AT) - MAX_AGE - 60_000).toISOString();
    const evidence = await evidenceFor({ quotes: { quotes: [quoteFixture({ generatedAt: staleAt })] } });
    assert.equal(evidence.freshness, "verified_stale");
    const p = buildPacket({
      config: NVDA, quant: quantFor(evidence.price), account: ACCOUNT,
      targetNotionalUsd: 25, benchmark: evidence,
      regime: "tradfi_open", hoursToNextReopen: 0,
    });
    assert.equal(p.executable, false);
    assert.equal(p.quantEvaluated, false);
    assert.ok(p.blockingReasons.some((r: string) => r.includes("freshness")));
  });

  it("11c. a 4-day-old quote is accepted during closure (inside the closure ceiling)", async () => {
    // The closure ceiling is 7 days, so a 4-day-old reference is a legitimate
    // benchmark while the market is shut and must NOT block.
    const fourDays = new Date(Date.parse(FETCHED_AT) - 4 * 24 * 3_600_000).toISOString();
    const ev = await evidenceFor({ quotes: { quotes: [quoteFixture({ generatedAt: fourDays })] } });
    const p = buildPacket({
      config: NVDA, quant: quantFor(ev.price), account: ACCOUNT,
      targetNotionalUsd: 25, benchmark: ev,
      regime: "tradfi_closed", hoursToNextReopen: 2,
    });
    assert.equal(p.quantEvaluated, true, p.blockingReasons.join(" | "));
  });

  it("11d. beyond the 7-day closure ceiling it fails closed again", async () => {
    // 8 days is outside the closure ceiling: stale AND too old, so it blocks.
    const eightDays = new Date(Date.parse(FETCHED_AT) - 8 * 24 * 3_600_000).toISOString();
    const ev = await evidenceFor({ quotes: { quotes: [quoteFixture({ generatedAt: eightDays })] } });
    assert.equal(ev.freshness, "verified_stale");
    const p = buildPacket({
      config: NVDA, quant: quantFor(ev.price), account: ACCOUNT,
      targetNotionalUsd: 25, benchmark: ev,
      regime: "tradfi_closed", hoursToNextReopen: 2,
    });
    assert.equal(p.executable, false);
    assert.equal(p.quantEvaluated, false);
  });

  it("sizing stays venue-compliant with the Robinhood-sourced benchmark", async () => {
    const s = resolveSizing(NVDA, { targetNotionalUsd: 25, referencePriceUsd: 227.8, freeMarginUsd: 9364.2 });
    assert.equal(s.ok, true, s.reasons.join("; "));
    assert.ok(s.compliantQuantity! >= s.minQty);
    assert.ok(s.roundedNotionalUsd! >= s.minNotionalUsdt);
  });
});

// ---------------------------------------------------------------------------
// Freshness boundary regression.
//
// BENCHMARK_MAX_AGE_MS is EXACTLY 4 days. With a strict `ageMs > maxAgeMs`
// predicate, a quote exactly 4 days old evaluated `345600000 > 345600000`
// = false and was classified verified_fresh. The boundary is now inclusive:
// at the ceiling the quote is already stale.
// ---------------------------------------------------------------------------

describe("freshness boundary is inclusive of staleness", async () => {
  const FOUR_DAYS_MS = 96 * 60 * 60 * 1000;
  const BASE = "2026-09-30T11:06:02.788272Z";

  const evidenceDaysOld = async (days: number) => {
    const g = new Date(Date.parse(BASE) - days * 86_400_000).toISOString();
    const b = await fetchRobinhoodBenchmark({
      symbol: "NVDA",
      fetchImpl: fixtureFetch({ quotes: { quotes: [quoteFixture({ generatedAt: g })] } }),
      fetchedAt: BASE,
    });
    return { evidence: robinhoodToEvidence(b, FOUR_DAYS_MS), benchmark: b };
  };

  it("the ceiling is exactly 4 days", () => {
    assert.equal(FOUR_DAYS_MS, 345_600_000);
    assert.equal(FOUR_DAYS_MS / 86_400_000, 4);
  });

  it("a quote EXACTLY four days old is STALE, not fresh", async () => {
    const { evidence } = await evidenceDaysOld(4);
    assert.equal(evidence.ageMs, FOUR_DAYS_MS, "exactly at the ceiling");
    assert.equal(evidence.freshness, "verified_stale",
      "at the ceiling the quote must already be stale");
  });

  it("a quote just inside the ceiling is still fresh", async () => {
    const { evidence } = await evidenceDaysOld(3.99);
    assert.ok(evidence.ageMs! < FOUR_DAYS_MS);
    assert.equal(evidence.freshness, "verified_fresh");
  });

  it("a quote past the ceiling is stale", async () => {
    const { evidence } = await evidenceDaysOld(4.01);
    assert.equal(evidence.freshness, "verified_stale");
  });

  it("the boundary is consistent across both classification paths", async () => {
    const { assessBenchmarkFreshness } = await import("../src/agents/market-regime.js");
    const g = new Date(Date.parse(BASE) - 4 * 86_400_000).toISOString();
    const direct = assessBenchmarkFreshness({
      price: 227.77, source: "EXPLICIT_TS_SOURCE", sourceAsOf: g,
      fetchedAt: BASE, maxAgeMs: FOUR_DAYS_MS,
    });
    assert.equal(direct.freshness, "verified_stale",
      "the direct classifier must agree with the Robinhood bridge");
  });

  it("a 4-day-old quote cannot produce an executable OPEN-hours packet", async () => {
    const { evidence } = await evidenceDaysOld(4);
    const p = buildPacket({
      config: NVDA, quant: quantFor(evidence.price), account: ACCOUNT,
      targetNotionalUsd: 25, benchmark: evidence,
      regime: "tradfi_open", hoursToNextReopen: 0,
    });
    assert.equal(p.executable, false);
    assert.equal(p.quantEvaluated, false);
  });

  it("sourceAsOf and fetchedAt stay separate at the boundary", async () => {
    const { evidence, benchmark } = await evidenceDaysOld(4);
    const expectedSource = new Date(Date.parse(BASE) - 4 * 86_400_000).toISOString();
    assert.equal(benchmark.sourceAsOf, expectedSource, "provider instant verbatim");
    assert.equal(benchmark.fetchedAt, BASE, "local fetch time unchanged");
    assert.equal(evidence.sourceAsOf, expectedSource);
    assert.equal(evidence.fetchedAt, BASE);
    assert.notEqual(evidence.sourceAsOf, evidence.fetchedAt);
  });
});
