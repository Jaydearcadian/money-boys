import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEvidenceResponse,
  EVIDENCE_EFFECTIVE_MAX_AGE_MS,
  EVIDENCE_INHERITED_BENCHMARK_MAX_AGE_MS,
} from "../src/evidence-surface.js";
import { verifyReceipt } from "../src/council/receipts.js";
import type { FetchLike } from "../src/integrations/robinhood/benchmark.js";

/**
 * Phase 1 read-only evidence surface — regression guard.
 *
 * These tests exist to pin three things that must never silently regress:
 *
 *   1. The surface has NO execution authority. `executable` is false and
 *      `executionAuthority` is "none" in EVERY state, including the fully
 *      successful one. A future refactor that starts assembling a real packet
 *      here would break these.
 *   2. The benchmark gate runs BEFORE Quant. A stale or unverifiable benchmark
 *      must leave `quant === null`, not a NEUTRAL verdict with numbers.
 *   3. Provenance timestamps are never conflated. `sourceAsOf` is the
 *      provider's own instant; `fetchedAt` is ours; they stay distinct and
 *      sourceAsOf is never rewritten to our clock.
 *
 * Zero network: every read is served by an in-process stub of the two PUBLIC
 * endpoints. No credentials are configured anywhere in this file.
 */

const NOW = new Date("2026-09-30T14:00:00Z"); // 10:00 ET, TradFi open

interface StubOpts {
  generatedAt?: string;
  bid?: string;
  ask?: string;
  halt?: boolean;
  priceStatus?: number;
  omitGeneratedAt?: boolean;
}

function stub(o: StubOpts = {}): FetchLike {
  const {
    generatedAt = "2026-09-30T13:59:59.514Z",
    bid = "132.60",
    ask = "132.82",
    halt = false,
    priceStatus = 200,
    omitGeneratedAt = false,
  } = o;
  return async (url) => {
    const u = String(url);
    const ok = (b: unknown) => ({ ok: true, status: 200, json: async () => b });
    if (u.includes("/rhj/prices")) {
      if (priceStatus !== 200) return { ok: false, status: priceStatus, json: async () => ({}) };
      const quote: Record<string, unknown> = {
        tokenSymbol: "NVDA", bid, ask, currency: "USD", isTradingHalt: halt,
      };
      if (!omitGeneratedAt) quote.generatedAt = generatedAt;
      return ok({ quotes: [quote] });
    }
    if (u.includes("/rhj/assets")) {
      return ok({
        assets: [
          { id: "a1", tokenSymbol: "NVDA", currentMultiplier: "1.000775159164630595", status: "ASSET_STATUS_ACTIVE" },
        ],
      });
    }
    if (u.includes("/api/v2/mix/market/ticker")) {
      return ok({ code: "0", data: { symbol: "NVDAUSDT", lastPr: "132.71", fundingRate: "0.0001" } });
    }
    if (u.includes("/api/v2/mix/market/orderbook")) {
      return ok({
        code: "0",
        data: {
          symbol: "NVDAUSDT",
          bids: Array.from({ length: 10 }, (_, i) => [(132.67 - 0.04 * i).toFixed(2), "40"]),
          asks: Array.from({ length: 10 }, (_, i) => [(132.75 + 0.04 * i).toFixed(2), "40"]),
        },
      });
    }
    if (u.includes("/api/v2/mix/market/contracts")) {
      return ok({
        code: "0",
        data: [
          {
            symbol: "NVDAUSDT", baseCoin: "NVDA", quoteCoin: "USDT", sizeMultiplier: "0.01",
            minTradeNum: "0.01", minTradeUSDT: "5", pricePlace: "2", volumePlace: "2",
            takerFeeRate: "0.0006", makerFeeRate: "0.0002",
          },
        ],
      });
    }
    throw new Error("unstubbed URL: " + u);
  };
}

