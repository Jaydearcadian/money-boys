/**
 * Track 1 — Authentic Venue Candle Walk-Forward Backtest.
 *
 * Runs deterministic multi-pair basis dislocation walk-forward backtest
 * using ingested historical Bitget rToken futures candles and Alpha Vantage
 * TradFi equity candles (DOCUMENTED_API).
 *
 * Split Parameters:
 *  - 59 Calendar Days In-Sample (2026-07-05 to 2026-09-02)
 *  - 30 Calendar Days Out-of-Sample (2026-09-02 to 2026-10-02)
 *  - Minimum 30-trade Sharpe observation gate
 *
 * Writes:
 *  - foundry/evidence/backtest/venue_backtest.jsonl
 *  - foundry/evidence/backtest/venue_backtest_summary.json
 *  - foundry/evidence/backtest/venue_backtest_daily_series.json
 *
 * Run: pnpm exec tsx scripts/run-venue-backtest.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VenueBacktestRunner,
  IN_SAMPLE_CUTOFF_DATE,
  PAIRS,
} from "../packages/engine/src/campaign/venue-backtest.js";
import { verifyReceipt } from "../packages/engine/src/council/receipts.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "foundry/evidence/backtest");

async function main(): Promise<void> {
  console.log("================================================================================");
  console.log("       TRACK 1: AUTHENTIC VENUE CANDLE WALK-FORWARD BACKTEST (59d IS / 30d OOS)");
  console.log("================================================================================");
  console.log(`Pairs evaluated: ${PAIRS.map((p) => `${p.tokenSym}/${p.eqSym}`).join(", ")}`);
  console.log(`In-Sample Cutoff Date: ${IN_SAMPLE_CUTOFF_DATE}`);

  mkdirSync(OUT_DIR, { recursive: true });

  const runner = new VenueBacktestRunner();
  const summary = runner.runBacktest();
  const trades = runner.getCompletedTrades();
  const receipts = runner.getReceipts();

  console.log(`\nSimulation complete.`);
  console.log(`Total Trades Executed: ${trades.length}`);
  console.log(`Total Reasoning Receipts: ${receipts.length}`);

  // Verify all receipts
  let allReceiptsValid = true;
  for (const r of receipts) {
    if (!verifyReceipt(r)) {
      allReceiptsValid = false;
      console.error(`FAILED receipt verification: ${r.receiptHash}`);
    }
  }
  console.log(`Receipt Verification: ${allReceiptsValid ? "ALL VALID (100% SHA-256 sealed)" : "VERIFICATION FAILED"}`);

  // Write trades JSONL
  const jsonlPath = join(OUT_DIR, "venue_backtest.jsonl");
  const jsonlContent = trades.map((t) => JSON.stringify(t)).join("\n") + "\n";
  writeFileSync(jsonlPath, jsonlContent, "utf8");
  console.log(`Wrote trades log to: ${jsonlPath}`);

  // Write summary JSON
  const summaryPath = join(OUT_DIR, "venue_backtest_summary.json");
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
  console.log(`Wrote summary to: ${summaryPath}`);

  // Write daily return series JSON for exact reproducibility
  const dailySeriesPath = join(OUT_DIR, "venue_backtest_daily_series.json");
  const dailySeriesPayload = {
    asOf: new Date().toISOString(),
    methodology: "True trading-day returns aggregation with sqrt(252) annualization",
    fullCampaign: summary.fullCampaign.dailySeries,
    inSample: summary.inSample.dailySeries,
    outOfSample: summary.outOfSample.dailySeries,
  };
  writeFileSync(dailySeriesPath, JSON.stringify(dailySeriesPayload, null, 2) + "\n", "utf8");
  console.log(`Wrote daily returns series to: ${dailySeriesPath}`);

  // Print headline leading with Out-of-Sample reality
  console.log("\n--------------------------------------------------------------------------------");
  console.log(`HEADLINE: ${summary.headline}`);
  console.log("--------------------------------------------------------------------------------");

  // Print comparison table
  const tableData = [
    {
      Metric: "Calendar Days",
      "Out-of-Sample (OOS)": summary.outOfSample.calendarDays,
      "In-Sample (IS)": summary.inSample.calendarDays,
      "Full Campaign": summary.fullCampaign.calendarDays,
    },
    {
      Metric: "Trading Days",
      "Out-of-Sample (OOS)": summary.outOfSample.tradingDays,
      "In-Sample (IS)": summary.inSample.tradingDays,
      "Full Campaign": summary.fullCampaign.tradingDays,
    },
    {
      Metric: "Trades Count",
      "Out-of-Sample (OOS)": summary.outOfSample.tradesCount,
      "In-Sample (IS)": summary.inSample.tradesCount,
      "Full Campaign": summary.fullCampaign.tradesCount,
    },
    {
      Metric: "Win Rate",
      "Out-of-Sample (OOS)": `${summary.outOfSample.winRatePct}%`,
      "In-Sample (IS)": `${summary.inSample.winRatePct}%`,
      "Full Campaign": `${summary.fullCampaign.winRatePct}%`,
    },
    {
      Metric: "Total PnL (USD)",
      "Out-of-Sample (OOS)": `$${summary.outOfSample.totalPnlUsd.toFixed(2)}`,
      "In-Sample (IS)": `$${summary.inSample.totalPnlUsd.toFixed(2)}`,
      "Full Campaign": `$${summary.fullCampaign.totalPnlUsd.toFixed(2)}`,
    },
    {
      Metric: "Net Return",
      "Out-of-Sample (OOS)": `${summary.outOfSample.netReturnPct}%`,
      "In-Sample (IS)": `${summary.inSample.netReturnPct}%`,
      "Full Campaign": `${summary.fullCampaign.netReturnPct}%`,
    },
    {
      Metric: "Max Drawdown",
      "Out-of-Sample (OOS)": `${summary.outOfSample.maxDrawdownPct}%`,
      "In-Sample (IS)": `${summary.inSample.maxDrawdownPct}%`,
      "Full Campaign": `${summary.fullCampaign.maxDrawdownPct}%`,
    },
    {
      Metric: "Turnover Ratio",
      "Out-of-Sample (OOS)": summary.outOfSample.turnoverRatio,
      "In-Sample (IS)": summary.inSample.turnoverRatio,
      "Full Campaign": summary.fullCampaign.turnoverRatio,
    },
    {
      Metric: "Sharpe Status",
      "Out-of-Sample (OOS)": summary.outOfSample.sharpeStatus,
      "In-Sample (IS)": summary.inSample.sharpeStatus,
      "Full Campaign": summary.fullCampaign.sharpeStatus,
    },
    {
      Metric: "Sharpe Ratio (Daily Ann.)",
      "Out-of-Sample (OOS)": summary.outOfSample.sharpeRatio !== null ? summary.outOfSample.sharpeRatio : "WITHHELD",
      "In-Sample (IS)": summary.inSample.sharpeRatio !== null ? summary.inSample.sharpeRatio : "WITHHELD",
      "Full Campaign": summary.fullCampaign.sharpeRatio !== null ? summary.fullCampaign.sharpeRatio : "WITHHELD",
    },
    {
      Metric: "Sortino Ratio (Daily Ann.)",
      "Out-of-Sample (OOS)": summary.outOfSample.sortinoRatio !== null ? summary.outOfSample.sortinoRatio : "WITHHELD",
      "In-Sample (IS)": summary.inSample.sortinoRatio !== null ? summary.inSample.sortinoRatio : "WITHHELD",
      "Full Campaign": summary.fullCampaign.sortinoRatio !== null ? summary.fullCampaign.sortinoRatio : "WITHHELD",
    },
    {
      Metric: "Daily Series Count",
      "Out-of-Sample (OOS)": summary.outOfSample.dailySeries.length,
      "In-Sample (IS)": summary.inSample.dailySeries.length,
      "Full Campaign": summary.fullCampaign.dailySeries.length,
    },
  ];
  console.table(tableData);

  if (summary.sharpeDecayPct !== null) {
    console.log(`Sharpe Decay (IS -> OOS): ${summary.sharpeDecayPct}%`);
  } else {
    console.log(`Sharpe Decay: N/A (Withheld due to trade observation threshold gate: OOS has ${summary.outOfSample.tradesCount} trades < 30 required)`);
  }

  console.log("\n--------------------------------------------------------------------------------");
  console.log(`RECONCILIATION AUDIT (Attribution Policy: ${summary.reconciliation.attributionPolicy}):`);
  console.log(`  PnL Reconciled to the Cent: ${summary.reconciliation.pnlReconciledToTheCent ? `YES ($${summary.reconciliation.isTotalPnlUsd.toFixed(2)} + $${summary.reconciliation.oosTotalPnlUsd.toFixed(2)} = $${summary.reconciliation.fullTotalPnlUsd.toFixed(2)})` : "NO"}`);
  console.log(`  Trades Count Reconciled: ${summary.reconciliation.tradesCountReconciled ? `YES (${summary.reconciliation.isTradesCount} + ${summary.reconciliation.oosTradesCount} = ${summary.reconciliation.fullTradesCount})` : "NO"}`);
  console.log(`  Straddling Trades Count: ${summary.reconciliation.straddlingTradesCount} (entered IS, exited OOS; total PnL: +$${summary.reconciliation.straddlingTradesPnlUsd.toFixed(2)})`);
  for (const st of summary.reconciliation.straddlingTradesDetail) {
    console.log(`    - ${st.tradeId} (${st.symbol}): entry ${st.entryDate} -> exit ${st.exitDate}, PnL $${st.pnlUsd.toFixed(2)}`);
  }
  console.log("--------------------------------------------------------------------------------");
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
