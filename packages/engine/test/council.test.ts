import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateBasisSpread } from "../src/agents/quant.js";
import { sealReceipt, verifyReceipt } from "../src/council/receipts.js";
import { reduceCouncilVote } from "../src/council/reducer.js";
import { executeDeliberationCycle } from "../src/council/adapter.js";
import {
  StructuralChangeGuard,
  toBlastRadiusReport,
} from "../src/skills/igraph-guard/security.js";
import { hashCatalystPayload } from "../src/skills/noema-qa/provenance.js";

/**
 * CLM-006 / GAP-006 — Council quorum, proposal reducer, cyclic handoff.
 * 4 invariant tests over the reducer + full deliberation cycle
 * (quant → risk → execution → reducer → seal).
 */

function deepDepth() {
  const bids = Array.from({ length: 10 }, (_, i) => ({
    price: 61_750 - i * 10,
    quantity: 2,
  }));
  const asks = Array.from({ length: 10 }, (_, i) => ({
    price: 61_760 + i * 10,
    quantity: 2,
  }));
  return { bids, asks };
}

function catalyst(symbol: string, score: number) {
  return {
    symbol,
    direction: "BULLISH" as const,
    score,
    confidence: 0.8,
    catalysts: [
      {
        title: "Test catalyst",
        detail: "Deterministic fixture catalyst",
        sentiment: "BULLISH" as const,
        confidence: 0.8,
      },
    ],
    evidenceHash: hashCatalystPayload({ symbol, score }),
    rationale: "Deterministic test catalyst proposal.",
    modelId: "test-fixture",
  };
}

function quantFixture() {
  return evaluateBasisSpread({
    tokenPrice: 61_758,
    tradFiClosePrice: 60_000,
    orderSizeUsd: 5_000,
    depth: deepDepth(),
    fundingRate8h: 0.0001,
    hoursToClose: 8,
    takerFee: 0.0006,
  });
}

