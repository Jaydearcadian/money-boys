import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeQuant } from "../src/agents/quant.js";

/**
 * Quant Boy Alpha Engine (CLM-004 / GAP-004).
 *
 * Fixtures: +2.93% dislocation with P_close = 60_000, P_token = 61_758
 * (B_raw = 1758/60000 = 0.0293 exactly). Q = $5,000.
 */

const P_CLOSE = 60_000;
const P_TOKEN = 61_758; // +2.93% dislocation
const Q = 5_000;

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

describe("QuantBoy Alpha Engine (CLM-004 / GAP-004)", () => {
  it("T1 Alpha Detection: +2.93% spread on deep book clears hurdle (SELL_BASIS, edge > 1.5%, score >= 75)", () => {
    const r = analyzeQuant({
      tokenPrice: P_TOKEN,
      tradFiClosePrice: P_CLOSE,
      orderSizeUsd: Q,
      depth: deepDepth(),
      fundingRate8h: 0.0001,
      hoursToClose: 8,
      takerFee: 0.0006,
    });
    assert.ok(Math.abs(r.rawBasis - 0.0293) < 1e-9, `rawBasis ${r.rawBasis}`);
    assert.equal(r.action, "SELL_BASIS");
    assert.ok(r.netEdgePct > 1.5, `netEdgePct ${r.netEdgePct}`);
    assert.ok(r.quantScore >= 75.0, `quantScore ${r.quantScore}`);
    assert.equal(r.completeFill, true);
    assert.equal(r.sideWalked, "bids");
  });

  it("T2 Depth Slippage Hurdle: same spread on thin book fails hurdle (NEUTRAL, score < 50)", () => {
    const r = analyzeQuant({
      tokenPrice: P_TOKEN,
      tradFiClosePrice: P_CLOSE,
      orderSizeUsd: Q,
      depth: {
        // Total bid depth ~$617 + $2,900 = ~$3.5k < $5k Q -> incomplete fill,
        // conservative 5% slippage floor wipes the 2.93% dislocation.
        bids: [
          { price: 61_750, quantity: 0.01 },
          { price: 58_000, quantity: 0.05 },
        ],
        asks: [{ price: 61_760, quantity: 0.01 }],
      },
      fundingRate8h: 0.0001,
      hoursToClose: 8,
      takerFee: 0.0006,
    });
    assert.ok(Math.abs(r.rawBasis - 0.0293) < 1e-9, `rawBasis ${r.rawBasis}`);
    assert.ok(r.netEdge <= 0, `netEdge ${r.netEdge}`);
    assert.equal(r.action, "NEUTRAL");
    assert.ok(r.quantScore < 50.0, `quantScore ${r.quantScore}`);
    assert.equal(r.completeFill, false);
  });

  it("T3 Funding Carry Drag: 48h window with elevated funding expands hurdle and compresses edge", () => {
    const base = {
      tokenPrice: P_TOKEN,
      tradFiClosePrice: P_CLOSE,
      orderSizeUsd: Q,
      depth: deepDepth(),
      fundingRate8h: 0.001, // elevated 0.10% / 8h
      takerFee: 0.0006,
    };
    const shortWin = analyzeQuant({ ...base, hoursToClose: 8 });
    const longWin = analyzeQuant({ ...base, hoursToClose: 48 });
    // carry: 0.001 * 1 = 0.001 vs 0.001 * 6 = 0.006
    assert.ok(longWin.fundingCarry > shortWin.fundingCarry, "carry expands");
    assert.ok(longWin.hurdleRate > shortWin.hurdleRate, "hurdle expands");
    assert.ok(longWin.netEdge < shortWin.netEdge, "edge compresses");
    assert.ok(
      Math.abs(longWin.hurdleRate - shortWin.hurdleRate - 0.005) < 1e-6,
      `hurdle delta ${longWin.hurdleRate - shortWin.hurdleRate}`,
    );
  });

  it("T4 Fail-Closed Stability: empty book does not throw, fails closed (NEUTRAL, score < 50)", () => {
    const r = analyzeQuant({
      tokenPrice: P_TOKEN,
      tradFiClosePrice: P_CLOSE,
      orderSizeUsd: Q,
      depth: { bids: [], asks: [] },
      fundingRate8h: 0.0001,
      hoursToClose: 8,
      takerFee: 0.0006,
    });
    assert.equal(r.action, "NEUTRAL");
    assert.equal(r.vwapPrice, null);
    assert.equal(r.completeFill, false);
    assert.ok(r.quantScore < 50.0, `quantScore ${r.quantScore}`);
    assert.ok(r.netEdge <= 0, `netEdge ${r.netEdge}`);
  });
});
