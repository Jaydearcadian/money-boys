import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FORBIDDEN_UNDER_SIZED_QUANTITY,
  REPO_SYMBOL,
  VENUE_SYMBOL,
  buildPacket,
  resolveSizing,
  sealIntents,
} from "../src/bitget/strategy-packet.js";
import type { MixContractConfig } from "../src/bitget/client.js";
import { evaluateBasisSpread, type QuantAnalysisResult } from "../src/agents/quant.js";
import {
  assessBenchmarkFreshness,
  type BenchmarkEvidence,
} from "../src/agents/market-regime.js";

/** A provably fresh benchmark: upstream publishes a real sourceAsOf. */
function freshBenchmark(now: Date): BenchmarkEvidence {
  return assessBenchmarkFreshness({
    price: 228.0852,
    source: "EXPLICIT_TS_SOURCE",
    provider: "bitget_data",
    sourceAsOf: new Date(now.getTime() - 30_000).toISOString(),
    fetchedAt: now.toISOString(),
    maxAgeMs: 96 * 60 * 60 * 1000,
  });
}

const NOW = new Date("2026-09-30T14:00:00Z"); // 10:00 ET, TradFi open
const REGIME_OPEN = "tradfi_open" as const;

/**
 * Regression guard for the Stage 3 pre-flight packet generator.
 *
 * The generator used to hardcode quantity 0.01. For NVDAUSDT that is
 * $2.29 notional against a $5 venue minimum, so the packet advertised an
 * order the venue would reject. These tests pin the corrected behaviour:
 * sizing comes from BitgetClient.sizeToVenueCompliance, and a NEUTRAL
 * quant verdict can never produce an executable packet.
 */