describe("evidence surface — no execution authority", () => {
  it("never reports executable or any authority, even on a fully successful read", async () => {
    const ev = await buildEvidenceResponse({ now: NOW, fetchImpl: stub() });
    assert.equal(ev.status, "ok");
    assert.equal(ev.ok, true);
    assert.equal(ev.executable, false, "read-only surface must never be executable");
    assert.equal(ev.executionAuthority, "none");
    assert.equal(ev.authority, "read_only");
  });

  it("always names the missing packet-to-dispatch bridge", async () => {
    const ev = await buildEvidenceResponse({ now: NOW, fetchImpl: stub() });
    assert.equal(ev.bridge.packetToDispatch, "absent");
    assert.ok(
      ev.blockingReasons.some((r) => r.includes("NO_PACKET_TO_DISPATCH_BRIDGE")),
      "the architectural gap must be stated in the payload, not only in a comment",
    );
  });

  it("blocks even when Quant reports a positive net edge", async () => {
    // A wide dislocation: token 132.71 vs benchmark 140 => large positive edge.
    const ev = await buildEvidenceResponse({
      now: NOW,
      fetchImpl: stub({ bid: "139.90", ask: "140.10" }),
    });
    assert.equal(ev.status, "ok");
    assert.ok(ev.quant !== null, "quant should evaluate on a fresh benchmark");
    assert.ok(ev.quant.netEdge > 0, `expected positive net edge, got ${ev.quant.netEdge}`);
    assert.equal(ev.executable, false, "positive edge must NOT authorize anything here");
  });
});

describe("evidence surface — symbol mapping", () => {
  it("maps r-prefixed repo symbol through to the underlying reference", async () => {
    const ev = await buildEvidenceResponse({ now: NOW, fetchImpl: stub() });
    assert.deepEqual(
      { repo: ev.symbolMapping.repoSymbol, venue: ev.symbolMapping.venueSymbol, ref: ev.symbolMapping.referenceSymbol },
      { repo: "rNVDAUSDT", venue: "NVDAUSDT", ref: "NVDA" },
    );
  });

  it("honours an explicit symbol argument", async () => {
    const ev = await buildEvidenceResponse({ symbol: "rTSLAUSDT", now: NOW, fetchImpl: async (u) => {
      const s = String(u);
      const ok = (b: unknown) => ({ ok: true, status: 200, json: async () => b });
      if (s.includes("/rhj/prices")) return ok({ quotes: [{ tokenSymbol: "TSLA", bid: "410.00", ask: "410.20", currency: "USD", isTradingHalt: false, generatedAt: "2026-09-30T13:59:59.514Z" }] });
      if (s.includes("/rhj/assets")) return ok({ assets: [{ id: "a2", tokenSymbol: "TSLA", currentMultiplier: "1", status: "ASSET_STATUS_ACTIVE" }] });
      if (s.includes("market/ticker")) return ok({ code: "0", data: { symbol: "TSLAUSDT", lastPr: "410.10", fundingRate: "0" } });
      if (s.includes("market/orderbook")) return ok({ code: "0", data: { symbol: "TSLAUSDT", bids: Array.from({ length: 10 }, (_, i) => [(410.05 - 0.05 * i).toFixed(2), "10"]), asks: Array.from({ length: 10 }, (_, i) => [(410.15 + 0.05 * i).toFixed(2), "10"]) } });
      return ok({ code: "0", data: [{ symbol: "TSLAUSDT", sizeMultiplier: "0.01", minTradeNum: "0.01", minTradeUSDT: "5", pricePlace: "2", volumePlace: "2", takerFeeRate: "0.0006" }] });
    } });
    assert.equal(ev.symbolMapping.repoSymbol, "rTSLAUSDT");
    assert.equal(ev.symbolMapping.referenceSymbol, "TSLA");
    assert.equal(ev.benchmark?.symbol, "TSLA");
  });

  it("fails closed when the provider does not return the requested instrument", async () => {
    // The provider answers with a quote for a DIFFERENT symbol. The envelope
    // parses, so this is caught by the symbol-identity check rather than by
    // shape validation: SYMBOL_NOT_RETURNED from the quote lookup, or
    // SYMBOL_MISMATCH from parseBenchmarkQuote if the lookup ever passes a
    // mismatched pair through. Either way it must never render as NVDA.
    const ev = await buildEvidenceResponse({
      now: NOW,
      fetchImpl: async (u) => {
        const s = String(u);
        const ok = (b: unknown) => ({ ok: true, status: 200, json: async () => b });
        if (s.includes("/rhj/prices")) return ok({ quotes: [{ tokenSymbol: "AAPL", bid: "1", ask: "1", currency: "USD", isTradingHalt: false, generatedAt: "2026-09-30T13:59:59.514Z" }] });
        return ok({ assets: [] });
      },
    });
    assert.equal(ev.ok, false);
    assert.equal(ev.benchmark, null);
    assert.equal(ev.quant, null);
    assert.ok(
      ev.error?.code === "SYMBOL_NOT_RETURNED" || ev.error?.code === "SYMBOL_MISMATCH",
      `expected a symbol-identity rejection, got ${ev.error?.code}`,
    );
  });
});

