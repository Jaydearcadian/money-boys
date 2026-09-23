import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFailClosedBenchmarkVeto,
  executeDeliberationCycle,
  FAIL_CLOSED_BENCHMARK_RATIONALE,
} from "../src/council/adapter.js";
import { sealReceipt, verifyReceipt } from "../src/council/receipts.js";
import { OrderDispatcher } from "../src/bitget/dispatcher.js";
import {
  BenchmarkFeedUnavailableError,
  fetchTradFiBenchmark,
  cleanUnderlyingSymbol,
  FRIDAY_CLOSE_SNAPSHOT,
} from "../src/agents/benchmarks.js";
import { hashCatalystPayload } from "../src/skills/noema-qa/provenance.js";
import { evaluateBasisSpread } from "../src/agents/quant.js";

/**
 * Phase 05 dispatch hardening (Sections 1, 2, 4, 5):
 * T1 recursive soft-reject, T2 dispatcher guard, T3 paper dispatch,
 * T4a default fail-closed, T4b opt-in fallback, T4c adapter veto, T4d boot guard, T5 latency profile.
 */

function fixedDepth(mid: number, availUsd = 7500) {
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

function catalyst(symbol: string, score: number) {
  return {
    symbol,
    direction: "BEARISH" as const,
    score,
    confidence: 0.8,
    catalysts: [
      {
        title: "Hardening fixture catalyst",
        detail: "Deterministic dispatch-hardening fixture",
        sentiment: "BEARISH" as const,
        confidence: 0.8,
      },
    ],
    evidenceHash: hashCatalystPayload({ symbol, score }),
    rationale: "Dispatch hardening fixture proposal.",
    modelId: "dispatch-hardening-fixture",
  };
}

describe("dispatch hardening (Phase 05)", () => {
  it("T1 recursive soft-reject: marginal macro triggers Pass 2 at 50% quantity and approves", () => {
    // Marginal macro=70 with ~150bps dislocation on a coverage-constrained
    // book: Pass 1 SOFT_REJECT (S in 60-75, quorum 3/4); halved Pass 2
    // restores full depth coverage and clears S >= 75.
    const close = 60_000;
    const token = close * 1.015;
    const quantity = Math.floor((4800 / token) * 1e4) / 1e4;
    const orderSizeUsd = Math.round(quantity * token * 100) / 100;
    const cycle = executeDeliberationCycle(
      catalyst("BTCUSDT", 70),
      fixedDepth(token),
      { equityUsd: 15_000, usedMarginUsd: 1_000, freeMarginUsd: 14_000, openOrders: [] },
      {
        symbol: "BTCUSDT",
        side: "sell",
        quantity,
        priceUsd: token,
        tokenPrice: token,
        tradFiClosePrice: close,
        orderSizeUsd,
        fundingRate8h: 0.0001,
        hoursToClose: 8,
        takerFee: 0.0006,
      },
    );
    assert.equal(cycle.passNumber, 2);
    assert.equal(cycle.deliberation.status, "APPROVED");
    assert.equal(cycle.receipt.decision, "APPROVED");
    assert.ok(cycle.deliberation.compositeScore >= 75, `S=${cycle.deliberation.compositeScore}`);
    const expectedQty = Math.floor(quantity * 0.5 * 1e4) / 1e4;
    assert.equal(cycle.executionQuantity, expectedQty);
    assert.ok(cycle.executionQuantity < quantity, "exposure reduced");
    assert.ok(
      cycle.receipt.rationale.includes("[SOFT_REJECT_SCALED_PASS2]"),
      cycle.receipt.rationale,
    );
    assert.deepEqual(cycle.receipt.metadata, {
      passNumber: 2,
      originalQuantity: quantity,
      executedQuantity: expectedQty,
    });
    assert.equal(verifyReceipt(cycle.receipt), true);
  });

  it("T2 dispatcher guard: dispatch() throws on a VETOED receipt", async () => {
    const quant = evaluateBasisSpread({
      tokenPrice: 61_758,
      tradFiClosePrice: 60_000,
      orderSizeUsd: 5_000,
      depth: fixedDepth(61_758, 24_000),
      fundingRate8h: 0.0001,
      hoursToClose: 8,
      takerFee: 0.0006,
    });
    const vetoed = sealReceipt({
      symbol: "BTCUSDT",
      action: quant.action,
      quantMetrics: quant,
      riskReport: {
        permitted: false,
        projectedMarginUtilizationPct: 120,
        projectedLiquidationPrice: null,
        staleOrdersToCancel: [],
        rejectionReason: "HARD_VETO fixture",
      },
      councilScores: { compositeScore: 10, macro: 10, quant: 10, risk: 0, exec: 10 },
      decision: "VETOED",
      rationale: "Fixture veto.",
    });
    const dispatcher = new OrderDispatcher("PAPER");
    await assert.rejects(
      dispatcher.dispatch(vetoed, {
        symbol: "BTCUSDT",
        side: "SELL",
        quantity: 0.05,
        fillPriceUsd: 61_758,
      }),
      /Cannot dispatch unapproved receipt/,
    );
  });

  it("T3 paper dispatch: bg-paper- orderId, 0.06% fee, FILLED", async () => {
    const quant = evaluateBasisSpread({
      tokenPrice: 61_758,
      tradFiClosePrice: 60_000,
      orderSizeUsd: 5_000,
      depth: fixedDepth(61_758, 24_000),
      fundingRate8h: 0.0001,
      hoursToClose: 8,
      takerFee: 0.0006,
    });
    const approved = sealReceipt({
      symbol: "BTCUSDT",
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
      rationale: "Fixture approval.",
    });
    const dispatcher = new OrderDispatcher("PAPER");
    const rec = await dispatcher.dispatch(approved, {
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: 0.08,
      fillPriceUsd: 61_758,
    });
    assert.match(rec.orderId, /^bg-paper-[0-9a-f]{16}$/);
    assert.equal(rec.status, "FILLED");
    assert.equal(rec.mode, "PAPER");
    assert.equal(rec.receiptHash, approved.receiptHash);
    const expectedFee = Math.round(0.08 * 61_758 * 0.0006 * 100) / 100;
    assert.equal(rec.feeUsd, expectedFee);
  });

  it("T4a default fail-closed: offline/unreachable feed rejects with BenchmarkFeedUnavailableError", async () => {
    assert.equal(cleanUnderlyingSymbol("rNVDAUSDT"), "NVDA");
    assert.equal(cleanUnderlyingSymbol("rTSLAUSDT"), "TSLA");
    const unreachable: typeof fetch = () => {
      throw new Error("offline fixture");
    };
    await assert.rejects(
      fetchTradFiBenchmark("rNVDAUSDT", unreachable),
      (err: unknown) => err instanceof BenchmarkFeedUnavailableError,
    );
    const timeout: typeof fetch = (_url, opts) => {
      const err = new Error("aborted");
      (err as Error & { name: string }).name = "AbortError";
      void opts;
      throw err;
    };
    await assert.rejects(
      fetchTradFiBenchmark("rAAPLUSDT", timeout),
      (err: unknown) => err instanceof BenchmarkFeedUnavailableError,
    );
    const http500: typeof fetch = () =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      } as unknown as Response);
    await assert.rejects(
      fetchTradFiBenchmark("rNVDAUSDT", http500),
      (err: unknown) => err instanceof BenchmarkFeedUnavailableError,
    );
  });

  it("T4b explicit opt-in fallback: { allowFallback: true } yields verified LOCAL_SNAPSHOT", async () => {
    const unreachable: typeof fetch = () => {
      throw new Error("offline fixture");
    };
    const bench = await fetchTradFiBenchmark("rNVDAUSDT", unreachable, {
      allowFallback: true,
    });
    assert.equal(bench.symbol, "rNVDAUSDT");
    assert.equal(bench.closePriceUsd, FRIDAY_CLOSE_SNAPSHOT["rNVDAUSDT"]);
    assert.equal(bench.closePriceUsd, 128.8);
    assert.equal(bench.source, "LOCAL_SNAPSHOT");
    const timeout: typeof fetch = (_url, opts) => {
      const err = new Error("aborted");
      (err as Error & { name: string }).name = "AbortError";
      void opts;
      throw err;
    };
    const bench2 = await fetchTradFiBenchmark("rAAPLUSDT", timeout, {
      allowFallback: true,
    });
    assert.equal(bench2.closePriceUsd, 224.2);
    assert.equal(bench2.source, "LOCAL_SNAPSHOT");
  });

  it("T4c adapter interceptor: buildFailClosedBenchmarkVeto seals HARD_VETO with zero execution and no dispatch", () => {
    const close = 60_000;
    const token = close * 1.0293;
    const quantity = 0.08;
    const result = buildFailClosedBenchmarkVeto(
      catalyst("BTCUSDT", 85),
      fixedDepth(token, 24_000),
      { equityUsd: 20_000, usedMarginUsd: 1_000, freeMarginUsd: 19_000, openOrders: [] },
      {
        symbol: "BTCUSDT",
        side: "sell",
        quantity,
        priceUsd: token,
        tokenPrice: token,
        tradFiClosePrice: close,
        orderSizeUsd: 5_000,
        fundingRate8h: 0.0001,
        hoursToClose: 8,
        takerFee: 0.0006,
      },
    );
    assert.equal(result.deliberation.status, "HARD_VETO");
    assert.equal(result.receipt.decision, "VETOED");
    assert.ok(
      result.receipt.rationale.includes(FAIL_CLOSED_BENCHMARK_RATIONALE),
      result.receipt.rationale,
    );
    assert.ok(
      result.receipt.rationale.includes("FAIL_CLOSED: TradFi benchmark unavailable"),
      result.receipt.rationale,
    );
    assert.equal(verifyReceipt(result.receipt), true);
    assert.equal(result.executionQuantity, 0);
    assert.equal(result.executionExposureUsd, 0);
    assert.equal(result.executionRecord, undefined);
  });

  it("T4d dispatcher boot guard: TESTNET without credentials throws; PAPER boots keyless", () => {
    assert.throws(
      () => new OrderDispatcher("TESTNET"),
      /without bitgetClient|credentials/i,
    );
    const paper = new OrderDispatcher("PAPER");
    assert.equal(paper.mode, "PAPER");
  });

  it("T5 latency profile: JIT warm-up + median hot path under charter 50ms / empirical 10ms", () => {
    const close = 60_000;
    const token = close * 1.0293;
    const mkCycle = () =>
      executeDeliberationCycle(
        catalyst("BTCUSDT", 85),
        fixedDepth(token, 24_000),
        { equityUsd: 20_000, usedMarginUsd: 1_000, freeMarginUsd: 19_000, openOrders: [] },
        {
          symbol: "BTCUSDT",
          side: "sell",
          quantity: 0.08,
          priceUsd: token,
          tokenPrice: token,
          tradFiClosePrice: close,
          orderSizeUsd: 5_000,
          fundingRate8h: 0.0001,
          hoursToClose: 8,
          takerFee: 0.0006,
        },
      );
    // JIT warm-up: 3 untimed runs to settle V8 inline caches / module resolution
    // on multi-tenant vCPUs before measured iterations.
    for (let i = 0; i < 3; i++) mkCycle();
    const samples: number[] = [];
    let last = mkCycle();
    for (let i = 0; i < 5; i++) {
      const output = mkCycle();
      last = output;
      const hotPathMs =
        output.latencies.quantMs + output.latencies.riskMs + output.latencies.execMs;
      samples.push(hotPathMs);
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const medianHotPathMs = sorted[Math.floor(sorted.length / 2)];
    const lat = last.latencies;
    assert.ok(lat.totalPipelineMs > 0, `total ${lat.totalPipelineMs}`);
    for (const [k, v] of Object.entries(lat)) {
      assert.ok(v >= 0, `${k}=${v}`);
    }
    assert.ok(
      medianHotPathMs < 50,
      `I-04 violation: Hot-path median (${medianHotPathMs.toFixed(2)}ms) must be < 50ms`,
    );
    assert.ok(
      medianHotPathMs < 10,
      `Empirical target exceeded: Hot-path median (${medianHotPathMs.toFixed(2)}ms) must be < 10ms`,
    );
  });

  it("T6 adapter+dispatcher: APPROVED cycle auto-dispatches PAPER executionRecord", async () => {
    const close = 60_000;
    const token = close * 1.0293;
    const dispatcher = new OrderDispatcher("PAPER");
    const cycle = await executeDeliberationCycle(
      catalyst("BTCUSDT", 85),
      fixedDepth(token, 24_000),
      { equityUsd: 20_000, usedMarginUsd: 1_000, freeMarginUsd: 19_000, openOrders: [] },
      {
        symbol: "BTCUSDT",
        side: "sell",
        quantity: 0.08,
        priceUsd: token,
        tokenPrice: token,
        tradFiClosePrice: close,
        orderSizeUsd: 5_000,
        fundingRate8h: 0.0001,
        hoursToClose: 8,
        takerFee: 0.0006,
      },
      dispatcher,
    );
    assert.equal(cycle.receipt.decision, "APPROVED");
    assert.ok(cycle.executionRecord, "executionRecord attached");
    assert.match(cycle.executionRecord.orderId, /^bg-paper-[0-9a-f]{16}$/);
    assert.equal(cycle.executionRecord.status, "FILLED");
    assert.equal(cycle.executionRecord.receiptHash, cycle.receipt.receiptHash);
  });

  it("T7 scaled failure: Pass 2 still short of 75 seals VETOED with SCALED_FAILED", () => {
    // Thin edge (60bps): Pass 1 SOFT_REJECT; halved Pass 2 still cannot
    // clear 75 -> VETOED, zero execution, SCALED_FAILED rationale.
    const close = 60_000;
    const token = close * 1.006;
    const quantity = Math.floor((4800 / token) * 1e4) / 1e4;
    const cycle = executeDeliberationCycle(
      catalyst("BTCUSDT", 70),
      fixedDepth(token),
      { equityUsd: 15_000, usedMarginUsd: 1_000, freeMarginUsd: 14_000, openOrders: [] },
      {
        symbol: "BTCUSDT",
        side: "sell",
        quantity,
        priceUsd: token,
        tokenPrice: token,
        tradFiClosePrice: close,
        orderSizeUsd: Math.round(quantity * token * 100) / 100,
        fundingRate8h: 0.0001,
        hoursToClose: 8,
        takerFee: 0.0006,
      },
    );
    assert.equal(cycle.passNumber, 2);
    assert.equal(cycle.receipt.decision, "VETOED");
    assert.equal(cycle.executionQuantity, 0);
    assert.equal(cycle.executionExposureUsd, 0);
    assert.ok(
      cycle.receipt.rationale.includes("[SOFT_REJECT_SCALED_FAILED]"),
      cycle.receipt.rationale,
    );
    assert.equal(verifyReceipt(cycle.receipt), true);
  });
});
