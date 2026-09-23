import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateBasisSpread } from "../src/agents/quant.js";
import { sealReceipt, verifyReceipt } from "../src/council/receipts.js";
import {
  StructuralChangeGuard,
  toBlastRadiusReport,
} from "../src/skills/igraph-guard/security.js";

/**
 * Hot-path integration (pre-flight directive, Step 3):
 *   evaluateBasisSpread() -> StructuralChangeGuard.evaluateBlastRadius()
 *   -> toBlastRadiusReport() -> sealReceipt() -> verifyReceipt().
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

describe("hot-path integration: quant -> risk guard -> receipt seal/verify", () => {
  it("Case 1: liquid book, profitable basis, safe margin -> APPROVED receipt seals and verifies", () => {
    // +2.93% dislocation (61_758 vs 60_000 close) on a deep book.
    const quant = evaluateBasisSpread({
      tokenPrice: 61_758,
      tradFiClosePrice: 60_000,
      orderSizeUsd: 5_000,
      depth: deepDepth(),
      fundingRate8h: 0.0001,
      hoursToClose: 8,
      takerFee: 0.0006,
    });
    assert.equal(quant.action, "SELL_BASIS");
    assert.ok(quant.netEdge > 0, `netEdge ${quant.netEdge}`);

    // exposure = 0.08 * 61_758 = $4,940.64 <= $5,000; utilization =
    // (1_000 + 4_940.64) / 20_000 = 29.7% <= 65% -> APPROVED.
    const blast = StructuralChangeGuard.evaluateBlastRadius(
      { symbol: "BTCUSDT", side: "sell", quantity: 0.08, priceUsd: 61_758 },
      {
        equityUsd: 20_000,
        usedMarginUsd: 1_000,
        freeMarginUsd: 19_000,
        openOrders: [],
      },
    );
    assert.equal(blast.decision, "APPROVED");
    const riskReport = toBlastRadiusReport(blast);
    assert.equal(riskReport.permitted, true);
    assert.equal(riskReport.rejectionReason, undefined);

    const sealed = sealReceipt({
      symbol: "BTCUSDT",
      action: quant.action,
      quantMetrics: quant,
      riskReport,
      councilScores: {
        compositeScore: quant.quantScore,
        quant: quant.quantScore,
        risk: 100,
      },
      decision: "APPROVED",
      rationale: "Liquid book, +2.93% basis clears hurdle, margin safe; council approves.",
    });
    assert.equal(sealed.decision, "APPROVED");
    assert.equal(verifyReceipt(sealed), true);
  });

  it("Case 2: risk guard veto (exposure > $5,000) -> VETOED receipt seals and verifies", () => {
    const quant = evaluateBasisSpread({
      tokenPrice: 61_758,
      tradFiClosePrice: 60_000,
      orderSizeUsd: 5_000,
      depth: deepDepth(),
      fundingRate8h: 0.0001,
      hoursToClose: 8,
      takerFee: 0.0006,
    });
    assert.equal(quant.action, "SELL_BASIS");

    // exposure = 0.1 * 61_758 = $6,175.80 > $5,000 single-trade cap -> HARD_VETO.
    const blast = StructuralChangeGuard.evaluateBlastRadius(
      { symbol: "BTCUSDT", side: "sell", quantity: 0.1, priceUsd: 61_758 },
      {
        equityUsd: 100_000,
        usedMarginUsd: 0,
        freeMarginUsd: 100_000,
        openOrders: [],
      },
    );
    assert.equal(blast.decision, "HARD_VETO");
    const riskReport = toBlastRadiusReport(blast);
    assert.equal(riskReport.permitted, false);
    assert.ok(riskReport.rejectionReason);

    const sealed = sealReceipt({
      symbol: "BTCUSDT",
      action: quant.action,
      quantMetrics: quant,
      riskReport,
      councilScores: { compositeScore: 12.5, quant: quant.quantScore, risk: 0 },
      decision: "VETOED",
      rationale: "Risk guard HARD_VETO: exposure $6,175.80 exceeds $5,000 cap; council vetoes.",
    });
    assert.equal(sealed.decision, "VETOED");
    assert.equal(verifyReceipt(sealed), true);
  });
});