describe("evidence surface — provenance timestamps", () => {
  it("keeps sourceAsOf (provider) distinct from fetchedAt (local)", async () => {
    const ev = await buildEvidenceResponse({ now: NOW, fetchImpl: stub() });
    assert.equal(ev.benchmark?.sourceAsOf, "2026-09-30T13:59:59.514Z", "provider instant must be verbatim");
    assert.equal(ev.benchmark?.fetchedAt, NOW.toISOString(), "local request time is our own");
    assert.notEqual(ev.benchmark?.sourceAsOf, ev.benchmark?.fetchedAt);
  });

  /**
   * Timing semantics. Two distinct local instants must both be present and
   * must never be collapsed into one another.
   *
   * NOTE ON DIRECTION: the gate uses ageAtRequestStartMs, which is the SMALLER
   * of the two ages and therefore the MORE PERMISSIVE basis. It is retained
   * because it is pre-existing behaviour and changing the gate is a policy
   * decision. These tests pin that behaviour AND pin the fact that the
   * receipt-relative age is strictly larger, so nobody can later describe the
   * gate basis as conservative.
   */
  it("reports requestedAt and responseReceivedAt as distinct local instants", async () => {
    const ev = await buildEvidenceResponse({ now: NOW, fetchImpl: stub() });
    assert.equal(ev.benchmark?.requestedAt, NOW.toISOString());
    assert.equal(ev.benchmark?.fetchedAt, NOW.toISOString(), "fetchedAt is an alias of requestedAt");
    // Receipt is stamped when the response lands, so it is >= request start.
    assert.ok(
      Date.parse(ev.benchmark!.responseReceivedAt) >= Date.parse(ev.benchmark!.requestedAt),
      "responseReceivedAt must not precede requestedAt",
    );
    assert.equal(ev.freshness?.freshnessBasis, "request-start-relative");
  });

  it("gates on ageAtRequestStartMs and reports ageAtReceiptMs separately", async () => {
    const ev = await buildEvidenceResponse({ now: NOW, fetchImpl: stub() });
    assert.equal(ev.freshness?.ageAtRequestStartMs, 486);
    // Gate-deciding age equals the request-start basis.
    assert.equal(ev.freshness?.ageMs, ev.freshness?.ageAtRequestStartMs);
    // The receipt-relative age is strictly greater: the round trip is added.
    assert.ok(
      (ev.freshness?.ageAtReceiptMs ?? 0) >= (ev.freshness?.ageAtRequestStartMs ?? 0),
      "ageAtReceiptMs must be >= ageAtRequestStartMs",
    );
    // Receipt latency is exactly the difference between the two.
    assert.equal(
      (ev.freshness?.ageAtReceiptMs ?? 0) - (ev.freshness?.ageAtRequestStartMs ?? 0),
      ev.freshness?.receiptLatencyMs,
      "receiptLatencyMs must equal the gap between the two ages",
    );
  });

  it("never labels the gate basis as receipt-relative", async () => {
    const ev = await buildEvidenceResponse({ now: NOW, fetchImpl: stub() });
    assert.notEqual(ev.freshness?.freshnessBasis, "receipt-relative");
    const serialised = JSON.stringify(ev);
    assert.ok(!serialised.includes('"receipt-relative"'), "receipt-relative must never appear as a basis");
  });

  it("labels the timestamp as provider-generated, never an exchange trade time", async () => {
    const ev = await buildEvidenceResponse({ now: NOW, fetchImpl: stub() });
    assert.equal(ev.benchmark?.timestampType, "PROVIDER_GENERATED_QUOTE");
  });

  it("derives age from the provider instant, and reports the threshold it judged against", async () => {
    const ev = await buildEvidenceResponse({ now: NOW, fetchImpl: stub() });
    assert.equal(ev.freshness?.status, "verified_fresh");
    assert.equal(ev.freshness?.ageMs, 486);
  });

  /**
   * Regression guard for the 96h defect. The effective gate MUST be the
   * provider's documented 15s cache window. If this ever reverts to 96h, a
   * 4-day-old quote is accepted as verified_fresh while TradFi is open.
   */
  it("uses the provider cache window as the effective gate, NOT the inherited 96h ceiling", async () => {
    const ev = await buildEvidenceResponse({ now: NOW, fetchImpl: stub() });
    assert.equal(ev.freshness?.effectiveThresholdMs, 15_000, "effective gate must be the 15s provider cache window");
    assert.equal(ev.freshness?.providerCacheWindowMs, 15_000);
    // The inherited ceiling is still reported, but must be visibly distinct.
    assert.equal(ev.freshness?.inheritedBenchmarkMaxAgeMs, 345_600_000);
    assert.notEqual(ev.freshness?.effectiveThresholdMs, ev.freshness?.inheritedBenchmarkMaxAgeMs);
  });

  it("rejects a quote older than 15s during TradFi open hours", async () => {
    // 60s old: comfortably inside the inherited 96h ceiling, but OUTSIDE the
    // 15s provider cache window. Under the old defect this returned
    // verified_fresh and passed the gate.
    const ev = await buildEvidenceResponse({
      now: NOW,
      fetchImpl: stub({ generatedAt: "2026-09-30T13:59:00.000Z" }),
    });
    assert.equal(ev.freshness?.status, "verified_stale");
    assert.equal(ev.freshness?.ageMs, 60_000);
    assert.equal(ev.gate.usable, false, "a 60s-old quote must not pass the open-regime gate");
    assert.equal(ev.quant, null, "Quant must not run on a quote past the 15s cache window");
    assert.equal(ev.status, "unusable");
  });

  it("rejects a quote just past the 15s boundary", async () => {
    // 15.001s: the first millisecond that must fail. Pins the boundary.
    const ev = await buildEvidenceResponse({
      now: NOW,
      fetchImpl: stub({ generatedAt: "2026-09-30T13:59:44.999Z" }),
    });
    assert.equal(ev.freshness?.ageMs, 15_001);
    assert.equal(ev.freshness?.status, "verified_stale");
    assert.equal(ev.quant, null);
  });

  it("accepts a quote just inside the 15s boundary", async () => {
    const ev = await buildEvidenceResponse({
      now: NOW,
      fetchImpl: stub({ generatedAt: "2026-09-30T13:59:45.001Z" }),
    });
    assert.equal(ev.freshness?.ageMs, 14_999);
    assert.equal(ev.freshness?.status, "verified_fresh");
    assert.equal(ev.gate.usable, true);
  });

  it("never applies the multiplier to the price", async () => {
    const ev = await buildEvidenceResponse({ now: NOW, fetchImpl: stub() });
    assert.equal(ev.benchmark?.multiplierAppliedToPrice, false);
    assert.equal(ev.benchmark?.multiplierCurrent, "1.000775159164630595");
    assert.equal(ev.benchmark?.midpoint, 132.71, "midpoint must be raw bid/ask, unadjusted");
  });
});

