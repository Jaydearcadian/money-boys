/**
 * Runner for Autonomous Desk Daemon.
 *
 * Runs continuous cycles of Money Boys trading engine against live feeds.
 *
 * Usage:
 *   # Paper mode (default):
 *   node --import tsx scripts/run-autonomous-daemon.ts --mode=paper --cycles=3
 *
 *   # Live Bitget Demo mode:
 *   set -a; . .env; set +a; BITGET_ENV=testnet \
 *     node --import tsx scripts/run-autonomous-daemon.ts --mode=demo --cycles=3
 */
import { AutonomousDeskDaemon, type DaemonCycleReport } from "../packages/engine/src/autonomous/daemon.js";

function parseArgs(): {
  mode: "PAPER" | "DEMO";
  cycles: number;
  intervalMs: number;
  symbol: string;
  targetUsd: number;
} {
  const args = process.argv.slice(2);
  let mode: "PAPER" | "DEMO" = (process.env["BITGET_ENV"] ?? "").toLowerCase() === "testnet" ? "DEMO" : "PAPER";
  let cycles = 5; // Default 5 cycles for CLI runner if not specified
  let intervalMs = 4000;
  let symbol = "rNVDAUSDT";
  let targetUsd = 25;

  for (const a of args) {
    if (a.startsWith("--mode=")) {
      const m = a.split("=")[1]?.toUpperCase();
      if (m === "DEMO" || m === "PAPER") mode = m;
    } else if (a.startsWith("--cycles=")) {
      cycles = Number(a.split("=")[1]) || 5;
    } else if (a.startsWith("--interval=")) {
      intervalMs = Number(a.split("=")[1]) || 4000;
    } else if (a.startsWith("--symbol=")) {
      symbol = a.split("=")[1] || "rNVDAUSDT";
    } else if (a.startsWith("--targetUsd=")) {
      targetUsd = Number(a.split("=")[1]) || 25;
    }
  }

  return { mode, cycles, intervalMs, symbol, targetUsd };
}

async function main(): Promise<void> {
  const opts = parseArgs();

  console.log("══════════════════════════════════════════════════════════════════════════════");
  console.log(` MONEY BOYS AUTONOMOUS DESK DAEMON`);
  console.log(` Mode: ${opts.mode} | Symbol: ${opts.symbol} | Target: $${opts.targetUsd} | Cycles: ${opts.cycles}`);
  console.log("══════════════════════════════════════════════════════════════════════════════");

  const daemon = new AutonomousDeskDaemon({
    mode: opts.mode,
    symbol: opts.symbol,
    targetNotionalUsd: opts.targetUsd,
    intervalMs: opts.intervalMs,
    maxCycles: opts.cycles,
    autoCloseDemoPositions: true,
  });

  daemon.onCycle((report: DaemonCycleReport) => {
    console.log(`\n[Cycle ${report.cycleNumber}/${opts.cycles}] ${report.timestamp}`);
    console.log(`  Regime: ${report.regime} | Token: $${report.tokenPrice.toFixed(2)} | Benchmark: $${report.benchmarkMidpoint.toFixed(2)}`);
    console.log(`  Basis: ${report.rawBasisPct > 0 ? "+" : ""}${report.rawBasisPct.toFixed(4)}% | Net Edge: ${report.netEdgePct > 0 ? "+" : ""}${report.netEdgePct.toFixed(4)}% | Action: ${report.action}`);
    console.log(`  Council Decision: ${report.decision} | Receipt: ${report.receiptHash.slice(0, 16)}...`);
    console.log(`  Dispatched: ${report.dispatched ? "YES" : "NO"} | Account Flat: ${report.accountFlat ? "YES" : "NO"} | Cycle Latency: ${report.latencyMs}ms`);
    if (report.notes) console.log(`  Notes: ${report.notes}`);
  });

  const cleanup = async () => {
    console.log("\n[daemon] Received shutdown signal, stopping...");
    await daemon.stop();
    console.log("[daemon] Stopped cleanly. Account flat.");
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  await daemon.start();

  // Wait for max cycles to complete
  while (daemon.running && daemon.cyclesCompleted < opts.cycles) {
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log("\n══════════════════════════════════════════════════════════════════════════════");
  console.log(` DAEMON RUN COMPLETE: ${daemon.cyclesCompleted} cycles finished. Account FLAT.`);
  console.log("══════════════════════════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("[daemon] Fatal error:", err);
  process.exit(1);
});
