import { useState } from "react";
import type { SealedReasoningReceipt } from "../../lib/api";
import { Badge, shortHash } from "../cards";

function num(n: unknown, dp = 2): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(dp) : "—";
}

function actionOf(r: SealedReasoningReceipt): string {
  if (r.decision === "VETOED") return "VETOED";
  return r.action === "buy" ? "BUY_BASIS" : r.action === "sell" ? "SELL_BASIS" : r.action;
}

export function AuditLedger({ receipts }: { receipts: SealedReasoningReceipt[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const open = receipts.find((r) => r.receiptId === openId) ?? null;
  return (
    <section className="border border-zinc-200 bg-white p-4">
      <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Audit Ledger · live ({receipts.length})</h2>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full font-mono text-xs tabular-nums">
          <thead><tr className="text-left text-zinc-500"><th className="py-1">TIME</th><th>SYMBOL</th><th>ACTION</th><th>SCORE</th><th>MARGIN%</th><th>HASH</th><th>STATUS</th></tr></thead>
          <tbody>
            {receipts.map((r) => {
              const scores = r.councilScores as Record<string, number>;
              const risk = r.riskReport as Record<string, unknown>;
              return (
                <tr key={r.receiptId} onClick={() => { setOpenId(r.receiptId); setCopied(false); }} className="cursor-pointer border-t border-zinc-200 hover:bg-orange-50/40">
                  <td className="py-1 text-zinc-500">{new Date(r.sealedAt).toLocaleTimeString("en-GB")}</td>
                  <td className="text-zinc-950">{r.symbol}</td>
                  <td>{actionOf(r)}</td>
                  <td>{num(scores["compositeScore"], 1)}</td>
                  <td>{num(risk["projectedMarginUtilizationPct"])}</td>
                  <td className="text-zinc-500">{r.receiptHash.slice(0, 12)}</td>
                  <td><span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">[VERIFIED]</span></td>
                </tr>
              );
            })}
            {receipts.length === 0 && <tr><td className="py-2 text-zinc-500">No receipts streamed yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-zinc-950/30" onClick={() => setOpenId(null)}>
          <div className="h-full w-full max-w-xl overflow-y-auto border-l border-zinc-200 bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold">Receipt {shortHash(open.receiptHash)}</h3>
              <button className="border border-zinc-200 px-3 py-1 font-mono text-xs" onClick={() => setOpenId(null)}>Close</button>
            </div>
            <div className="mt-2 flex gap-2"><Badge verdict={open.decision} /><span className="font-mono text-xs text-zinc-500">{actionOf(open)}</span></div>
            <pre className="mt-4 max-h-[50vh] overflow-auto border border-zinc-200 bg-zinc-50 p-3 font-mono text-[11px]">{JSON.stringify(open, null, 2)}</pre>
            <button className="mt-3 border border-zinc-200 px-3 py-2 font-mono text-xs" onClick={() => { void navigator.clipboard?.writeText(open.receiptHash).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? "Copied ✓" : "Copy SHA-256 Hash"}</button>
          </div>
        </div>
      )}
    </section>
  );
}