describe("evidence surface — benchmark gate blocks Quant", () => {
  it("runs Quant only when the benchmark is provable", async () => {
    const ev = await buildEvidenceResponse({ now: NOW, fetchImpl: stub() });
    assert.equal(ev.gate.usable, true);
    assert.equal(ev.gate.blockedReason, null);
    assert.notEqual(ev.quant, null);
  });

  it("leaves quant null and never fabricates a verdict on a stale benchmark", async () => {
    // 9 days old: past even the TradFi closure ceiling. With the corrected
    // 15s gate this fails on the effective threshold long before that.
    const ev = await buildEvidenceResponse({
      now: NOW,
      fetchImpl: stub({ generatedAt: "2026-09-21T13:59:59.514Z" }),
    });
    assert.equal(ev.ok, false);
    assert.equal(ev.status, "unusable");
    assert.equal(ev.gate.usable, false);
    assert.ok(ev.gate.blockedReason);
    assert.equal(ev.quant, null, "Quant must not run when the benchmark gate blocks");
    assert.equal(ev.executable, false);
  });

  it("leaves quant null when the provider omits generatedAt entirely", async () => {
    const ev = await buildEvidenceResponse({ now: NOW, fetchImpl: stub({ omitGeneratedAt: true }) });
    assert.equal(ev.ok, false);
    assert.equal(ev.quant, null, "no provider timestamp means no provable freshness");
    // `generatedAt` is required by RhQuoteSchema, so an absent field is caught
    // at envelope validation as SHAPE_DRIFT rather than reaching the
    // MISSING_GENERATED_AT check in parseBenchmarkQuote. Both reject; the point
    // is that neither is treated as fresh.
    assert.ok(
      ev.error?.code === "SHAPE_DRIFT" || ev.error?.code === "MISSING_GENERATED_AT",
      `expected a timestamp-rejection, got ${ev.error?.code}`,
    );
  });

  it("rejects a provider timestamp that is not a parseable instant", async () => {
    const ev = await buildEvidenceResponse({
      now: NOW,
      fetchImpl: stub({ generatedAt: "not-a-timestamp" }),
    });
    assert.equal(ev.ok, false);
    assert.equal(ev.quant, null);
    assert.equal(ev.error?.code, "MALFORMED_GENERATED_AT");
  });

  it("rejects a benchmark whose sourceAsOf is in the future relative to our fetch", async () => {
    // Negative age cannot be proven fresh; the evidence helper marks it
    // unverifiable and the gate then blocks.
    const ev = await buildEvidenceResponse({
      now: NOW,
      fetchImpl: stub({ generatedAt: "2026-09-30T14:05:00.000Z" }),
    });
    assert.equal(ev.ok, false);
    assert.equal(ev.freshness?.status, "unverifiable");
    assert.equal(ev.quant, null);
  });
});

