import { useEffect, useState } from "react";

export type Decision = {
  timestamp: string;
  symbol: string;
  catalyst: string;
  evidenceHash: string;
  score: number;
  decision: "APPROVED" | "VETOED";
  status: string;
  fillPrice: number;
  quantity: number;
  pnlUsd: number;
  receiptHash: string;
  orderId: string;
};

export type Trade = {
  tradeId: string;
  symbol: string;
  side: string;
  entryDate: string;
  entryTokenPrice: number;
  entryEquityPrice: number;
  entryBasisPct: number;
  quantity: number;
  notionalUsd: number;
  exitDate: string;
  exitBasisPct: number;
  holdingDays: number;
  pnlUsd: number;
  returnPct: number;
  feesUsd: number;
  receiptHash: string;
  isOutSample: boolean;
};

export type Records = { decisions: Decision[]; trades: Trade[]; skipped: number };

const HEX64 = /^[0-9a-f]{64}$/;

/** "rNVDAUSDT" and "NVDAUSDT" both become "NVDA". */
export const baseTicker = (s: string) => s.replace(/^r/, "").replace(/USDT$/, "");

export const isHash = (s: string) => HEX64.test(s);

function lines(csv: string): string[] {
  return csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
}

/**
 * The decision log has free text (catalystSnippet) that can contain commas
 * without quoting. The ten trailing columns are fixed, so anchor from the right
 * and treat everything between `symbol` and those ten as the catalyst.
 */
export function parseDecisions(csv: string): { rows: Decision[]; skipped: number } {
  const [, ...body] = lines(csv);
  const rows: Decision[] = [];
  let skipped = 0;
  for (const line of body) {
    const p = line.split(",");
    if (p.length < 12) {
      skipped++;
      continue;
    }
    const tail = p.slice(-10);
    const [evidenceHash, score, decision, status, , fill, qty, pnl, receiptHash, orderId] = tail as [
      string, string, string, string, string, string, string, string, string, string,
    ];
    if (decision !== "APPROVED" && decision !== "VETOED") {
      skipped++;
      continue;
    }
    rows.push({
      timestamp: p[0] ?? "",
      symbol: p[1] ?? "",
      catalyst: p.slice(2, p.length - 10).join(","),
      evidenceHash,
      score: Number(score),
      decision,
      status,
      fillPrice: Number(fill),
      quantity: Number(qty),
      pnlUsd: Number(pnl),
      receiptHash,
      orderId,
    });
  }
  return { rows, skipped };
}

export function parseTrades(csv: string): Trade[] {
  const [, ...body] = lines(csv);
  const out: Trade[] = [];
  for (const line of body) {
    const p = line.split(",");
    if (p.length < 19) continue;
    out.push({
      tradeId: p[0]!,
      symbol: p[1]!,
      side: p[2]!,
      entryDate: p[3]!,
      entryTokenPrice: Number(p[4]),
      entryEquityPrice: Number(p[5]),
      entryBasisPct: Number(p[6]),
      quantity: Number(p[7]),
      notionalUsd: Number(p[8]),
      exitDate: p[9]!,
      exitBasisPct: Number(p[12]),
      holdingDays: Number(p[13]),
      pnlUsd: Number(p[14]),
      returnPct: Number(p[15]),
      feesUsd: Number(p[16]),
      receiptHash: p[17]!,
      isOutSample: p[18] === "true",
    });
  }
  return out;
}

async function getCsv(path: string, header: string): Promise<string> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const text = await res.text();
  if (!text.startsWith(header)) throw new Error(`${path}: unexpected content`);
  return text;
}

export function useRecords(): { data: Records | null; error: string | null } {
  const [data, setData] = useState<Records | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all([
      getCsv("/money_boys_paper_trades.csv", "timestamp,"),
      getCsv("/money_boys_89d_trades.csv", "tradeId,"),
    ])
      .then(([d, t]) => {
        if (!live) return;
        const { rows, skipped } = parseDecisions(d);
        setData({ decisions: rows, trades: parseTrades(t), skipped });
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, []);
  return { data, error };
}
