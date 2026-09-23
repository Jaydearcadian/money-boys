import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateBasisSpread } from "../src/agents/quant.js";
import { sealReceipt, verifyReceipt } from "../src/council/receipts.js";
import {
  StructuralChangeGuard,
  toBlastRadiusReport,
} from "../src/skills/igraph-guard/security.js";

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

/** Representative reconciled APPROVED receipt input (quant + guard pass). */
function approvedInput() {
  const quantMetrics = evaluateBasisSpread({
    tokenPrice: 61_758,
    tradFiClosePrice: 60_000,
    orderSizeUsd: 5_000,
    depth: deepDepth(),
    fundingRate8h: 0.0001,
    hoursToClose: 8,
    takerFee: 0.0006,
  });
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
  return {
    symbol: "BTCUSDT",
    action: quantMetrics.action,
    quantMetrics,
    riskReport: toBlastRadiusReport(blast),
    councilScores: {
      compositeScore: quantMetrics.quantScore,
      quant: quantMetrics.quantScore,
      risk: 100,
    },
    decision: "APPROVED",
    rationale: "Guard permitted; edge clears hurdle; council approves.",
  } as const;
}

/** Representative reconciled VETOED receipt input (guard veto). */
function vetoedInput() {
  const base = approvedInput();
  const blast = StructuralChangeGuard.evaluateBlastRadius(
    // exposure = 0.1 * 61_758 = $6,175.80 > $5,000 cap -> HARD_VETO
    { symbol: "BTCUSDT", side: "sell", quantity: 0.1, priceUsd: 61_758 },
    {
      equityUsd: 100_000,
      usedMarginUsd: 0,
      freeMarginUsd: 100_000,
      openOrders: [],
    },
  );
  assert.equal(blast.decision, "HARD_VETO");
  return {
    ...base,
    riskReport: toBlastRadiusReport(blast),
    councilScores: { ...base.councilScores, risk: 0, compositeScore: 12.5 },
    decision: "VETOED",
    rationale: "Risk guard HARD_VETO: exposure exceeds $5,000 cap; council vetoes.",
  } as const;
}

describe("ReasoningReceipt SHA-256 sealing (CLM-003, reconciled shape)", () => {
  it("seals and verifies an approved trade receipt (quant + permitted guard)", () => {
    const sealed = sealReceipt(approvedInput() as unknown as Record<string, unknown>);
    assert.match(sealed.receiptHash, /^[0-9a-f]{64}$/);
    assert.equal(verifyReceipt(sealed), true);
  });

  it("seals and verifies a vetoed trade receipt (guard HARD_VETO)", () => {
    const sealed = sealReceipt(vetoedInput() as unknown as Record<string, unknown>);
    assert.equal(sealed.decision, "VETOED");
    assert.equal(sealed.riskReport.permitted, false);
    assert.ok(sealed.riskReport.rejectionReason);
    assert.equal(verifyReceipt(sealed), true);
  });

  it("detects tampering with riskReport.projectedLiquidationPrice", () => {
    const sealed = sealReceipt(approvedInput() as unknown as Record<string, unknown>);
    assert.equal(verifyReceipt(sealed), true);
    const tampered = {
      ...sealed,
      riskReport: { ...sealed.riskReport, projectedLiquidationPrice: 99999.99 },
    };
    assert.equal(verifyReceipt(tampered), false);
  });

  it("detects tampering with quantMetrics.netEdgePct", () => {
    const sealed = sealReceipt(approvedInput() as unknown as Record<string, unknown>);
    assert.equal(verifyReceipt(sealed), true);
    const tampered = {
      ...sealed,
      quantMetrics: { ...sealed.quantMetrics, netEdgePct: 9.99 },
    };
    assert.equal(verifyReceipt(tampered), false);
  });

  it("is key-order independent: differently ordered inputs yield identical receiptHash", () => {
    const orderedA = approvedInput() as unknown as Record<string, unknown>;
    // Same logical payload, top-level keys inserted in reverse order.
    const orderedB = Object.fromEntries(
      Object.entries(orderedA).reverse(),
    ) as unknown as Record<string, unknown>;

    const sealedA = sealReceipt(orderedA);
    const sealedB = sealReceipt(orderedB);

    assert.equal(verifyReceipt(sealedA), true);
    assert.equal(verifyReceipt(sealedB), true);
    assert.equal(sealedB.receiptHash, sealedA.receiptHash);
  });
});