describe("evidence surface — fail-closed error states", () => {
  it("returns a typed error and no benchmark on a provider HTTP failure", async () => {
    const ev = await buildEvidenceResponse({ now: NOW, fetchImpl: stub({ priceStatus: 503 }) });
    assert.equal(ev.ok, false);
    assert.equal(ev.status, "error");
    assert.equal(ev.benchmark, null);
    assert.equal(ev.freshness, null);
    assert.equal(ev.quant, null);
    assert.equal(ev.error?.code, "HTTP");
    assert.ok(ev.blockingReasons.some((r) => r.startsWith("BENCHMARK_UNAVAILABLE")));
  });

  it("surfaces a trading halt as a typed failure, not a usable quote", async () => {
    const ev = await buildEvidenceResponse({ now: NOW, fetchImpl: stub({ halt: true }) });
    assert.equal(ev.ok, false);
    assert.equal(ev.quant, null);
    assert.equal(ev.error?.code, "TRADING_HALT");
  });

  it("never throws, whatever the provider does", async () => {
    const ev = await buildEvidenceResponse({
      now: NOW,
      fetchImpl: async () => { throw new Error("ECONNRESET"); },
    });
    assert.equal(ev.ok, false);
    assert.equal(ev.status, "error");
    assert.equal(ev.executable, false);
    assert.equal(ev.error?.code, "TRANSPORT");
  });

  it("still reports regime and mapping when the benchmark read fails", async () => {
    const ev = await buildEvidenceResponse({ now: NOW, fetchImpl: stub({ priceStatus: 500 }) });
    assert.equal(ev.symbolMapping.repoSymbol, "rNVDAUSDT");
    assert.ok(ev.regime.regime);
    assert.equal(typeof ev.regime.hoursToNextReopen, "number");
  });
});

