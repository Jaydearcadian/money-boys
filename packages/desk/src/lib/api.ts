export interface CouncilScores {
  compositeScore: number;
  [member: string]: number;
}

export interface SealedReasoningReceipt {
  receiptId: string;
  sealedAt: string;
  receiptHash: string;
  symbol: string;
  action: string;
  quantMetrics: Record<string, unknown>;
  riskReport: Record<string, unknown>;
  councilScores: CouncilScores;
  decision: "APPROVED" | "VETOED";
  rationale: string;
  metadata?: { passNumber: number; originalQuantity: number; executedQuantity: number };
}

export interface DeskState {
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

export const API_BASE =
  (import.meta as unknown as { env?: Record<string, string> }).env?.["VITE_API_BASE"] ??
  "http://localhost:3001";

export async function fetchState(): Promise<DeskState> {
  const res = await fetch(API_BASE + "/api/desk/state");
  if (!res.ok) throw new Error("state " + res.status);
  return (await res.json()) as DeskState;
}

export async function toggleHalt(current: boolean): Promise<{ systemHalt: boolean }> {
  const res = await fetch(API_BASE + "/api/desk/halt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemHalt: !current }),
  });
  if (!res.ok) throw new Error("halt " + res.status);
  return (await res.json()) as { systemHalt: boolean };
}

export async function simulateCycle(): Promise<{ receipt: SealedReasoningReceipt }> {
  const res = await fetch(API_BASE + "/api/desk/simulate-cycle", { method: "POST" });
  const body = (await res.json()) as { receipt?: SealedReasoningReceipt; error?: string };
  if (!res.ok) throw new Error(body.error ?? "simulate " + res.status);
  return body as { receipt: SealedReasoningReceipt };
}

export function receiptVerdict(r: SealedReasoningReceipt | null): string {
  if (!r) return "—";
  if (r.decision === "APPROVED") return "APPROVED";
  return "VETOED";
}
