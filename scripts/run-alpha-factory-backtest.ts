/**
 * Track 1 — Alpha Factory Backtest Hedge.
 *
 * Deterministic weekend-basis backtest across rNVDA/rTSLA/rAAPL:
 * quant.evaluateBasisSpread → execution.evaluateExecution → council
 * reduceCouncilVote → PAPER dispatch accounting (no network, no keys).
 *
 * Writes:
 *  - foundry/evidence/paper-trading/alpha_factory_backtest.jsonl
 *  - foundry/evidence/paper-trading/alpha_factory_summary.json
 *
 * Run: pnpm exec tsx scripts/run-alpha-factory-backtest.ts
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateBasisSpread } from "../packages/engine/src/agents/quant.js";
import { evaluateExecution } from "../packages/engine/src/agents/execution.js";
import { reduceCouncilVote } from "../packages/engine/src/council/reducer.js";
import { StructuralChangeGuard } from "../packages/engine/src/skills/igraph-guard/security.js";
import { TradFiBenchmarkService } from "../packages/engine/src/agents/benchmarks.js";
import { hashCatalystPayload } from "../packages/engine/src/skills/noema-qa/provenance.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "foundry/evidence/paper-trading");

const SYMBOLS = ["rNVDAUSDT", "rTSLAUSDT", "rAAPLUSDT"] as const;

const SCENARIOS: Array<{ headline: string; macroScore: number; dislocationBps: number }> = [
  { headline: "Hyperscaler capex raise extends GPU visibility", macroScore: 90, dislocationBps: 320 },
  { headline: "Robotaxi permits expand to new metros", macroScore: 84, dislocationBps: 240 },
  { headline: "Fed dovish tilt trims weekend vol", macroScore: 81, dislocationBps: 180 },
  { headline: "Services reacceleration lifts installed base", macroScore: 78, dislocationBps: 150 },
  { headline: "EV delivery beat, margin stabilizes", macroScore: 83, dislocationBps: 210 },
  { headline: "Foundry allocation secured, yields on track", macroScore: 86, dislocationBps: 260 },
  { headline: "FSD take-rate inflects, audit clean", macroScore: 71, dislocationBps: 140 },
  { headline: "PC refresh confirmed by channel drawdown", macroScore: 64, dislocationBps: 130 },
  { headline: "Hawkish minutes leak, futures reprice", macroScore: 42, dislocationBps: 320 },
  { headline: "Unconfirmed export-control rumor", macroScore: 35, dislocationBps: 140 },
  { headline: "Autonomous freight corridor fast-tracked", macroScore: 92, dislocationBps: 340 },
  { headline: "Index rebalance distorts Friday close", macroScore: 58, dislocationBps: 60 },
  { headline: "Chip license clarity lifts hardware", macroScore: 88, dislocationBps: 290 },
  { headline: "Narrow antitrust remedy, no split", macroScore: 68, dislocationBps: 150 },
];

function seededUnit(seed: string): number {
  return parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) / 0xffffffff;
}

function buildDepth(mid: number) {
  const lvl = 750;
  const bids = Array.from({ length: 10 }, (_, i) => {
    const price = Math.round(mid * (1 - 0.0002 * (i + 1)) * 100) / 100;
    return { price, quantity: Math.round((lvl / price) * 1e4) / 1e4 };
  });
  const asks = Array.from({ length: 10 }, (_, i) => {
    const price = Math.round(mid * (1 + 0.0002 * (i + 1)) * 100) / 100;
    return { price, quantity: Math.round((lvl / price) * 1e4) / 1e4 };
  });
  return { bids, asks };
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const START = 20000;
  let equity = START;
  let hwm = START;
  let maxDd = 0;
  let wins = 0;
  let executed = 0;
  let approved = 0;
  let soft = 0;
  let veto = 0;
  let fees = 0;
  let longPnl = 0;
  let shortPnl = 0;
  const lines: string[] = [];

  const baseMs = Date.parse("2026-09-03T00:00:00Z");
  const total = SCENARIOS.length * SYMBOLS.length; // 42

  for (let i = 0; i < total; i++) {
    const symbol = SYMBOLS[i % SYMBOLS.length]!;
    const sc = SCENARIOS[Math.floor(i / SYMBOLS.length) % SCENARIOS.length]!;
    const ts = new Date(baseMs + Math.floor(i / 2) * 86400000 + (i % 2 === 0 ? 8 : 20) * 3600000).toISOString();

    const bench = TradFiBenchmarkService.snapshot(symbol);
    const jitter = (seededUnit(`alpha:disl:${i}`) - 0.5) * 40;
    const disl = (sc.dislocationBps + jitter) / 10000;
    const tokenPrice = Math.round(bench.closePriceUsd * (1 + disl) * 100) / 100;
    const side: "buy" | "sell" = tokenPrice >= bench.closePriceUsd ? "sell" : "buy";
    const breach = i === 17 || i === 33;
    const marginal = sc.macroScore < 75 && !breach;
    const exposure = breach ? 5400 : marginal ? 4400 + seededUnit(`alpha:exp:${i}`) * 500 : 1600 + seededUnit(`alpha:exp:${i}`) * 2600;
    const quantity = Math.floor((exposure / tokenPrice) * 1e4) / 1e4;
    const orderSizeUsd = Math.round(quantity * tokenPrice * 100) / 100;
    const depth = buildDepth(tokenPrice);

    const quant = evaluateBasisSpread({
      tokenPrice,
      tradFiClosePrice: bench.closePriceUsd,
      orderSizeUsd,
      depth,
      fundingRate8h: Math.round(seededUnit(`alpha:fr:${i}`) * 0.00025 * 1e8) / 1e8,
      hoursToClose: 48 + Math.round(seededUnit(`alpha:h:${i}`) * 12),
      takerFee: 0.0006,
    });
    const account = { equityUsd: Math.round(equity * 100) / 100, usedMarginUsd: 1000, freeMarginUsd: Math.round((equity - 1000) * 100) / 100, openOrders: [] as Array<{ orderId: string; symbol: string }> };
    const risk = StructuralChangeGuard.evaluateBlastRadius({ symbol, side, quantity, priceUsd: tokenPrice }, account);
    const exec = evaluateExecution({
      orderSizeUsd,
      availableDepthUsd: quant.availableDepthUsd,
      depthCoverage: quant.depthCoverage,
      completeFill: quant.completeFill,
      takerFee: 0.0006,
      vwapSlippage: quant.vwapSlippage,
    });
    const riskScore = risk.decision !== "APPROVED" ? 0 : Math.max(0, Math.min(100, Math.round((100 - risk.projectedMarginUtilization * 100 * 0.5) * 10) / 10));
    const vote = reduceCouncilVote({
      macroScore: sc.macroScore,
      quantScore: quant.quantScore,
      riskScore,
      execScore: exec.executionScore,
      riskPermitted: risk.decision === "APPROVED",
      originalExposureUsd: orderSizeUsd,
    });

    // Hedge accounting: council APPROVED (or pass-2 scaled SOFT_REJECT that
    // clears on half size) dispatches PAPER; settle vs Friday close with
    // partial convergence + drift, minus fees.
    let decision = vote.status === "APPROVED" ? "APPROVED" : vote.status === "HARD_VETO" ? "VETOED" : "REJECTED";
    let execQty = quantity;
    let passNumber = 1;
    if (vote.status === "SOFT_REJECT") {
      const half = Math.floor(quantity * 0.5 * 1e4) / 1e4;
      const halfUsd = half * tokenPrice;
      const q2 = evaluateBasisSpread({ tokenPrice, tradFiClosePrice: bench.closePriceUsd, orderSizeUsd: halfUsd, depth, fundingRate8h: 0, hoursToClose: 48, takerFee: 0.0006 });
      const r2 = StructuralChangeGuard.evaluateBlastRadius({ symbol, side, quantity: half, priceUsd: tokenPrice }, account);
      const e2 = evaluateExecution({ orderSizeUsd: halfUsd, availableDepthUsd: q2.availableDepthUsd, depthCoverage: q2.depthCoverage, completeFill: q2.completeFill, takerFee: 0.0006, vwapSlippage: q2.vwapSlippage });
      const rs2 = r2.decision !== "APPROVED" ? 0 : Math.max(0, Math.min(100, Math.round((100 - r2.projectedMarginUtilization * 100 * 0.5) * 10) / 10));
      const v2 = reduceCouncilVote({ macroScore: sc.macroScore, quantScore: q2.quantScore, riskScore: rs2, execScore: e2.executionScore, riskPermitted: r2.decision === "APPROVED", originalExposureUsd: halfUsd });
      if (v2.status === "APPROVED") {
        decision = "APPROVED";
        execQty = half;
        passNumber = 2;
        soft += 1;
      }
    }
    if (vote.status === "APPROVED") approved += 1;
    if (vote.status === "HARD_VETO") veto += 1;

    let pnl = 0;
    let fee = 0;
    if (decision === "APPROVED") {
      executed += 1;
      fee = Math.round(execQty * tokenPrice * 0.0006 * 100) / 100;
      fees += fee;
      const conv = 0.55 + seededUnit(`alpha:conv:${i}`) * 0.45;
      const drift = (seededUnit(`alpha:drift:${i}`) - 0.5) * 0.02 * bench.closePriceUsd;
      const settle = bench.closePriceUsd + (tokenPrice - bench.closePriceUsd) * (1 - conv) + drift;
      const gross = side === "sell" ? (tokenPrice - settle) * execQty : (settle - tokenPrice) * execQty;
      pnl = Math.round((gross - fee) * 100) / 100;
      if (pnl > 0) wins += 1;
      if (side === "sell") shortPnl += pnl; else longPnl += pnl;
      equity = Math.round((equity + pnl) * 100) / 100;
    }
    hwm = Math.max(hwm, equity);
    maxDd = Math.max(maxDd, hwm > 0 ? ((hwm - equity) / hwm) * 100 : 0);

    lines.push(JSON.stringify({
      timestamp: ts,
      symbol,
      side,
      dislocationBps: Math.round(disl * 10000),
      quantScore: quant.quantScore,
      netEdgePct: quant.netEdgePct,
      councilStatus: vote.status,
      compositeScore: vote.compositeScore,
      decision,
      passNumber,
      pnlUsd: pnl,
      equityUsd: equity,
      evidenceHash: hashCatalystPayload({ symbol, headline: sc.headline, timestamp: ts }),
    }));
  }

  writeFileSync(join(OUT_DIR, "alpha_factory_backtest.jsonl"), lines.join("\n") + "\n");
  const summary = {
    strategyName: "Money Boys — Track 1 Alpha Factory (Weekend Basis Hedge)",
    period: "2026-09-03T00:00:00Z to 2026-09-23T23:59:59Z",
    deliberations: total,
    councilApproved: approved,
    softRejectsScaled: soft,
    hardVetoes: veto,
    executedTrades: executed,
    startingCapitalUsd: START,
    endingCapitalUsd: equity,
    netReturnPct: Math.round(((equity - START) / START) * 10000) / 100,
    winRatePct: executed > 0 ? Math.round((wins / executed) * 10000) / 100 : 0,
    maxDrawdownPct: Math.round(maxDd * 100) / 100,
    totalFeesPaidUsd: Math.round(fees * 100) / 100,
    longPnlUsd: Math.round(longPnl * 100) / 100,
    shortPnlUsd: Math.round(shortPnl * 100) / 100,
    mode: "PAPER",
  };
  writeFileSync(join(OUT_DIR, "alpha_factory_summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(`[alpha-factory] cycles=${total} approved=${approved} scaled=${soft} vetoes=${veto} executed=${executed} equity=${equity.toFixed(2)} ret=${summary.netReturnPct}%`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