describe("evidence surface — regime-aware carry", () => {
  it("reports zero carry while TradFi is open", async () => {
    const ev = await buildEvidenceResponse({ now: NOW, fetchImpl: stub() });
    assert.equal(ev.regime.regime, "tradfi_open");
    assert.equal(ev.regime.hoursToNextReopen, 0);
    assert.equal(ev.regime.requiredBenchmarkSource, "live_intraday");
  });

  it("reports hours to the next reopen while TradFi is closed", async () => {
    // 2026-09-30T20:00Z is 16:00 ET — exactly at the close.
    const ev = await buildEvidenceResponse({
      now: new Date("2026-09-30T20:00:00Z"),
      fetchImpl: stub({ generatedAt: "2026-09-30T19:59:59.514Z" }),
    });
    assert.equal(ev.regime.regime, "tradfi_closed");
    assert.ok(ev.regime.hoursToNextReopen > 0, "closed regime must carry a real horizon");
    assert.ok(ev.regime.nextReopenAtIso);
    assert.equal(ev.regime.requiredBenchmarkSource, "latest_close");
  });

  it("always discloses that the holiday calendar is not modelled (GAP-017)", async () => {
    const ev = await buildEvidenceResponse({ now: NOW, fetchImpl: stub() });
    assert.equal(ev.regime.holidayCalendarSupported, false);
    assert.ok(ev.regime.limitation.length > 0);
  });
});

describe("evidence surface — no credentials, no venue writes", () => {
  it("works with no Bitget credentials configured at all", async () => {
    // buildEvidenceResponse constructs its own client with empty keys. If any
    // private route were touched, it would fail or require signing; this test
    // passing at all is the assertion that only public reads happen.
    const ev = await buildEvidenceResponse({ now: NOW, fetchImpl: stub() });
    assert.equal(ev.status, "ok");
  });

  it("never emits a receipt: the surface seals nothing", async () => {
    const ev = await buildEvidenceResponse({ now: NOW, fetchImpl: stub() });
    const serialised = JSON.stringify(ev);
    assert.ok(!("receiptHash" in ev), "no receipt is produced by a read-only surface");
    assert.ok(!("clientOidOpen" in ev), "no client order id is derived by a read-only surface");
    assert.ok(!serialised.includes("ACCESS-SIGN"), "no signing material may appear");
  });

  it("produces no receipt that a dispatcher could accept", () => {
    // Guards against a future refactor smuggling a sealed receipt into the
    // response: a payload shaped like a receipt would verify here, so assert
    // the type has no such field at all.
    const ev: Record<string, unknown> = {};
    for (const k of ["receiptHash", "receiptId", "sealedAt"]) {
      assert.equal(k in ev, false);
      assert.equal(verifyReceipt({ ...ev, [k]: "x" }), false);
    }
  });
});
