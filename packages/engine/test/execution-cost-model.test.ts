import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ADVERSE_SELECTION,
  DEFAULT_MAKER_FEE,
  evaluateBasisSpread,
  type MarketDepth,
} from "../src/agents/quant.js";
import { computeInventoryQuote } from "../src/agents/inventory-quote.js";
import { computeFillProbability } from "../src/agents/fill-probability.js";
import { alignToLot, alignToTick } from "../src/bitget/order-lifecycle.js";

const TOKEN = 235.5;
const EQUITY = 235.1;

/** Two-sided book around TOKEN, one tick wide on each side of mid. */
function book(): MarketDepth {
  return {
    bids: [{ price: TOKEN - 0.01, quantity: 500 }],
    asks: [{ price: TOKEN + 0.01, quantity: 500 }],
  };
}

function analyse(over: Record<string, unknown> = {}) {
  return evaluateBasisSpread({
    tokenPrice: TOKEN,
    tradFiClosePrice: EQUITY,
    orderSizeUsd: 50,
    depth: book(),
    fundingRate8h: 0,
    hoursToClose: 1,
    takerFee: 0.0006,
    ...over,
  });
}

// ---------------------------------------------------------------------------
// Slice 1 — execution style
// ---------------------------------------------------------------------------

describe("quant — execution style drives the hurdle", () => {
  it("defaults to aggressive, preserving the previous hurdle exactly", () => {
    const r = analyse();
    assert.equal(r.executionStyle, "aggressive");
    // 2 * 0.0006 + vwap impact + 0 funding = the original formula.
    assert.equal(r.executionFeeRate, 0.0012);
    assert.equal(r.hurdleRate, Number((0.0012 + r.vwapSlippage).toFixed(8)));
  });

  it("does NOT charge taker fees on a passive order", () => {
    const r = analyse({ executionStyle: "passive" });
    assert.equal(r.executionStyle, "passive");
    assert.equal(r.executionFeeRate, 2 * DEFAULT_MAKER_FEE);
    assert.ok(r.executionFeeRate < 0.0012, "passive fee must beat the taker fee");
  });

  it("charges adverse selection instead of book impact when passive", () => {
    const passive = analyse({ executionStyle: "passive" });
    const aggressive = analyse();
    assert.ok(passive.executionFrictionRate < aggressive.executionFrictionRate);
    // halfSpreadPct is reported at 4dp, so compare with tolerance rather than
    // reconstructing a 5-decimal friction from a 4-decimal published field.
    assert.ok(
      Math.abs(passive.executionFrictionRate - DEFAULT_ADVERSE_SELECTION * passive.halfSpreadPct / 100) < 1e-6,
    );
  });

  it("drops the hurdle below the live basis that produced two NEUTRAL reads", () => {
    // The live reads: basis 0.0510%, hurdle 0.1221% -> NEUTRAL.
    // Passive on the same book must clear that hurdle, or the model is useless.
    const passive = analyse({ executionStyle: "passive" });
    assert.ok(
      passive.hurdleRatePct < 0.051,
      `passive hurdle ${passive.hurdleRatePct}% must clear the observed 0.051% basis`,
    );
  });

  it("reproduces the live NEUTRAL verdict under aggressive", () => {
    const aggressive = analyse();
    assert.ok(aggressive.hurdleRatePct > 0.05);
  });

  it("supports a maker rebate, which can drive the hurdle NEGATIVE", () => {
    // A 1bp rebate against 2bp of adverse selection leaves a NEGATIVE hurdle:
    // the venue pays us to rest. Clamping at zero would manufacture a cost the
    // venue does not charge, so the schema was widened to allow it.
    const r = analyse({ executionStyle: "passive", makerFee: -0.0001 });
    assert.equal(r.executionFeeRate, -0.0002);
    assert.ok(r.hurdleRate < 0, "a rebate big enough to exceed adverse selection yields a negative hurdle");
    // Friction is still charged; the rebate does not erase it.
    assert.ok(r.executionFrictionRate > 0);
  });

  it("keeps the hurdle positive when adverse selection exceeds the rebate", () => {
    // half-spread friction here is ~4.2bp, so a 1bp-per-leg (2bp RT) rebate is
    // smaller than it and the hurdle stays positive.
    const r = analyse({ executionStyle: "passive", makerFee: -0.00001, adverseSelection: 1 });
    assert.equal(r.executionFeeRate, -0.00002);
    assert.ok(r.hurdleRate > 0, "hurdle must stay positive when friction outweighs the rebate");
  });

  it("bounds passive friction by the half-spread at adverseSelection = 1", () => {
    const r = analyse({ executionStyle: "passive", adverseSelection: 1 });
    // halfSpreadPct is published at 4dp (0.0001pp), so compare within that
    // reporting precision rather than to a value the artifact cannot carry.
    assert.ok(
      Math.abs(r.executionFrictionRate * 100 - r.halfSpreadPct) <= 5e-5,
      `friction ${r.executionFrictionRate * 100}pp vs halfSpread ${r.halfSpreadPct}pp`,
    );
  });

  it("allows zero adverse selection as an explicit optimistic bound", () => {
    const r = analyse({ executionStyle: "passive", adverseSelection: 0 });
    assert.equal(r.executionFrictionRate, 0);
  });

  // ADVERSE_SELECTION_SENSITIVITY: the single most load-bearing guess in the
  // passive branch. Pinned so any future default change is a visible diff.
  it("ADVERSE_SELECTION_SENSITIVITY: hurdle across the whole coefficient range", () => {
    const rows = [0, 0.25, 0.5, 0.75, 1].map((c) => {
      const r = analyse({ executionStyle: "passive", adverseSelection: c });
      return `${c}->${r.hurdleRatePct}%`;
    });
    assert.deepEqual(rows, [
      "0->0%", "0.25->0.0011%", "0.5->0.0021%", "0.75->0.0032%", "1->0.0042%",
    ]);
  });

  it("rejects an out-of-range adverse selection coefficient", () => {
    assert.throws(() => analyse({ executionStyle: "passive", adverseSelection: 1.5 }));
  });

  it("keeps the aggressive branch unchanged when a maker fee is supplied", () => {
    const r = analyse({ makerFee: -0.0005 });
    assert.equal(r.executionFeeRate, 0.0012, "makerFee must not leak into the aggressive branch");
  });
});

