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


/**
 * Deterministic receipt clock, offset from the injected request instant.
 *
 * Without this the real wall clock is read at receipt time, so every case
 * would measure against "now" rather than the case's own timeline.
 */
const RECEIPT_OFFSET_MS = 174;
function build(args: Parameters<typeof buildEvidenceResponse>[0]) {
  const now = args.now ?? NOW;
  return buildEvidenceResponse({
    ...args,
    now,
    clock: args.clock ?? (() => new Date(now.getTime() + RECEIPT_OFFSET_MS)),
  });
}

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
    const ev = await build({ now: NOW, fetchImpl: stub() });
    assert.equal(ev.status, "ok");
    assert.equal(ev.ok, true);
    assert.equal(ev.executable, false, "read-only surface must never be executable");
    assert.equal(ev.executionAuthority, "none");
    assert.equal(ev.authority, "read_only");
  });

  it("always names the missing packet-to-dispatch bridge", async () => {
    const ev = await build({ now: NOW, fetchImpl: stub() });
    assert.equal(ev.bridge.packetToDispatch, "absent");
    assert.ok(
      ev.blockingReasons.some((r) => r.includes("NO_PACKET_TO_DISPATCH_BRIDGE")),
      "the architectural gap must be stated in the payload, not only in a comment",
    );
  });

  it("blocks even when Quant reports a positive net edge", async () => {
    // A wide dislocation: token 132.71 vs benchmark 140 => large positive edge.
    const ev = await build({
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
    const ev = await build({ now: NOW, fetchImpl: stub() });
    assert.deepEqual(
      { repo: ev.symbolMapping.repoSymbol, venue: ev.symbolMapping.venueSymbol, ref: ev.symbolMapping.referenceSymbol },
      { repo: "rNVDAUSDT", venue: "NVDAUSDT", ref: "NVDA" },
    );
  });

  it("honours an explicit symbol argument", async () => {
    const ev = await build({ symbol: "rTSLAUSDT", now: NOW, fetchImpl: async (u) => {
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
    const ev = await build({
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
    const ev = await build({ now: NOW, fetchImpl: stub() });
    assert.equal(ev.benchmark?.sourceAsOf, "2026-09-30T13:59:59.514Z", "provider instant must be verbatim");
    assert.equal(ev.benchmark?.fetchedAt, NOW.toISOString(), "local request time is our own");
    assert.notEqual(ev.benchmark?.sourceAsOf, ev.benchmark?.fetchedAt);
  });

  /**
   * Timing semantics: three distinct instants, never collapsed.
   * The gate basis is receipt-relative; the request-start age is diagnostics.
   */
  it("reports requestedAt and responseReceivedAt as distinct local instants", async () => {
    const ev = await build({ now: NOW, fetchImpl: stub() });
    assert.equal(ev.benchmark?.requestedAt, NOW.toISOString());
    assert.equal(ev.benchmark?.fetchedAt, NOW.toISOString(), "fetchedAt is an alias of requestedAt");
    assert.ok(
      Date.parse(ev.benchmark!.responseReceivedAt) >= Date.parse(ev.benchmark!.requestedAt),
      "responseReceivedAt must not precede requestedAt",
    );
    assert.notEqual(ev.benchmark?.sourceAsOf, ev.benchmark?.requestedAt);
  });

  it("distinguishes the diagnostic request-start age from the admission age", async () => {
    const ev = await build({
      now: NOW, clock: () => new Date(NOW.getTime() + 174), fetchImpl: stub(),
    });
    assert.equal(ev.freshness?.ageAtRequestStartMs, 486);
    assert.equal(ev.freshness?.ageAtReceiptMs, 660);
    // ageMs is the ADMISSION age, so it tracks the receipt, not the request.
    assert.equal(ev.freshness?.ageMs, ev.freshness?.ageAtReceiptMs);
    assert.equal(ev.freshness?.receiptLatencyMs, 174);
  });

  it("labels the timestamp as provider-generated, never an exchange trade time", async () => {
    const ev = await build({ now: NOW, fetchImpl: stub() });
    assert.equal(ev.benchmark?.timestampType, "PROVIDER_GENERATED_QUOTE");
  });

  it("derives age from the provider instant, and reports the threshold it judged against", async () => {
    const ev = await build({ now: NOW, fetchImpl: stub() });
    assert.equal(ev.freshness?.status, "verified_fresh");
    // Admission age is receipt-relative; with no clock injected the receipt
    // coincides with the request instant.
    assert.equal(ev.freshness?.ageMs, ev.freshness?.ageAtReceiptMs);
  });

  /**
   * Regression guard for the 96h defect. The effective gate MUST be the
   * provider's documented 15s cache window. If this ever reverts to 96h, a
   * 4-day-old quote is accepted as verified_fresh while TradFi is open.
   */
  it("uses the provider cache window as the effective gate, NOT the inherited 96h ceiling", async () => {
    const ev = await build({ now: NOW, fetchImpl: stub() });
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
    const ev = await build({
      now: NOW,
      fetchImpl: stub({ generatedAt: "2026-09-30T13:59:00.000Z" }),
    });
    assert.equal(ev.freshness?.status, "verified_stale");
    assert.equal(ev.freshness?.ageAtReceiptMs, 60_174); // 60,000 + 174 receipt offset
    assert.equal(ev.gate.usable, false, "a 60s-old quote must not pass the open-regime gate");
    assert.equal(ev.quant, null, "Quant must not run on a quote past the 15s cache window");
    assert.equal(ev.status, "unusable");
  });

  it("rejects a quote one millisecond past the 15s admission boundary", async () => {
    // Receipt exactly 15,001ms after sourceAsOf: the first failing millisecond.
    // Zero latency clock so the receipt age IS the fixture's designed age.
    const ev = await build({
      now: NOW,
      clock: () => new Date(NOW.getTime()),
      fetchImpl: stub({ generatedAt: "2026-09-30T13:59:44.999Z" }),
    });
    assert.equal(ev.freshness?.ageAtReceiptMs, 15_001);
    assert.equal(ev.freshness?.status, "verified_stale");
    assert.equal(ev.quant, null);
    assert.equal(ev.decision, "NO_TRADE");
  });

  it("accepts a quote one millisecond inside the 15s admission boundary", async () => {
    const ev = await build({
      now: NOW,
      clock: () => new Date(NOW.getTime()),
      fetchImpl: stub({ generatedAt: "2026-09-30T13:59:45.001Z" }),
    });
    assert.equal(ev.freshness?.ageAtReceiptMs, 14_999);
    assert.equal(ev.freshness?.status, "verified_fresh");
    assert.equal(ev.gate.usable, true);
  });

  it("treats a sourceAsOf in the future as unverifiable, never fresh", async () => {
    // Negative receipt age. The provider instant and our clock disagree, so
    // freshness cannot be proven. A naive `age >= gate` check would call this
    // fresh; it must not.
    const ev = await build({
      now: NOW,
      clock: () => new Date(NOW.getTime()),
      fetchImpl: stub({ generatedAt: "2026-09-30T14:05:00.000Z" }),
    });
    assert.ok((ev.freshness?.ageAtReceiptMs ?? 0) < 0, "age must be negative for this case");
    assert.equal(ev.freshness?.status, "unverifiable");
    assert.equal(ev.quant, null);
    assert.equal(ev.decision, "NO_TRADE");
  });

  it("never applies the multiplier to the price", async () => {
    const ev = await build({ now: NOW, fetchImpl: stub() });
    assert.equal(ev.benchmark?.multiplierAppliedToPrice, false);
    assert.equal(ev.benchmark?.multiplierCurrent, "1.000775159164630595");
    assert.equal(ev.benchmark?.midpoint, 132.71, "midpoint must be raw bid/ask, unadjusted");
  });
});

describe("evidence surface — benchmark gate blocks Quant", () => {
  it("runs Quant only when the benchmark is provable", async () => {
    const ev = await build({ now: NOW, fetchImpl: stub() });
    assert.equal(ev.gate.usable, true);
    assert.equal(ev.gate.blockedReason, null);
    assert.notEqual(ev.quant, null);
  });

  it("leaves quant null and never fabricates a verdict on a stale benchmark", async () => {
    // 9 days old: past even the TradFi closure ceiling. With the corrected
    // 15s gate this fails on the effective threshold long before that.
    const ev = await build({
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
    const ev = await build({ now: NOW, fetchImpl: stub({ omitGeneratedAt: true }) });
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
    const ev = await build({
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
    const ev = await build({
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
    const ev = await build({ now: NOW, fetchImpl: stub({ priceStatus: 503 }) });
    assert.equal(ev.ok, false);
    assert.equal(ev.status, "error");
    assert.equal(ev.benchmark, null);
    assert.equal(ev.freshness, null);
    assert.equal(ev.quant, null);
    assert.equal(ev.error?.code, "HTTP");
    assert.ok(ev.blockingReasons.some((r) => r.startsWith("BENCHMARK_UNAVAILABLE")));
  });

  it("surfaces a trading halt as a typed failure, not a usable quote", async () => {
    const ev = await build({ now: NOW, fetchImpl: stub({ halt: true }) });
    assert.equal(ev.ok, false);
    assert.equal(ev.quant, null);
    assert.equal(ev.error?.code, "TRADING_HALT");
  });

  it("never throws, whatever the provider does", async () => {
    const ev = await build({
      now: NOW,
      fetchImpl: async () => { throw new Error("ECONNRESET"); },
    });
    assert.equal(ev.ok, false);
    assert.equal(ev.status, "error");
    assert.equal(ev.executable, false);
    assert.equal(ev.error?.code, "TRANSPORT");
  });

  it("still reports regime and mapping when the benchmark read fails", async () => {
    const ev = await build({ now: NOW, fetchImpl: stub({ priceStatus: 500 }) });
    assert.equal(ev.symbolMapping.repoSymbol, "rNVDAUSDT");
    assert.ok(ev.regime.regime);
    assert.equal(typeof ev.regime.hoursToNextReopen, "number");
  });
});

describe("evidence surface — regime-aware carry", () => {
  it("reports zero carry while TradFi is open", async () => {
    const ev = await build({ now: NOW, fetchImpl: stub() });
    assert.equal(ev.regime.regime, "tradfi_open");
    assert.equal(ev.regime.hoursToNextReopen, 0);
    assert.equal(ev.regime.requiredBenchmarkSource, "live_intraday");
  });

  it("reports hours to the next reopen while TradFi is closed", async () => {
    // 2026-09-30T20:00Z is 16:00 ET — exactly at the close.
    const ev = await build({
      now: new Date("2026-09-30T20:00:00Z"),
      clock: () => new Date("2026-09-30T20:00:00.174Z"),
      fetchImpl: stub({ generatedAt: "2026-09-30T19:59:59.514Z" }),
    });
    assert.equal(ev.regime.regime, "tradfi_closed");
    assert.ok(ev.regime.hoursToNextReopen > 0, "closed regime must carry a real horizon");
    assert.ok(ev.regime.nextReopenAtIso);
    assert.equal(ev.regime.requiredBenchmarkSource, "latest_close");
  });

  it("always discloses that the holiday calendar is not modelled (GAP-017)", async () => {
    const ev = await build({ now: NOW, fetchImpl: stub() });
    assert.equal(ev.regime.holidayCalendarSupported, false);
    assert.ok(ev.regime.limitation.length > 0);
  });
});

describe("evidence surface — receipt-relative admission gate", () => {
  /** NOW is 10:00 ET (TradFi open), so these exercise the gate itself. */
  const openNow = NOW;

  it("admits on the receipt-relative age", async () => {
    const ev = await build({
      now: openNow,
      clock: () => new Date(openNow.getTime() + 174),
      fetchImpl: stub(),
    });
    assert.equal(ev.freshness?.freshnessBasis, "receipt-relative");
    // 486ms at request start, 660ms at receipt. The gate used the larger.
    assert.equal(ev.freshness?.ageAtRequestStartMs, 486);
    assert.equal(ev.freshness?.ageAtReceiptMs, 660);
    assert.equal(ev.freshness?.ageMs, 660, "ageMs IS the admission age");
  });

  it("rejects a quote that is fresh at request start but stale at receipt", async () => {
    // 14,900ms old when we ask (inside the 15,000ms gate), 15,400ms by the
    // time the response lands (outside it). Under a request-start gate this
    // would be ADMITTED. Under the receipt-relative gate it is refused.
    const ev = await build({
      now: openNow,
      clock: () => new Date(openNow.getTime() + 500),
      fetchImpl: stub({ generatedAt: "2026-09-30T13:59:45.100Z" }),
    });
    assert.equal(ev.freshness?.ageAtRequestStartMs, 14_900);
    assert.equal(ev.freshness?.ageAtReceiptMs, 15_400); // +500ms explicit receipt clock
    assert.equal(ev.freshness?.status, "verified_stale", "receipt-relative age must decide");
    assert.equal(ev.gate.usable, false);
    assert.equal(ev.quant, null);
    assert.equal(ev.decision, "NO_TRADE");
  });

  it("admits a quote whose receipt age is still inside the gate", async () => {
    const ev = await build({
      now: openNow,
      clock: () => new Date(openNow.getTime() + 500),
      fetchImpl: stub({ generatedAt: "2026-09-30T13:59:46.000Z" }),
    });
    // 14,000ms old at request start, 14,500ms by receipt. Both inside 15,000.
    assert.equal(ev.freshness?.ageAtRequestStartMs, 14_000);
    assert.equal(ev.freshness?.ageAtReceiptMs, 14_500);
    assert.equal(ev.freshness?.status, "verified_fresh");
    assert.equal(ev.gate.usable, true);
  });

  it("fails closed on a slow response even when the quote was fresh", async () => {
    // 5s round trip: the quote was 1s old at request start but 6s old at
    // receipt. Both inside 15s, so this passes — the point is that the two
    // ages are genuinely distinct and the gate sees the larger one.
    const ev = await build({
      now: openNow,
      clock: () => new Date(openNow.getTime() + 5_000),
      fetchImpl: stub({ generatedAt: "2026-09-30T13:59:59.000Z" }),
    });
    assert.equal(ev.freshness?.ageAtRequestStartMs, 1_000);
    assert.equal(ev.freshness?.ageAtReceiptMs, 6_000);
    assert.equal(ev.freshness?.receiptLatencyMs, 5_000);
    assert.equal(ev.freshness?.ageMs, 6_000);
  });

  it("rejects when a very slow response pushes the quote past the gate", async () => {
    // 1s old at request start, 20s old at receipt because the response took
    // 19s. Fails closed on the admission basis.
    const ev = await build({
      now: openNow,
      clock: () => new Date(openNow.getTime() + 19_000),
      fetchImpl: stub({ generatedAt: "2026-09-30T13:59:59.000Z" }),
    });
    assert.equal(ev.freshness?.ageAtRequestStartMs, 1_000);
    assert.equal(ev.freshness?.ageAtReceiptMs, 20_000);
    assert.equal(ev.freshness?.status, "verified_stale");
    assert.equal(ev.quant, null);
    assert.equal(ev.decision, "NO_TRADE");
  });

  it("never labels the gate as request-start-relative", async () => {
    const ev = await build({ now: openNow, fetchImpl: stub() });
    assert.notEqual(ev.freshness?.freshnessBasis, "request-start-relative");
    assert.ok(!JSON.stringify(ev).includes('"request-start-relative"'));
  });
});

describe("evidence surface — closed-session veto (Phase 1 Option 4)", () => {
  /** 2026-09-30T20:00Z = 16:00 ET, exactly at the TradFi close. */
  const closedNow = new Date("2026-09-30T20:00:00Z");
  const closedStub = () => stub({ generatedAt: "2026-09-30T19:59:59.514Z" });

  it("blocks Quant while TradFi is closed, however fresh the quote", async () => {
    const ev = await build({
      now: closedNow,
      clock: () => new Date(closedNow.getTime() + 174),
      fetchImpl: closedStub(),
    });
    assert.equal(ev.regime.regime, "tradfi_closed");
    // The quote IS fresh. That is exactly the trap this policy closes.
    assert.equal(ev.freshness?.status, "verified_fresh");
    // ...and Quant still does not run.
    assert.equal(ev.quant, null);
    assert.equal(ev.gate.usable, false);
    assert.equal(ev.gate.closedSessionVeto !== null, true);
    assert.equal(ev.decision, "NO_TRADE");
    assert.equal(ev.executable, false);
  });

  it("names the closed-session reason explicitly", async () => {
    const ev = await build({
      now: closedNow,
      clock: () => new Date(closedNow.getTime() + 174),
      fetchImpl: closedStub(),
    });
    assert.ok(ev.gate.closedSessionVeto?.includes("CLOSED_SESSION_VETO"));
    assert.ok(ev.blockingReasons.some((r) => r.includes("CLOSED_SESSION_VETO")));
    assert.equal(ev.gate.policy, "BLOCK_QUANT_WHEN_TRADFI_CLOSED");
  });

  it("applies the veto during a closure window even if freshness also fails", async () => {
    // Both fail. The veto must still be present and still yield NO_TRADE.
    // A 24h-old quote. In the closed regime `assertBenchmarkProvable` widens the
    // ceiling to 7 days, so freshness ALONE would admit this. That is the exact
    // widening this policy exists to neutralise: the veto must be the reason
    // that blocks, not a freshness failure that happens to coincide.
    const ev = await build({
      now: closedNow,
      clock: () => new Date(closedNow.getTime() + 174),
      fetchImpl: stub({ generatedAt: "2026-09-29T19:59:59.514Z" }),
    });
    assert.equal(ev.quant, null);
    assert.equal(ev.decision, "NO_TRADE");
    assert.ok(ev.blockingReasons.some((r) => r.includes("CLOSED_SESSION_VETO")));
    // Pinned deliberately: freshness did NOT fail, because the closure ceiling
    // is 7 days. If this ever flips to a freshness failure, the widened
    // ceiling has changed and this policy needs re-review.
    assert.equal(
      ev.blockingReasons.some((r) => r.includes("freshness cannot be established")),
      false,
      "a 24h quote is inside the 7-day closure ceiling; the veto alone must block",
    );
  });

  it("records that a fresh quote would otherwise have been admitted when closed", async () => {
    // The trap, isolated: freshness passes, gate would open, and only the
    // closed-session veto prevents a verdict.
    const ev = await build({
      now: closedNow,
      clock: () => new Date(closedNow.getTime() + 174),
      fetchImpl: stub({ generatedAt: "2026-09-30T19:59:59.514Z" }),
    });
    assert.equal(ev.freshness?.status, "verified_fresh", "the quote is genuinely fresh");
    assert.equal(ev.gate.usable, false, "yet the gate is closed anyway");
    assert.notEqual(ev.gate.closedSessionVeto, null);
    assert.equal(ev.decision, "NO_TRADE");
  });

  it("vetoes even when a provider error means no quote was read at all", async () => {
    const ev = await build({
      now: closedNow,
      fetchImpl: stub({ priceStatus: 503 }),
    });
    assert.equal(ev.decision, "NO_TRADE");
    assert.equal(ev.quant, null);
    assert.ok(ev.blockingReasons.some((r) => r.includes("CLOSED_SESSION_VETO")));
  });

  it("evaluates Quant while TradFi is open", async () => {
    const ev = await build({ now: NOW, fetchImpl: stub() });
    assert.equal(ev.regime.regime, "tradfi_open");
    assert.equal(ev.gate.closedSessionVeto, null);
    assert.notEqual(ev.quant, null);
    assert.equal(ev.decision, "ELIGIBLE_FOR_DISPATCH_DESIGN");
    // Eligible for the DESIGN, still not executable: no bridge exists.
    assert.equal(ev.executable, false);
  });

  it("does not let a positive edge survive the closed-session veto", async () => {
    // A wide dislocation that would clearly be a positive edge if it ran.
    const ev = await build({
      now: closedNow,
      clock: () => new Date(closedNow.getTime() + 174),
      fetchImpl: stub({ generatedAt: "2026-09-30T19:59:59.514Z", bid: "139.90", ask: "140.10" }),
    });
    assert.equal(ev.quant, null, "Quant must not run closed, so no edge may be produced");
    assert.equal(ev.decision, "NO_TRADE");
  });
});

describe("evidence surface — no credentials, no venue writes", () => {
  it("works with no Bitget credentials configured at all", async () => {
    // buildEvidenceResponse constructs its own client with empty keys. If any
    // private route were touched, it would fail or require signing; this test
    // passing at all is the assertion that only public reads happen.
    const ev = await build({ now: NOW, fetchImpl: stub() });
    assert.equal(ev.status, "ok");
  });

  it("never emits a receipt: the surface seals nothing", async () => {
    const ev = await build({ now: NOW, fetchImpl: stub() });
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
