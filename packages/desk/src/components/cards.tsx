import type { SealedReasoningReceipt } from "../lib/api";

export function Badge({ verdict }: { verdict: string }) {
  if (verdict === "APPROVED")
    return <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">APPROVED</span>;
  if (verdict === "HARD_VETO" || verdict === "VETOED")
    return <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700">{verdict}</span>;
  return <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">{verdict}</span>;
}

export function shortHash(h: string): string {
  if (!h) return "—";
  return h.length > 16 ? h.slice(0, 10) + "…" + h.slice(-6) : h;
}

export function fmtUsd(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ReceiptCard({ receipt }: { receipt: SealedReasoningReceipt | null }) {
  if (!receipt) return <div className="text-sm text-zinc-500">No receipt yet.</div>;
  const scores = receipt.councilScores as Record<string, number>;
  return (
    <div className="rounded-none border border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-zinc-500">{receipt.receiptId.slice(0, 8)}</span>
        <Badge verdict={receipt.decision} />
      </div>
      <div className="mt-2 font-mono text-sm tabular-nums text-zinc-950">
        {receipt.symbol} · {receipt.action} · S={Number(scores["compositeScore"] ?? 0).toFixed(1)}
      </div>
      <div className="mt-1 font-mono text-xs text-zinc-500">hash {shortHash(receipt.receiptHash)}</div>
      <p className="mt-2 text-sm text-zinc-700">{receipt.rationale}</p>
    </div>
  );
}