/** Real values read from the Demo venue for NVDAUSDT on 2026-09-30. */
const NVDA: MixContractConfig = {
  symbol: VENUE_SYMBOL,
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

const ACCOUNT = { equityUsd: 9364.2, freeMarginUsd: 9364.2 };

function depth(mid: number) {
  return {
    bids: Array.from({ length: 10 }, (_, i) => ({ price: mid * (1 - 0.0002 * (i + 1)), quantity: 40 })),
    asks: Array.from({ length: 10 }, (_, i) => ({ price: mid * (1 + 0.0002 * (i + 1)), quantity: 40 })),
  };
}

/** Quant result with a real, schema-valid shape. */
function quantWith(netEdge: number, action: "BUY_BASIS" | "SELL_BASIS" | "NEUTRAL"): QuantAnalysisResult {
  const mid = 228.56;
  const real = evaluateBasisSpread({
    tokenPrice: mid,
    tradFiClosePrice: 228.5,
    orderSizeUsd: 25,
    depth: depth(mid),
    fundingRate8h: 0,
    hoursToClose: 1,
    takerFee: 0.0006,
  });
  // Deterministic override so both branches can be exercised without
  // depending on market drift.
  return { ...real, netEdge, netEdgePct: netEdge * 100, action } as QuantAnalysisResult;
}

describe("pre-flight sizing resolves venue compliance", () => {
  it("never emits the under-sized 0.01 / $2.29 quantity", () => {
    const s = resolveSizing(NVDA, { targetNotionalUsd: 2.29, referencePriceUsd: 228.56, freeMarginUsd: 9364.2 });
    assert.equal(s.ok, true, s.reasons.join("; "));
    assert.notEqual(s.compliantQuantity, FORBIDDEN_UNDER_SIZED_QUANTITY);
    assert.ok(s.roundedNotionalUsd! >= s.minNotionalUsdt,
      `notional ${s.roundedNotionalUsd} must clear minNotional ${s.minNotionalUsdt}`);
    assert.ok(s.compliantQuantity! >= s.minQty);
  });

  it("reports every venue constraint the operator needs to see", () => {
    const s = resolveSizing(NVDA, { targetNotionalUsd: 2.29, referencePriceUsd: 228.56, freeMarginUsd: 9364.2 });
    assert.equal(s.targetNotionalUsd, 2.29);
    assert.equal(s.minQty, 0.01);
    assert.equal(s.minNotionalUsdt, 5);
    assert.equal(s.multiplier, 0.01);
    assert.equal(s.precisionDecimalPlaces, 2);
    assert.ok(s.compliantQuantity! > 0);
    assert.ok(s.roundedNotionalUsd! > 0);
    assert.ok(s.steps.length > 0, "sizing steps must be recorded");
  });

  it("the final quantity satisfies minQty AND minNotional simultaneously", () => {
    for (const target of [0.01, 1, 2.29, 5, 25, 100]) {
      const s = resolveSizing(NVDA, { targetNotionalUsd: target, referencePriceUsd: 228.56, freeMarginUsd: 9364.2 });
      assert.equal(s.ok, true, `target ${target}: ${s.reasons.join("; ")}`);
      assert.ok(s.compliantQuantity! >= s.minQty, `target ${target} below minQty`);
      assert.ok(s.roundedNotionalUsd! >= s.minNotionalUsdt, `target ${target} below minNotional`);
      const steps = s.compliantQuantity! / s.multiplier;
      assert.ok(Math.abs(steps - Math.round(steps)) < 1e-6, `target ${target} not a whole multiple`);
    }
  });

  it("returns null when free margin cannot cover a compliant size", () => {
    const s = resolveSizing(NVDA, { targetNotionalUsd: 2.29, referencePriceUsd: 228.56, freeMarginUsd: 3 });
    assert.equal(s.ok, false);
    assert.equal(s.compliantQuantity, null);
    assert.ok(s.reasons.some((r: string) => r.includes("free margin")), s.reasons.join("; "));
  });

  it("returns null when the contract config is unusable", () => {
    const s = resolveSizing({ ...NVDA, minTradeUSDT: undefined }, { targetNotionalUsd: 25, referencePriceUsd: 228.56, freeMarginUsd: 9364.2 });
    assert.equal(s.ok, false);
    assert.equal(s.compliantQuantity, null);
  });
});

describe("packet assembly", () => {
  it("propagates the compliant quantity into the risk calculation", () => {
    const p = buildPacket({
      config: NVDA, quant: quantWith(0.005, "SELL_BASIS"),
      account: ACCOUNT, targetNotionalUsd: 2.29,
      benchmark: freshBenchmark(NOW), regime: REGIME_OPEN, hoursToNextReopen: 0,
    });
    assert.notEqual(p.risk, null);
    // Risk must see the COMPLIANT size, never the bare minQty.
    const expected = Number((p.sizing.compliantQuantity! * 228.56).toFixed(2));
    assert.equal(p.risk!.exposureUsd, expected);
    assert.ok(p.risk!.exposureUsd >= 5, "risk must be computed on a placeable notional");
  });

  it("NEUTRAL is never executable, even with Risk APPROVED", () => {
    const p = buildPacket({
      config: NVDA, quant: quantWith(0, "NEUTRAL"), account: ACCOUNT, targetNotionalUsd: 25,
      benchmark: freshBenchmark(NOW), regime: REGIME_OPEN, hoursToNextReopen: 0,
    });
    assert.equal(p.positiveNetEdge, false);
    assert.equal(p.executable, false);
    assert.equal(p.risk!.decision, "APPROVED", "risk may still approve");
    assert.ok(p.blockingReasons.some((r: string) => r.includes("Risk APPROVED does not override")),
      p.blockingReasons.join(" | "));
  });

  it("negative net edge with a non-NEUTRAL action still blocks", () => {
    const p = buildPacket({
      config: NVDA, quant: quantWith(-0.001, "SELL_BASIS"), account: ACCOUNT, targetNotionalUsd: 25,
      benchmark: freshBenchmark(NOW), regime: REGIME_OPEN, hoursToNextReopen: 0,
    });
    assert.equal(p.positiveNetEdge, false);
    assert.equal(p.executable, false);
  });

  it("a positive edge with compliant sizing is executable", () => {
    const p = buildPacket({
      config: NVDA, quant: quantWith(0.005, "SELL_BASIS"), account: ACCOUNT, targetNotionalUsd: 25,
      benchmark: freshBenchmark(NOW), regime: REGIME_OPEN, hoursToNextReopen: 0,
    });
    assert.equal(p.positiveNetEdge, true);
    assert.equal(p.executable, true, p.blockingReasons.join(" | "));
  });

  it("rejects the packet when sizing returns null", () => {
    const p = buildPacket({
      config: NVDA, quant: quantWith(0.005, "SELL_BASIS"),
      account: { equityUsd: 10, freeMarginUsd: 3 }, targetNotionalUsd: 2.29,
      benchmark: freshBenchmark(NOW), regime: REGIME_OPEN, hoursToNextReopen: 0,
    });
    assert.equal(p.sizing.compliantQuantity, null);
    assert.equal(p.executable, false);
    assert.ok(p.blockingReasons.some((r: string) => r.includes("sizing failed")));
    assert.equal(p.risk, null, "no size means no risk evaluation to report");
  });

  it("carries the compliant quantity and venue constraints into the packet", () => {
    const p = buildPacket({
      config: NVDA, quant: quantWith(0.005, "SELL_BASIS"), account: ACCOUNT, targetNotionalUsd: 2.29,
      benchmark: freshBenchmark(NOW), regime: REGIME_OPEN, hoursToNextReopen: 0,
    });
    assert.equal(p.venueSymbol, VENUE_SYMBOL);
    assert.equal(p.repositorySymbol, REPO_SYMBOL);
    assert.equal(p.sizing.compliantQuantity, 0.03);
    assert.equal(p.sizing.roundedNotionalUsd, 6.8568);
    assert.equal(p.referencePriceUsd, 228.56);
  });
});

describe("intent-bound clientOids", () => {
  it("derives distinct open/close ids from the same receipt", () => {
    const sizing = resolveSizing(NVDA, { targetNotionalUsd: 25, referencePriceUsd: 228.56, freeMarginUsd: 9364.2 });
    const i = sealIntents({
      quant: quantWith(0.005, "SELL_BASIS"),
      repositorySymbol: REPO_SYMBOL,
      sizing,
      projectedLiquidationPrice: 224,
      councilScores: { compositeScore: 80, macro: 70, quant: 75, risk: 80, exec: 75 },
      rationale: "test",
    });
    assert.match(i.receiptHash, /^[0-9a-f]{64}$/);
    assert.notEqual(i.clientOidOpen, i.clientOidClose);
    assert.equal(i.clientOidOpen.length, 32);
    assert.equal(i.clientOidClose.length, 32);
  });

  it("is deterministic for identical inputs", () => {
    const sizing = resolveSizing(NVDA, { targetNotionalUsd: 25, referencePriceUsd: 228.56, freeMarginUsd: 9364.2 });
    const args = {
      quant: quantWith(0.005, "SELL_BASIS"),
      repositorySymbol: REPO_SYMBOL,
      sizing,
      projectedLiquidationPrice: 224,
      councilScores: { compositeScore: 80, macro: 70, quant: 75, risk: 80, exec: 75 },
      rationale: "test",
    };
    assert.deepEqual(sealIntents(args), sealIntents(args));
  });

  it("a NEUTRAL packet still produces no authorization, only hashes", () => {
    const sizing = resolveSizing(NVDA, { targetNotionalUsd: 25, referencePriceUsd: 228.56, freeMarginUsd: 9364.2 });
    const i = sealIntents({
      quant: quantWith(0, "NEUTRAL"),
      repositorySymbol: REPO_SYMBOL,
      sizing,
      projectedLiquidationPrice: 224,
      councilScores: { compositeScore: 80, macro: 70, quant: 49.9, risk: 80, exec: 75 },
      rationale: "test",
    });
    assert.match(i.receiptHash, /^[0-9a-f]{64}$/);
    // A receipt hash is provenance, never an authorization. Executability is
    // decided by buildPacket, which is asserted separately.
  });
});

// ---------------------------------------------------------------------------
// The benchmark gate is wired into the REAL packet path, before Quant Boy.
//
// This is the GAP-015 control that previously existed in isolation and was
// never called. These tests exercise it through buildPacket, the function the
// pre-flight script actually uses.
// ---------------------------------------------------------------------------

describe("benchmark gate blocks the real packet path", () => {
  const unverifiable = assessBenchmarkFreshness({
    price: 228.0852,
    source: "BITGET_MCP_QUOTE", // the live MCP entry publishes no timestamp
    provider: "bitget_data",
    sourceAsOf: null,
    fetchedAt: NOW.toISOString(),
    maxAgeMs: 96 * 60 * 60 * 1000,
  });

  it("classifies the real MCP quote shape as unverifiable", () => {
    assert.equal(unverifiable.freshness, "unverifiable");
    assert.equal(unverifiable.sourceAsOf, null);
  });

  it("a missing source timestamp yields executable=false", () => {
    const p = buildPacket({
      config: NVDA, quant: quantWith(0.01, "SELL_BASIS"), account: ACCOUNT,
      targetNotionalUsd: 25, benchmark: unverifiable,
      regime: REGIME_OPEN, hoursToNextReopen: 0,
    });
    assert.equal(p.executable, false);
    assert.equal(p.benchmark!.usable, false);
    assert.ok(p.benchmark!.blockedReason);
  });

  it("Quant Boy does NOT run when the benchmark is unusable", () => {
    const p = buildPacket({
      config: NVDA, quant: quantWith(0.01, "SELL_BASIS"), account: ACCOUNT,
      targetNotionalUsd: 25, benchmark: unverifiable,
      regime: REGIME_OPEN, hoursToNextReopen: 0,
    });
    assert.equal(p.quantEvaluated, false);
    assert.equal(p.quant, null, "no quant verdict may exist without a provable benchmark");
    assert.equal(p.risk, null);
  });

  it("a POSITIVE edge still cannot become executable without a benchmark", () => {
    const p = buildPacket({
      config: NVDA, quant: quantWith(0.01, "SELL_BASIS"), account: ACCOUNT,
      targetNotionalUsd: 25, benchmark: unverifiable,
      regime: REGIME_OPEN, hoursToNextReopen: 0,
    });
    assert.equal(p.positiveNetEdge, false, "quant was never evaluated, so there is no edge");
    assert.equal(p.executable, false);
  });

  it("a STALE source timestamp also blocks", () => {
    const stale = assessBenchmarkFreshness({
      price: 128.8, source: "EXPLICIT_TS_SOURCE",
      sourceAsOf: "2026-09-18T20:00:00Z", fetchedAt: NOW.toISOString(),
      maxAgeMs: 96 * 60 * 60 * 1000,
    });
    assert.equal(stale.freshness, "verified_stale");
    const p = buildPacket({
      config: NVDA, quant: quantWith(0.01, "SELL_BASIS"), account: ACCOUNT,
      targetNotionalUsd: 25, benchmark: stale,
      regime: REGIME_OPEN, hoursToNextReopen: 0,
    });
    assert.equal(p.executable, false);
    assert.equal(p.quantEvaluated, false);
  });

  it("a null benchmark blocks before Quant", () => {
    const p = buildPacket({
      config: NVDA, quant: quantWith(0.01, "SELL_BASIS"), account: ACCOUNT,
      targetNotionalUsd: 25, benchmark: null,
      regime: REGIME_OPEN, hoursToNextReopen: 0,
    });
    assert.equal(p.executable, false);
    assert.equal(p.quantEvaluated, false);
    assert.equal(p.benchmark, null);
    assert.ok(p.blockingReasons.some((r: string) => r.includes("no benchmark")));
  });

  it("a provably fresh benchmark lets Quant and Risk run as before", () => {
    const p = buildPacket({
      config: NVDA, quant: quantWith(0.005, "SELL_BASIS"), account: ACCOUNT,
      targetNotionalUsd: 25, benchmark: freshBenchmark(NOW),
      regime: REGIME_OPEN, hoursToNextReopen: 0,
    });
    assert.equal(p.quantEvaluated, true);
    assert.equal(p.benchmark!.usable, true);
    assert.equal(p.benchmark!.freshness, "verified_fresh");
    assert.equal(p.executable, true, p.blockingReasons.join(" | "));
  });

  it("the packet preserves provider, source, sourceAsOf and freshness separately", () => {
    const p = buildPacket({
      config: NVDA, quant: quantWith(0.005, "SELL_BASIS"), account: ACCOUNT,
      targetNotionalUsd: 25, benchmark: freshBenchmark(NOW),
      regime: REGIME_OPEN, hoursToNextReopen: 0,
    });
    const b = p.benchmark!;
    assert.equal(b.provider, "bitget_data");
    assert.equal(b.source, "EXPLICIT_TS_SOURCE");
    assert.equal(b.sourceAsOf, freshBenchmark(NOW).sourceAsOf);
    assert.equal(b.fetchedAt, NOW.toISOString());
    assert.equal(b.freshness, "verified_fresh");
    assert.notEqual(b.sourceAsOf, b.fetchedAt);
  });

  it("isLocalSnapshot is never used as a freshness substitute", () => {
    const snap = assessBenchmarkFreshness({
      price: 128.8, source: "LOCAL_SNAPSHOT",
      sourceAsOf: NOW.toISOString(), fetchedAt: NOW.toISOString(),
      maxAgeMs: 96 * 60 * 60 * 1000,
    });
    assert.equal(snap.freshness, "unverifiable");
    const p = buildPacket({
      config: NVDA, quant: quantWith(0.01, "SELL_BASIS"), account: ACCOUNT,
      targetNotionalUsd: 25, benchmark: snap,
      regime: REGIME_OPEN, hoursToNextReopen: 0,
    });
    assert.equal(p.executable, false);
  });

  it("carries the regime-derived carry horizon into the packet", () => {
    const p = buildPacket({
      config: NVDA, quant: quantWith(0.005, "SELL_BASIS"), account: ACCOUNT,
      targetNotionalUsd: 25, benchmark: freshBenchmark(NOW),
      regime: "tradfi_closed", hoursToNextReopen: 65.5,
    });
    assert.equal(p.hoursToNextReopen, 65.5);
    assert.equal(p.benchmark!.regime, "tradfi_closed");
  });
});