// ---------------------------------------------------------------------------
// Slice 2 — inventory-aware quoting
// ---------------------------------------------------------------------------

const baseQuote = {
  fairPrice: 235.5,
  inventoryBase: 0,
  volatilityPerSqrtSecond: 0.0001,
  riskAversion: 0.1,
  horizonSeconds: 3600,
  baseSpread: 0.0016,
  maxInventoryBase: 1,
};

describe("inventory quote — Avellaneda-Stoikov reservation price", () => {
  it("quotes symmetric around fair value when flat", () => {
    const q = computeInventoryQuote(baseQuote);
    assert.equal(q.reservationPrice, 235.5);
    assert.equal(q.inventorySide, "FLAT");
    assert.ok(q.bidPrice < q.askPrice);
    assert.equal(q.reduceOnly, false);
  });

  it("pushes the reservation price DOWN when long", () => {
    const q = computeInventoryQuote({ ...baseQuote, inventoryBase: 0.5 });
    assert.ok(q.reservationPrice < 235.5, "long inventory must lower the reservation price");
    assert.ok(q.reservationSkew < 0);
    assert.equal(q.inventorySide, "LONG");
  });

  it("pushes the reservation price UP when short", () => {
    const q = computeInventoryQuote({ ...baseQuote, inventoryBase: -0.5 });
    assert.ok(q.reservationPrice > 235.5);
    assert.ok(q.reservationSkew > 0);
  });

  it("skews proportionally to gamma * sigma^2 * (T - t) * q", () => {
    const q = computeInventoryQuote({ ...baseQuote, inventoryBase: 1, horizonSeconds: 7200 });
    // 0.1 * 1e-8 * 7200 * 1 = 7.2e-6
    assert.ok(Math.abs(q.reservationSkew + 7.2e-6 / 235.5) < 1e-9);
  });

  it("widens the bid away from a long inventory", () => {
    const flat = computeInventoryQuote(baseQuote);
    const long = computeInventoryQuote({ ...baseQuote, inventoryBase: 0.5 });
    assert.ok(long.bidPrice < flat.bidPrice, "long inventory must lower the bid");
  });

  it("goes reduce-only at the long cap", () => {
    const q = computeInventoryQuote({ ...baseQuote, inventoryBase: 1 });
    assert.equal(q.reduceOnly, true);
    assert.equal(q.inventorySide, "LONG");
    assert.match(q.reasons.join(" "), /reduce-only/);
  });

  it("goes reduce-only at the short cap", () => {
    const q = computeInventoryQuote({ ...baseQuote, inventoryBase: -1 });
    assert.equal(q.reduceOnly, true);
    assert.equal(q.inventorySide, "SHORT");
  });

  it("does nothing at zero risk aversion — quotes are then inventory-blind", () => {
    const q = computeInventoryQuote({ ...baseQuote, riskAversion: 0, inventoryBase: 0.5 });
    assert.equal(q.reservationPrice, 235.5);
  });

  it("suppresses a bid that collapses below zero under extreme skew", () => {
    const q = computeInventoryQuote({
      ...baseQuote, inventoryBase: 500, riskAversion: 1000, horizonSeconds: 100000,
    });
    assert.equal(q.bidPrice, 0);
    assert.equal(q.askPrice, 0);
    assert.match(q.reasons.join(" "), /suppressed/);
  });

  it("rejects a negative spread", () => {
    assert.throws(() => computeInventoryQuote({ ...baseQuote, baseSpread: -0.001 }));
  });
});