describe("Council quorum + proposal reducer (CLM-006 / GAP-006)", () => {
  it("T1 High consensus (Macro=85, Quant=90, Risk=85, Exec=80) approves and seals receipt", () => {
    const deliberation = reduceCouncilVote({
      macroScore: 85,
      quantScore: 90,
      riskScore: 85,
      execScore: 80,
      riskPermitted: true,
      originalExposureUsd: 4_940.64,
    });
    // S = 21.25 + 31.50 + 21.25 + 12.00 = 86.0; quorum 4/4.
    assert.equal(deliberation.status, "APPROVED");
    assert.equal(deliberation.compositeScore, 86.0);
    assert.equal(deliberation.quorum, 4);

    const quant = quantFixture();
    const blast = StructuralChangeGuard.evaluateBlastRadius(
      { symbol: "BTCUSDT", side: "sell", quantity: 0.08, priceUsd: 61_758 },
      { equityUsd: 20_000, usedMarginUsd: 1_000, freeMarginUsd: 19_000, openOrders: [] },
    );
    const riskReport = toBlastRadiusReport(blast);
    assert.equal(riskReport.permitted, true);

    const sealed = sealReceipt({
      symbol: "BTCUSDT",
      action: quant.action,
      quantMetrics: quant,
      riskReport,
      councilScores: {
        compositeScore: deliberation.compositeScore,
        macro: 85,
        quant: 90,
        risk: 85,
        exec: 80,
      },
      decision: "APPROVED",
      rationale: "High consensus: S=86.0, quorum 4/4, risk permitted.",
    });
    assert.equal(sealed.decision, "APPROVED");
    assert.equal(verifyReceipt(sealed), true);

    // Cyclic handoff: full pipeline on the same safe fixture also approves.
    const cycle = executeDeliberationCycle(
      catalyst("BTCUSDT", 85),
      deepDepth(),
      { equityUsd: 20_000, usedMarginUsd: 1_000, freeMarginUsd: 19_000, openOrders: [] },
      {
        symbol: "BTCUSDT",
        side: "sell",
        quantity: 0.08,
        priceUsd: 61_758,
        tokenPrice: 61_758,
        tradFiClosePrice: 60_000,
        orderSizeUsd: 5_000,
        fundingRate8h: 0.0001,
        hoursToClose: 8,
        takerFee: 0.0006,
      },
    );
    assert.equal(cycle.deliberation.status, "APPROVED");
    assert.equal(cycle.receipt.decision, "APPROVED");
    assert.equal(verifyReceipt(cycle.receipt), true);
  });

  it("T2 Unilateral Risk veto rejects trade even when Macro=100 and Quant=100", () => {
    const deliberation = reduceCouncilVote({
      macroScore: 100,
      quantScore: 100,
      riskScore: 90,
      execScore: 80,
      riskPermitted: false,
      originalExposureUsd: 6_175.8,
    });
    assert.equal(deliberation.status, "HARD_VETO");

    const quant = quantFixture();
    const blast = StructuralChangeGuard.evaluateBlastRadius(
      { symbol: "BTCUSDT", side: "sell", quantity: 0.1, priceUsd: 61_758 },
      { equityUsd: 100_000, usedMarginUsd: 0, freeMarginUsd: 100_000, openOrders: [] },
    );
    assert.equal(blast.decision, "HARD_VETO");
    const riskReport = toBlastRadiusReport(blast);
    assert.equal(riskReport.permitted, false);

    const sealed = sealReceipt({
      symbol: "BTCUSDT",
      action: quant.action,
      quantMetrics: quant,
      riskReport,
      councilScores: {
        compositeScore: deliberation.compositeScore,
        macro: 100,
        quant: 100,
        risk: 0,
        exec: 80,
      },
      decision: "VETOED",
      rationale: "Risk hard veto overrides Macro=100/Quant=100.",
    });
    assert.equal(sealed.decision, "VETOED");
    assert.equal(verifyReceipt(sealed), true);
  });

  it("T3 Soft rejection (S=68.0) scales down exposure by 50% without dropping", () => {
    const deliberation = reduceCouncilVote({
      macroScore: 70,
      quantScore: 75,
      riskScore: 85,
      execScore: 20,
      riskPermitted: true,
      originalExposureUsd: 4_000,
    });
    // S = 17.50 + 26.25 + 21.25 + 3.00 = 68.0; quorum 3/4 (exec fails).
    assert.equal(deliberation.compositeScore, 68.0);
    assert.equal(deliberation.quorum, 3);
    assert.equal(deliberation.status, "SOFT_REJECT");
    assert.equal(deliberation.reducedExposureUsd, 2_000);

    const quant = quantFixture();
    const blast = StructuralChangeGuard.evaluateBlastRadius(
      { symbol: "BTCUSDT", side: "sell", quantity: 0.0647, priceUsd: 61_758 },
      { equityUsd: 20_000, usedMarginUsd: 1_000, freeMarginUsd: 19_000, openOrders: [] },
    );
    const riskReport = toBlastRadiusReport(blast);
    const sealed = sealReceipt({
      symbol: "BTCUSDT",
      action: quant.action,
      quantMetrics: quant,
      riskReport,
      councilScores: {
        compositeScore: deliberation.compositeScore,
        macro: 70,
        quant: 75,
        risk: 85,
        exec: 20,
      },
      decision: "VETOED",
      rationale: "SOFT_REJECT at S=68.0: scaled $4000 → $2000, proposal retained.",
    });
    assert.equal(verifyReceipt(sealed), true);
  });

  it("T4 Quorum failure (<3 members passing) terminates proposal", () => {
    const deliberation = reduceCouncilVote({
      macroScore: 60,
      quantScore: 60,
      riskScore: 85,
      execScore: 80,
      riskPermitted: true,
      originalExposureUsd: 4_000,
    });
    // Only risk + exec pass → quorum 2/4 → REJECTED despite S=69.25.
    assert.ok(deliberation.quorum < 3, `quorum ${deliberation.quorum}`);
    assert.equal(deliberation.status, "REJECTED");

    const quant = quantFixture();
    const blast = StructuralChangeGuard.evaluateBlastRadius(
      { symbol: "BTCUSDT", side: "sell", quantity: 0.08, priceUsd: 61_758 },
      { equityUsd: 20_000, usedMarginUsd: 1_000, freeMarginUsd: 19_000, openOrders: [] },
    );
    const riskReport = toBlastRadiusReport(blast);
    const sealed = sealReceipt({
      symbol: "BTCUSDT",
      action: quant.action,
      quantMetrics: quant,
      riskReport,
      councilScores: {
        compositeScore: deliberation.compositeScore,
        macro: 60,
        quant: 60,
        risk: 85,
        exec: 80,
      },
      decision: "VETOED",
      rationale: "Quorum failure (2/4): proposal terminated.",
    });
    assert.equal(sealed.decision, "VETOED");
    assert.equal(verifyReceipt(sealed), true);
  });
});
