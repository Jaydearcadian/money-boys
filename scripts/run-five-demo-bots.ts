/**
 * FIVE DEMO BOTS CONTINUOUS RUNNER
 *
 * Runs the primary evaluation dataset of 5 Bitget Demo bots continuously on the clock:
 *   1. rNVDAUSDT (NVDA)
 *   2. rTSLAUSDT (TSLA)
 *   3. rAAPLUSDT (AAPL)
 *   4. rMSFTUSDT (MSFT)
 *   5. rGOOGLUSDT (GOOGL)
 *
 * Each cycle:
 *   - Ingests live Bitget Demo contract pricing (USDT-FUTURES)
 *   - Ingests Robinhood / TradFi underlying benchmark
 *   - Evaluates basis dislocation against transaction cost hurdles
 *   - Evaluates Risk Boy blast radius & hard veto
 *   - Deliberates via Council and seals immutable SHA-256 ReasoningReceipt
 *   - In DEMO mode: dispatches approved orders to Bitget Demo, confirms fills, and maintains account flatness
 *   - Logs all observations, receipts, and execution telemetry to:
 *       foundry/evidence/demo-bots/live_demo_bots.jsonl
 *       foundry/evidence/demo-bots/demo_bots_summary.json
 *
 * Usage:
 *   set -a; . .env; set +a; BITGET_ENV=testnet pnpm exec tsx scripts/run-five-demo-bots.ts
 */

import { mkdirSync, appendFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AutonomousDeskDaemon, type DaemonCycleReport } from "../packages/engine/src/autonomous/daemon.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "foundry", "evidence", "demo-bots");
mkdirSync(OUT_DIR, { recursive: true });

const LOG_FILE = join(OUT_DIR, "live_demo_bots.jsonl");
const SUMMARY_FILE = join(OUT_DIR, "demo_bots_summary.json");

const SYMBOLS = [
  "rNVDAUSDT",
  "rTSLAUSDT",
  "rAAPLUSDT",
  "rMSFTUSDT",
  "rGOOGLUSDT",
];

interface BotStats {
  cycles: number;
  approved: number;
  vetoed: number;
  dispatched: number;
  lastPrice: number;
  lastBasisPct: number;
  lastNetEdgePct: number;
  lastUpdated: string;
}

const stats: Record<string, BotStats> = {};
for (const sym of SYMBOLS) {
  stats[sym] = {
    cycles: 0,
    approved: 0,
    vetoed: 0,
    dispatched: 0,
    lastPrice: 0,
    lastBasisPct: 0,
    lastNetEdgePct: 0,
    lastUpdated: new Date().toISOString(),
  };
}

let totalCyclesAll = 0;
let totalDispatchedAll = 0;
const startedAt = new Date().toISOString();

function saveSummary(): void {
  const summaryPayload = {
    startedAt,
    asOf: new Date().toISOString(),
    totalCyclesAcrossAllBots: totalCyclesAll,
    totalDispatchedAcrossAllBots: totalDispatchedAll,
    symbols: stats,
    status: "ONLINE_MONITORING",
  };
  writeFileSync(SUMMARY_FILE, JSON.stringify(summaryPayload, null, 2) + "\n", "utf8");
}

async function runCycleForSymbol(symbol: string): Promise<void> {
  const daemon = new AutonomousDeskDaemon({
    mode: "DEMO",
    symbol,
    targetNotionalUsd: 25,
    maxCycles: 1,
    intervalMs: 1000,
    autoCloseDemoPositions: true,
  });

  return new Promise<void>((resolve) => {
    daemon.onCycle((report: DaemonCycleReport) => {
      totalCyclesAll++;
      const s = stats[symbol]!;
      s.cycles++;
      s.lastPrice = report.tokenPrice;
      s.lastBasisPct = report.rawBasisPct;
      s.lastNetEdgePct = report.netEdgePct;
      s.lastUpdated = report.timestamp;

      if (report.decision === "APPROVED") s.approved++;
      else s.vetoed++;

      if (report.dispatched) {
        s.dispatched++;
        totalDispatchedAll++;
      }

      // Append immutable log row
      appendFileSync(LOG_FILE, JSON.stringify(report) + "\n", "utf8");

      console.log(
        `[${report.timestamp.slice(11, 19)}] ${symbol.padEnd(10)} | Price: $${report.tokenPrice.toFixed(2)} | Basis: ${report.rawBasisPct > 0 ? "+" : ""}${report.rawBasisPct.toFixed(4)}% | Edge: ${report.netEdgePct > 0 ? "+" : ""}${report.netEdgePct.toFixed(4)}% | Decision: ${report.decision} | Dispatched: ${report.dispatched ? "YES" : "NO"}`,
      );
    });

    daemon.start().then(() => {
      const checkDone = setInterval(() => {
        if (!daemon.running || daemon.cyclesCompleted >= 1) {
          clearInterval(checkDone);
          saveSummary();
          resolve();
        }
      }, 200);
    });
  });
}

async function main(): Promise<void> {
  console.log("══════════════════════════════════════════════════════════════════════════════");
  console.log("       MONEY BOYS // FIVE DEMO BOTS CONTINUOUS EXECUTION ENGINE");
  console.log(` Active Universe: ${SYMBOLS.join(", ")}`);
  console.log(` Output: ${LOG_FILE}`);
  console.log("══════════════════════════════════════════════════════════════════════════════\n");

  let round = 1;
  while (true) {
    console.log(`\n--- ROUND ${round++} (${new Date().toISOString()}) ---`);
    for (const sym of SYMBOLS) {
      try {
        await runCycleForSymbol(sym);
      } catch (err) {
        console.error(`Error in cycle for ${sym}:`, err instanceof Error ? err.message : err);
      }
      // Stagger 1.5s between symbols to be gentle on exchange rate limits
      await new Promise((r) => setTimeout(r, 1500));
    }

    // Sleep 10s between rounds
    await new Promise((r) => setTimeout(r, 10000));
  }
}

main().catch((err) => {
  console.error("Fatal daemon crash:", err);
  process.exit(1);
});
