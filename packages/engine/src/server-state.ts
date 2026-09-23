/**
 * Phase 05 Batch 2 — part 1: state + seal helpers.
 * Native node:http only (I-05).
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";
import { sealReceipt, type SealedReasoningReceipt } from "./council/receipts.js";
import { evaluateBasisSpread } from "./agents/quant.js";
import { StructuralChangeGuard, toBlastRadiusReport } from "./skills/igraph-guard/security.js";

export const TELEMETRY_PORT = Number(process.env.PORT ?? 3001);
export const COMMIT = process.env.COMMIT ?? "f1409c7";

export interface DeskSnapshot {
  systemHalt: boolean;
  activeNodes: {
    macro: { status: string; model: string; latencyMs: number; lastCatalyst: string };
    quant: { status: string; latencyMs: number; lastNetEdgePct: number };
    risk: { status: string; marginUtilizationPct: number; hardVetoActive: boolean };
    exec: { status: string; venue: string; latencyMs: number };
  };
  account: { equityUsd: number; usedMarginUsd: number; freeMarginUsd: number; marginUtilPct: number };
  latestReceipt: SealedReasoningReceipt | null;
  recentCount: number;
}

export const state = {
  systemHalt: false,
  activeNodes: {
    macro: { status: "ACTIVE", model: "qwen3.8-max", latencyMs: 1240, lastCatalyst: "TSMC CoWoS capacity expansion" },
    quant: { status: "ACTIVE", latencyMs: 0.15, lastNetEdgePct: 2.14 },
    risk: { status: "ARMED", marginUtilizationPct: 25.0, hardVetoActive: false },
    exec: { status: "READY", venue: "bitget", latencyMs: 32 },
  },
  account: { equityUsd: 21795.18, usedMarginUsd: 5448.8, freeMarginUsd: 16346.38, marginUtilPct: 25.0 },
  latestReceipt: null as SealedReasoningReceipt | null,
  recentReceipts: [] as SealedReasoningReceipt[],
  sseClients: new Set<ServerResponse>(),
};

export function snapshot(): DeskSnapshot {
  return {
    systemHalt: state.systemHalt,
    activeNodes: state.activeNodes,
    account: state.account,
    latestReceipt: state.latestReceipt,
    recentCount: state.recentReceipts.length,
  };
}

export function pushReceipt(r: SealedReasoningReceipt): void {
  // Newest-first ring buffer (prepend, cap 50) — matches telemetry spec.
  state.latestReceipt = r;
  state.recentReceipts.unshift(r);
  if (state.recentReceipts.length > 50) state.recentReceipts.length = 50;
}

export function broadcastReceipt(receipt: SealedReasoningReceipt, execution?: unknown): void {
  const payload = "data: " + JSON.stringify({ type: "NEW_RECEIPT", receipt, execution: execution ?? null }) + "\n\n";
  for (const c of state.sseClients) {
    try { c.write(payload); } catch { /* noop */ }
  }
}

export function broadcastHalt(): void {
  const payload = "data: " + JSON.stringify({ type: "HALT_CHANGE", systemHalt: state.systemHalt }) + "\n\n";
  for (const c of state.sseClients) {
    try { c.write(payload); } catch { /* noop */ }
  }
}

export function seededSample(): SealedReasoningReceipt {
  const tokenPrice = 132.71;
  const close = 128.8;
  const bids = Array.from({ length: 8 }, (_, i) => ({ price: tokenPrice * (1 - 0.0003 * (i + 1)), quantity: 40 }));
  const asks = Array.from({ length: 8 }, (_, i) => ({ price: tokenPrice * (1 + 0.0003 * (i + 1)), quantity: 40 }));
  const quant = evaluateBasisSpread({
    tokenPrice, tradFiClosePrice: close, orderSizeUsd: 2500,
    depth: { bids, asks }, fundingRate8h: 0.0001, hoursToClose: 8, takerFee: 0.0006,
  });
  const blast = StructuralChangeGuard.evaluateBlastRadius(
    { symbol: "rNVDAUSDT", side: "buy", quantity: 18, priceUsd: tokenPrice },
    { equityUsd: 21795.18, usedMarginUsd: 5448.8, freeMarginUsd: 16346.38, openOrders: [] },
  );
  return sealReceipt({
    symbol: "rNVDAUSDT", action: quant.action, quantMetrics: quant,
    riskReport: toBlastRadiusReport(blast),
    councilScores: { compositeScore: 86.4, macro: 88, quant: quant.quantScore, risk: 87.5, exec: 82 },
    decision: blast.decision === "APPROVED" ? "APPROVED" : "VETOED",
    rationale: "Telemetry seed: Friday dislocation vs snapshot; margin safe.",
    metadata: { passNumber: 1, originalQuantity: 18, executedQuantity: 18 },
  });
}

export function seedLatest(): void {
  if (state.latestReceipt) return;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const paperPath = join(here, "..", "..", "..", "foundry", "evidence", "paper-trading", "paper_trades.jsonl");
    if (existsSync(paperPath)) {
      const lines = readFileSync(paperPath, "utf8").split("\n").filter(Boolean);
      const last = lines.length > 0 ? JSON.parse(lines[lines.length - 1] as string) as Record<string, unknown> : null;
      const seed = seededSample();
      pushReceipt(sealReceipt({
        symbol: typeof last?.["symbol"] === "string" ? (last["symbol"] as string) : seed.symbol,
        action: seed.action, quantMetrics: seed.quantMetrics, riskReport: seed.riskReport,
        councilScores: seed.councilScores, decision: seed.decision,
        rationale: "Seed from paper_trades.jsonl tail.",
        metadata: seed.metadata,
      }));
      return;
    }
  } catch { /* fall through */ }
  pushReceipt(seededSample());
}
