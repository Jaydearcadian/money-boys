import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StructuralChangeGuard } from "../src/skills/igraph-guard/security.js";

describe("StructuralChangeGuard.evaluateBlastRadius (CLM-002)", () => {
  it("approves a safe trade and surfaces same-symbol cancels + liq estimate", () => {
    const r = StructuralChangeGuard.evaluateBlastRadius(
      { symbol: "BTCUSDT", side: "buy", quantity: 0.01, priceUsd: 60_000 },
      {
        equityUsd: 20_000,
        usedMarginUsd: 1_000,
        freeMarginUsd: 19_000,
        openOrders: [
          { orderId: "o1", symbol: "BTCUSDT" },
          { orderId: "o2", symbol: "ETHUSDT" },
        ],
      },
    );
    // exposure = 600; utilization = 1600/20000 = 8%
    assert.equal(r.decision, "APPROVED");
    assert.deepEqual(r.reasons, []);
    assert.equal(r.exposureUsd, 600);
    assert.equal(r.projectedMarginUtilization, 0.08);
    assert.deepEqual(r.cancelCandidates, ["o1"]);
    assert.ok(r.projectedLiquidationPrice !== null && r.projectedLiquidationPrice > 0);
  });

  it("vetoes exposure breaching the $5,000 single-trade cap", () => {
    const r = StructuralChangeGuard.evaluateBlastRadius(
      { symbol: "BTCUSDT", side: "buy", quantity: 0.1, priceUsd: 60_000 },
      {
        equityUsd: 100_000,
        usedMarginUsd: 0,
        freeMarginUsd: 100_000,
        openOrders: [],
      },
    );
    // exposure = 6000 > 5000; utilization = 6% (passes R3), free margin passes R2
    assert.equal(r.decision, "HARD_VETO");
    assert.equal(r.exposureUsd, 6000);
    assert.ok(r.reasons.some((x) => x.includes("$5,000") || x.includes("5000")));
    assert.equal(r.projectedLiquidationPrice, null);
  });

  it("vetoes projected margin utilization above 65%", () => {
    const r = StructuralChangeGuard.evaluateBlastRadius(
      // exposure = 4000 (under $5k cap)
      { symbol: "BTCUSDT", side: "buy", quantity: 0.05, priceUsd: 80_000 },
      // utilization = (3000 + 4000) / 10000 = 70% > 65%
      {
        equityUsd: 10_000,
        usedMarginUsd: 3_000,
        freeMarginUsd: 7_000,
        openOrders: [],
      },
    );
    assert.equal(r.decision, "HARD_VETO");
    assert.equal(r.projectedMarginUtilization, 0.7);
    assert.ok(r.reasons.some((x) => x.includes("65.0%")));
    assert.equal(r.projectedLiquidationPrice, null);
  });

  it("vetoes exposure exceeding free margin", () => {
    const r = StructuralChangeGuard.evaluateBlastRadius(
      // exposure = 1000 (under $5k, utilization 10% — only R2 trips)
      { symbol: "BTCUSDT", side: "sell", quantity: 0.02, priceUsd: 50_000 },
      {
        equityUsd: 10_000,
        usedMarginUsd: 0,
        freeMarginUsd: 500,
        openOrders: [],
      },
    );
    assert.equal(r.decision, "HARD_VETO");
    assert.ok(r.reasons.some((x) => x.includes("free margin")));
    assert.equal(r.projectedLiquidationPrice, null);
  });
});
