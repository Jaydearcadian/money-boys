import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  VenueBacktestRunner,
  loadMatchedPairBars,
  IN_SAMPLE_CUTOFF_DATE,
  PAIRS,
  MIN_TRADES_SHARPE_GATE,
} from "../src/campaign/venue-backtest.js";
import { verifyReceipt } from "../src/council/receipts.js";

describe("Track 1 — Venue Candle Walk-Forward Backtest (GAP-021)", () => {
  it("1. loads authentic matched pair bars without weekend forward fill", () => {
    for (const { tokenSym, eqSym } of PAIRS) {
      const bars = loadMatchedPairBars(tokenSym, eqSym);
      assert.ok(bars.length >= 60, `Expected at least 60 matched bars for ${tokenSym}, got ${bars.length}`);
      
      // Chronological order check
      for (let i = 1; i < bars.length; i++) {
        assert.ok(bars[i]!.date > bars[i - 1]!.date, "Bars must be strictly chronologically ordered");
      }

      // Check prices and basis computation
      for (const b of bars) {
        assert.ok(b.tokenClose > 0, "Token close must be positive");
        assert.ok(b.equityClose > 0, "TradFi equity close must be positive");
        const expectedBasis = ((b.tokenClose - b.equityClose) / b.equityClose) * 100;
        assert.ok(
          Math.abs(b.basisPct - expectedBasis) < 1e-4,
          `Basis percentage mismatch on ${b.date}: got ${b.basisPct}, expected ${expectedBasis}`,
        );
      }
    }
  });

  it("2. enforces 59d IS / 30d OOS walk-forward split parameter boundaries", () => {
    const runner = new VenueBacktestRunner();
    const summary = runner.runBacktest();

    assert.equal(summary.provenance, "HISTORICAL_VENUE_CANDLES");
    assert.equal(summary.syntheticFixture, false);
    assert.equal(summary.validAsPerformanceEvidence, true);
    assert.equal(summary.splitParameters.totalCalendarDays, 89);
    assert.equal(summary.splitParameters.inSampleDays, 59);
    assert.equal(summary.splitParameters.outOfSampleDays, 30);
    assert.equal(summary.splitParameters.inSampleCutoffDate, IN_SAMPLE_CUTOFF_DATE);

    // Validate segments
    assert.equal(summary.inSample.calendarDays, 59);
    assert.equal(summary.outOfSample.calendarDays, 30);
    assert.equal(summary.fullCampaign.calendarDays, 89);
  });

  it("3. strictly binds trades to In-Sample and Out-of-Sample boundaries", () => {
    const runner = new VenueBacktestRunner();
    runner.runBacktest();
    const trades = runner.getCompletedTrades();

    assert.ok(trades.length > 0, "Must have generated trades");

    for (const t of trades) {
      if (t.isOutSample) {
        assert.ok(
          t.entryDate > IN_SAMPLE_CUTOFF_DATE,
          `OOS trade entered at ${t.entryDate} must be strictly after cutoff ${IN_SAMPLE_CUTOFF_DATE}`,
        );
      } else {
        assert.ok(
          t.entryDate <= IN_SAMPLE_CUTOFF_DATE,
          `IS trade entered at ${t.entryDate} must be on or before cutoff ${IN_SAMPLE_CUTOFF_DATE}`,
        );
      }
    }
  });

  it("4. seals and verifies 100% of reasoning receipts for executed trades", () => {
    const runner = new VenueBacktestRunner();
    runner.runBacktest();
    const receipts = runner.getReceipts();
    const trades = runner.getCompletedTrades();

    assert.equal(receipts.length, trades.length, "Each trade must have an associated reasoning receipt");

    const receiptHashes = new Set(receipts.map((r) => r.receiptHash));
    for (const t of trades) {
      assert.ok(receiptHashes.has(t.receiptHash), `Trade ${t.tradeId} has unknown receipt hash ${t.receiptHash}`);
    }

    for (const r of receipts) {
      assert.equal(verifyReceipt(r), true, `ReasoningReceipt ${r.receiptHash} failed verification`);
    }
  });

  it("5. strictly adheres to minimum-observation Sharpe gate (>= 30 trades)", () => {
    const runner = new VenueBacktestRunner();
    const summary = runner.runBacktest();

    // Check In-Sample
    if (summary.inSample.tradesCount >= MIN_TRADES_SHARPE_GATE) {
      assert.equal(summary.inSample.sharpeStatus, "PUBLISHED");
      assert.notEqual(summary.inSample.sharpeRatio, null);
    } else {
      assert.equal(summary.inSample.sharpeStatus, "WITHHELD_INSUFFICIENT_OBSERVATIONS");
      assert.equal(summary.inSample.sharpeRatio, null);
    }

    // Check Out-of-Sample
    if (summary.outOfSample.tradesCount >= MIN_TRADES_SHARPE_GATE) {
      assert.equal(summary.outOfSample.sharpeStatus, "PUBLISHED");
      assert.notEqual(summary.outOfSample.sharpeRatio, null);
    } else {
      assert.equal(summary.outOfSample.sharpeStatus, "WITHHELD_INSUFFICIENT_OBSERVATIONS");
      assert.equal(summary.outOfSample.sharpeRatio, null);
    }
  });

  it("6. guarantees deterministic Risk Boy bounds across all trades", () => {
    const runner = new VenueBacktestRunner();
    runner.runBacktest();
    const trades = runner.getCompletedTrades();

    for (const t of trades) {
      // Risk Boy R1 invariant: single trade notional <= $5,000 USD
      assert.ok(
        t.notionalUsd <= 5000,
        `Trade ${t.tradeId} notional $${t.notionalUsd} breached $5,000 Risk Boy ceiling`,
      );
    }
  });
});
