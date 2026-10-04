/**
 * Data helpers for the v2 landing page.
 *
 * Everything numeric on the page that is not read from the engine is derived
 * here from stated inputs, never typed in as a literal result. The previous
 * ticker hard-coded a "net edge" per row; the AAPL row (-0.04% basis, 0.38%
 * drag) printed -0.42% where the arithmetic gives -0.34%. Deriving it removes
 * that class of drift.
 */

export interface BasisInputs {
  tokenMid: number;
  benchmarkClose: number;
  hurdleDragPct: number;
}

export type BasisDirection = "SELL_BASIS" | "BUY_BASIS" | "FLAT";

export interface BasisResult {
  valid: boolean;
  rawPct: number;
  edgePct: number;
  direction: BasisDirection;
  /** True only when |raw basis| exceeds the hurdle drag. */
  clears: boolean;
}

/**
 * Illustrative arithmetic only: net edge = |raw basis| - hurdle drag.
 * The real Quant Boy applies further gates (VWAP walk, depth coverage,
 * z-score); this models the headline relationship and nothing more.
 */
export function computeBasis({ tokenMid, benchmarkClose, hurdleDragPct }: BasisInputs): BasisResult {
  const ok =
    Number.isFinite(tokenMid) &&
    Number.isFinite(benchmarkClose) &&
    Number.isFinite(hurdleDragPct) &&
    tokenMid > 0 &&
    benchmarkClose > 0 &&
    hurdleDragPct >= 0;
  if (!ok) return { valid: false, rawPct: 0, edgePct: 0, direction: "FLAT", clears: false };

  const rawPct = ((tokenMid - benchmarkClose) / benchmarkClose) * 100;
  const edgePct = Math.abs(rawPct) - hurdleDragPct;
  const direction: BasisDirection = rawPct > 0 ? "SELL_BASIS" : rawPct < 0 ? "BUY_BASIS" : "FLAT";
  return { valid: true, rawPct, edgePct, direction, clears: edgePct > 0 };
}

export interface BasisPreset extends BasisInputs {
  symbol: string;
  name: string;
}

/** Fixtures for the worked example. NOT live market data. */
export const BASIS_PRESETS: readonly BasisPreset[] = [
  { symbol: "rNVDA", name: "NVIDIA", tokenMid: 132.5, benchmarkClose: 128.8, hurdleDragPct: 0.73 },
  { symbol: "rTSLA", name: "Tesla", tokenMid: 214.2, benchmarkClose: 218.0, hurdleDragPct: 0.72 },
  { symbol: "rAAPL", name: "Apple", tokenMid: 224.1, benchmarkClose: 224.2, hurdleDragPct: 0.38 },
  { symbol: "rMSFT", name: "Microsoft", tokenMid: 432.8, benchmarkClose: 428.5, hurdleDragPct: 0.45 },
];

export type ClaimState = "LIVE_DEMONSTRATED" | "TESTED" | "UNKNOWN";

export interface LedgerClaim {
  id: string;
  statement: string;
  state: ClaimState;
  limitation: string | null;
}

/** Parse foundry/claims.jsonl. Malformed lines are skipped, never thrown. */
export function parseClaims(raw: string): LedgerClaim[] {
  const out: LedgerClaim[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const r = JSON.parse(t) as Record<string, unknown>;
      const id = String(r["id"] ?? r["claim_id"] ?? "");
      const statement = String(r["claim"] ?? r["statement"] ?? "");
      const st = String(r["state"] ?? r["status"] ?? "");
      const state: ClaimState = st === "LIVE_DEMONSTRATED" || st === "TESTED" ? st : "UNKNOWN";
      const lims = Array.isArray(r["limitations"]) ? (r["limitations"] as unknown[]) : [];
      if (!id || !statement) continue;
      out.push({ id, statement, state, limitation: lims.length ? String(lims[0]) : null });
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}
