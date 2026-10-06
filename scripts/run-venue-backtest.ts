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

  // Print comparison table
  console.log("\n--------------------------------------------------------------------------------");
  console.log(" SEGMENT METRICS COMPARISON");
  console.log("--------------------------------------------------------------------------------");
  const tableData = [
    {
      Metric: "Calendar Days",
      "In-Sample (IS)": summary.inSample.calendarDays,
      "Out-of-Sample (OOS)": summary.outOfSample.calendarDays,
      "Full Campaign": summary.fullCampaign.calendarDays,
    },
    {
      Metric: "Trading Days",
      "In-Sample (IS)": summary.inSample.tradingDays,
      "Out-of-Sample (OOS)": summary.outOfSample.tradingDays,
      "Full Campaign": summary.fullCampaign.tradingDays,
    },
    {
      Metric: "Trades Count",
      "In-Sample (IS)": summary.inSample.tradesCount,
      "Out-of-Sample (OOS)": summary.outOfSample.tradesCount,
      "Full Campaign": summary.fullCampaign.tradesCount,
    },
    {
      Metric: "Win Rate",
      "In-Sample (IS)": `${summary.inSample.winRatePct}%`,
      "Out-of-Sample (OOS)": `${summary.outOfSample.winRatePct}%`,
      "Full Campaign": `${summary.fullCampaign.winRatePct}%`,
    },
    {
      Metric: "Total PnL (USD)",
      "In-Sample (IS)": `$${summary.inSample.totalPnlUsd.toFixed(2)}`,
      "Out-of-Sample (OOS)": `$${summary.outOfSample.totalPnlUsd.toFixed(2)}`,
      "Full Campaign": `$${summary.fullCampaign.totalPnlUsd.toFixed(2)}`,
    },
    {
      Metric: "Net Return",
      "In-Sample (IS)": `${summary.inSample.netReturnPct}%`,
      "Out-of-Sample (OOS)": `${summary.outOfSample.netReturnPct}%`,
      "Full Campaign": `${summary.fullCampaign.netReturnPct}%`,
    },
    {
      Metric: "Max Drawdown",
      "In-Sample (IS)": `${summary.inSample.maxDrawdownPct}%`,
      "Out-of-Sample (OOS)": `${summary.outOfSample.maxDrawdownPct}%`,
      "Full Campaign": `${summary.fullCampaign.maxDrawdownPct}%`,
    },
    {
      Metric: "Turnover Ratio",
      "In-Sample (IS)": summary.inSample.turnoverRatio,
      "Out-of-Sample (OOS)": summary.outOfSample.turnoverRatio,
      "Full Campaign": summary.fullCampaign.turnoverRatio,
    },
    {
      Metric: "Sharpe Status",
      "In-Sample (IS)": summary.inSample.sharpeStatus,
      "Out-of-Sample (OOS)": summary.outOfSample.sharpeStatus,
      "Full Campaign": summary.fullCampaign.sharpeStatus,
    },
    {
      Metric: "Sharpe Ratio",
      "In-Sample (IS)": summary.inSample.sharpeRatio !== null ? summary.inSample.sharpeRatio : "WITHHELD",
      "Out-of-Sample (OOS)": summary.outOfSample.sharpeRatio !== null ? summary.outOfSample.sharpeRatio : "WITHHELD",
      "Full Campaign": summary.fullCampaign.sharpeRatio !== null ? summary.fullCampaign.sharpeRatio : "WITHHELD",
    },
    {
      Metric: "Sortino Ratio",
      "In-Sample (IS)": summary.inSample.sortinoRatio !== null ? summary.inSample.sortinoRatio : "WITHHELD",
      "Out-of-Sample (OOS)": summary.outOfSample.sortinoRatio !== null ? summary.outOfSample.sortinoRatio : "WITHHELD",
      "Full Campaign": summary.fullCampaign.sortinoRatio !== null ? summary.fullCampaign.sortinoRatio : "WITHHELD",
    },
  ];
  console.table(tableData);

  if (summary.sharpeDecayPct !== null) {
    console.log(`Sharpe Decay (IS -> OOS): ${summary.sharpeDecayPct}%`);
  } else {
    console.log("Sharpe Decay: N/A (Withheld due to trade observation threshold gate)");
  }

  console.log("================================================================================");
}

main().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
