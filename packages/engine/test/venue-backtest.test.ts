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

  it("3. strictly binds trades to In-Sample and Out-of-Sample boundaries by realized exit date", () => {
    const runner = new VenueBacktestRunner();
    runner.runBacktest();
    const trades = runner.getCompletedTrades();

    assert.ok(trades.length > 0, "Must have generated trades");

    for (const t of trades) {
      if (t.isOutSample) {
        assert.ok(
          t.exitDate > IN_SAMPLE_CUTOFF_DATE,
          `OOS trade exited at ${t.exitDate} must be strictly after cutoff ${IN_SAMPLE_CUTOFF_DATE}`,
        );
      } else {
        assert.ok(
          t.exitDate <= IN_SAMPLE_CUTOFF_DATE,
          `IS trade exited at ${t.exitDate} must be on or before cutoff ${IN_SAMPLE_CUTOFF_DATE}`,
        );
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

    // The invariant is ONE-DIRECTIONAL: every completed trade must carry a
    // receipt. The converse is NOT true and never was. I-03 requires a receipt
    // per DISPATCH, so a position approved on the final bar has a receipt but
    // no completed trade because it never exited.
    //
    // The previous assertion (receipts.length === trades.length) passed only
    // because the 3-pair campaign happened to end flat. That was an accidental
    // property of the pair set, not a designed invariant, and it broke the
    // moment a second pair landed with an open book at the cutoff.
    assert.ok(
      receipts.length >= trades.length,
      `receipts (${receipts.length}) must cover completed trades (${trades.length})`,
    );
    const openAtEnd = receipts.length - trades.length;
    console.log(`      [open positions at campaign end: ${openAtEnd}]`);

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

  it("7. emits complete daily return series allowing exact Sharpe reproducibility", () => {
    const runner = new VenueBacktestRunner();
    const summary = runner.runBacktest();

    for (const seg of [summary.fullCampaign, summary.inSample, summary.outOfSample]) {
      assert.equal(
        seg.dailySeries.length,
        seg.tradingDays,
        `Daily series length (${seg.dailySeries.length}) must match tradingDays (${seg.tradingDays})`,
      );

      // Verify that every day is strictly chronological
      for (let i = 1; i < seg.dailySeries.length; i++) {
        assert.ok(
          seg.dailySeries[i]!.date > seg.dailySeries[i - 1]!.date,
          "Daily series must be strictly chronologically sorted",
        );
      }

      // Recompute Sharpe from the daily series for published segments
      if (seg.sharpeStatus === "PUBLISHED" && seg.sharpeRatio !== null) {
        const rets = seg.dailySeries.map((s) => s.dailyReturnPct / 100);
        const n = rets.length;
        const mean = rets.reduce((a, b) => a + b, 0) / n;
        const variance = rets.reduce((acc, r) => acc + Math.pow(r - mean, 2), 0) / (n - 1);
        const std = Math.sqrt(variance);
        const recomputedSharpe = Math.round((mean / std) * Math.sqrt(252) * 100) / 100;
        assert.equal(
          seg.sharpeRatio,
          recomputedSharpe,
          `Published Sharpe (${seg.sharpeRatio}) must match recomputed daily Sharpe (${recomputedSharpe})`,
        );
      }
    }
  });

  // -----------------------------------------------------------------------
  // These assert STRUCTURAL INVARIANTS, not literal outputs.
  //
  // The previous version froze $399.79 / $167.09 / $566.88 / 3 straddlers /
  // 2.03 / 0.91x. Adding two pairs legitimately changed every one of those
  // numbers, and all three tests failed — reading as "the reconciliation broke"
  // when in fact the data changed and the assertions did not. Worse, the
  // narrative strings in the ENGINE were frozen too, so the artifact published
  // an OOS Sharpe of 3.89 beside a note insisting it was withheld at 27 trades.
  //
  // A test that pins a number tests that number. A test that pins a RELATIONSHIP
  // tests the thing that must never silently break.
  // -----------------------------------------------------------------------

  it("8. reconciles In-Sample and Out-of-Sample PnL and trade counts to the exact cent", () => {
    const summary = new VenueBacktestRunner().runBacktest();
    const rec = summary.reconciliation;

    assert.equal(rec.attributionPolicy, "REALIZED_EXIT_DATE");
    assert.equal(rec.tradesCountReconciled, true);
    assert.equal(rec.pnlReconciledToTheCent, true);

    // Relationships, not literals.
    assert.equal(rec.isTradesCount + rec.oosTradesCount, rec.fullTradesCount);
    assert.equal(
      Math.round((rec.isTotalPnlUsd + rec.oosTotalPnlUsd) * 100) / 100,
      rec.fullTotalPnlUsd,
    );
    assert.equal(rec.isTradesCount + rec.oosTradesCount, summary.fullCampaign.tradesCount);
    assert.equal(rec.straddlingTradesCount, rec.straddlingTradesDetail.length);
    for (const st of rec.straddlingTradesDetail) {
      assert.ok(st.entryDate <= IN_SAMPLE_CUTOFF_DATE, "straddler must be entered in-sample");
      assert.ok(st.exitDate > IN_SAMPLE_CUTOFF_DATE, "straddler must exit out-of-sample");
    }
    // Straddler PnL must equal the sum of the individual straddlers.
    const detailSum = Math.round(rec.straddlingTradesDetail.reduce((a, t) => a + t.pnlUsd, 0) * 100) / 100;
    assert.equal(rec.straddlingTradesPnlUsd, detailSum);
  });

  it("9. discloses straddling dependence, and every disclosed NUMBER matches the data", () => {
    const summary = new VenueBacktestRunner().runBacktest();
    const rec = summary.reconciliation;
    const disc = rec.straddlingTradesDisclosure;

    // The disclosure is DERIVED. The real assertion is that the prose agrees
    // with the figures sitting next to it.
    assert.equal(disc.oosPnlWithStraddlersUsd, rec.oosTotalPnlUsd);
    assert.equal(disc.oosPnlWithoutStraddlersUsd, rec.oosTotalPnlUsd - rec.straddlingTradesPnlUsd);
    assert.ok(disc.dependenceNote.includes(`${rec.straddlingTradesCount} trade(s)`));
    assert.ok(disc.dependenceNote.includes(rec.straddlingTradesPnlUsd.toFixed(2)));
    assert.ok(disc.dependenceNote.includes(rec.oosTotalPnlUsd.toFixed(2)));
  });

  it("10. never claims an OOS Sharpe is withheld when it is published, or vice versa", () => {
    const summary = new VenueBacktestRunner().runBacktest();
    const prov = summary.provisionalDecayMetrics;
    const oos = summary.outOfSample;

    // THE contradiction that shipped: OOS Sharpe published at 3.89 next to a
    // note reading "withheld ... 27 trades". The narrative must track the gate.
    if (oos.sharpeRatio === null) {
      assert.ok(
        prov.sharpeStatusDisclosure.includes("withheld"),
        `narrative must say withheld when gate withheld it (${oos.tradesCount} trades)`,
      );
      assert.ok(prov.sharpeStatusDisclosure.includes(String(oos.tradesCount)));
    } else {
      assert.ok(
        prov.sharpeStatusDisclosure.includes("PUBLISHED"),
        "narrative must say PUBLISHED when the OOS Sharpe is published",
      );
      assert.ok(prov.sharpeStatusDisclosure.includes(String(oos.tradesCount)));
      assert.equal(prov.rawOosDailySharpe, oos.sharpeRatio);
    }
  });

  it("11. discloses that pairs were added to clear the observation gate", () => {
    const summary = new VenueBacktestRunner().runBacktest();
    const d = summary.pairsAddedForObservationGate;

    assert.deepEqual(d.addedPairs, ["MSFTUSDT", "GOOGLUSDT"]);
    assert.equal(d.allPairs.length, d.addedPairs.length + 3);
    assert.match(d.reason, /after observing the gate fail/i);
    assert.match(d.correlationCaveat, /correlated/i);
    // If OOS Sharpe ever exceeds IS again, the artifact must say it is atypical.
    if (
      summary.outOfSample.sharpeRatio !== null &&
      summary.inSample.sharpeRatio !== null &&
      summary.outOfSample.sharpeRatio > summary.inSample.sharpeRatio
    ) {
      assert.match(d.effectiveObservationNote, /atypical/);
      assert.match(d.effectiveObservationNote, /variance compression/i);
    }
  });

  it("12. computes and discloses cross-pair return correlation and effective asset count (N_eff)", () => {
    const summary = new VenueBacktestRunner().runBacktest();
    const corr = summary.crossPairCorrelation;

    assert.equal(corr.totalAssets, 5);
    // Diagonal must be 1.0
    for (const sym of Object.keys(corr.matrix)) {
      assert.equal(corr.matrix[sym]![sym], 1.0);
    }
    // Correlation symmetry
    for (const s1 of Object.keys(corr.matrix)) {
      for (const s2 of Object.keys(corr.matrix)) {
        assert.equal(corr.matrix[s1]![s2], corr.matrix[s2]![s1]);
      }
    }
    // Average correlation must be finite and within [-1, 1]
    assert.ok(corr.averagePairwiseCorrelation >= -1 && corr.averagePairwiseCorrelation <= 1);
    assert.ok(corr.averagePairwiseCorrelation < 0.5, "Average correlation across idiosyncratic perps is below 0.5");
    // Effective asset count must be > 1 and <= totalAssets
    assert.ok(corr.effectiveAssetCount > 1.0 && corr.effectiveAssetCount <= 5.0);
    assert.ok(corr.oosEffectiveTradesCount > 0 && corr.oosEffectiveTradesCount <= summary.outOfSample.tradesCount);
    assert.match(corr.analysisNote, /average pairwise return correlation/i);
    assert.match(corr.analysisNote, /Neff/i);
  });
});