// ---------------------------------------------------------------------------
// Slice 3 — fill probability
// ---------------------------------------------------------------------------

const baseFill = {
  orderSizeBase: 0.2,
  queueAheadBase: 0,
  meanInterarrivalSeconds: 30,
  timeInMarketSeconds: 300,
  arrivalRateBasePerSecond: 0.5,
  adverseFillProbability: 0.5,
  capturedSpread: 0.0004,
  foregoneEdgeOnNoFill: 0.001,
};

describe("fill probability — poisson-queue-v1", () => {
  it("includes own size in the effective queue", () => {
    const f = computeFillProbability(baseFill);
    assert.equal(f.effectiveQueueBase, 0.2);
  });

  it("counts the queue ahead of us", () => {
    const f = computeFillProbability({ ...baseFill, queueAheadBase: 1 });
    assert.equal(f.effectiveQueueBase, 1.2);
    assert.ok(f.fillProbability < 1);
  });

  it("lowers fill probability as the queue ahead grows", () => {
    const near = computeFillProbability({ ...baseFill, queueAheadBase: 0 });
    const far = computeFillProbability({ ...baseFill, queueAheadBase: 100 });
    assert.ok(far.fillProbability < near.fillProbability);
  });

  it("lowers fill probability as time in market falls", () => {
    const long = computeFillProbability({ ...baseFill, timeInMarketSeconds: 600 });
    const short = computeFillProbability({ ...baseFill, timeInMarketSeconds: 30 });
    assert.ok(short.fillProbability < long.fillProbability);
  });

  it("charges opportunity cost on the no-fill branch", () => {
    const f = computeFillProbability({ ...baseFill, timeInMarketSeconds: 1 });
    assert.ok(f.opportunityCostHurdle > 0, "an unfilled order must cost something");
  });

  it("reports zero fill probability with no arrivals", () => {
    const f = computeFillProbability({ ...baseFill, arrivalRateBasePerSecond: 0 });
    assert.equal(f.fillProbability, 0);
    assert.equal(f.expectedCapture, 0);
    assert.equal(f.opportunityCostHurdle, 0.001);
    assert.equal(f.riskAdjustedEdge, -0.001);
  });

  it("discounts capture by the adverse fill probability", () => {
    const f = computeFillProbability(baseFill);
    assert.equal(f.adverseSelectionCost, 0.0004 * 0.5);
  });

  it("is symmetric: a zero-foregone edge with a low fill probability can still look good", () => {
    // Demonstrates the module is not a one-directional pessimiser.
    const f = computeFillProbability({ ...baseFill, foregoneEdgeOnNoFill: 0 });
    assert.ok(f.riskAdjustedEdge > 0);
  });

  it("never reports a negative fill probability on absurd queue depth", () => {
    const f = computeFillProbability({ ...baseFill, queueAheadBase: 1e12 });
    assert.ok(f.fillProbability >= 0 && f.fillProbability <= 1);
  });

  it("rejects a non-positive interarrival time", () => {
    assert.throws(() => computeFillProbability({ ...baseFill, meanInterarrivalSeconds: 0 }));
  });

  it("labels its model so the number is never mistaken for a simulated fill", () => {
    assert.equal(computeFillProbability(baseFill).model, "poisson-queue-v1");
  });
});

// ---------------------------------------------------------------------------
// Venue grid alignment (mechanic adopted from the reviewed market maker)
// ---------------------------------------------------------------------------

describe("venue tick and lot alignment", () => {
  it("floors a bid onto the tick grid", () => {
    assert.equal(alignToTick(230.657, 2, "bid"), 230.65);
  });

  it("ceils an ask onto the tick grid", () => {
    assert.equal(alignToTick(230.657, 2, "ask"), 230.66);
  });

  it("never lets a bid round up into a taker order", () => {
    for (const p of [230.001, 230.009, 230.999, 230.0]) {
      assert.ok(alignToTick(p, 2, "bid") <= p, `bid ${p} rounded up`);
    }
  });

  it("never lets an ask round down", () => {
    for (const p of [230.001, 230.009, 230.999]) {
      assert.ok(alignToTick(p, 2, "ask") >= p, `ask ${p} rounded down`);
    }
  });

  it("floors size so alignment cannot breach the notional cap", () => {
    assert.equal(alignToLot(0.21678, 4), 0.2167);
    assert.ok(alignToLot(0.21678, 4) <= 0.21678);
  });

  it("passes an already-aligned value through unchanged", () => {
    assert.equal(alignToTick(230.65, 2, "bid"), 230.65);
    assert.equal(alignToLot(0.2167, 4), 0.2167);
  });

  it("rejects a non-finite price and size", () => {
    assert.throws(() => alignToTick(Number.NaN, 2, "bid"));
    assert.throws(() => alignToLot(Number.POSITIVE_INFINITY, 4));
  });
});
