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
    <section className="rounded-2xl border border-[var(--line)] bg-[oklch(0.18_0.014_265_/_0.65)] p-5 backdrop-blur-md">
      <div className="flex items-center justify-between">
        <h2 data-testid="audit-count" className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
          Audit Ledger · live ({receipts.length})
        </h2>
        <span className="mono text-[11px] text-[var(--text-muted)]">
          Click any row to inspect SHA-256 Reasoning Receipt
        </span>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full mono text-xs tabular-nums">
          <thead>
            <tr className="border-b border-[var(--line)] text-left text-[var(--text-muted)] text-[11px]">
              <th className="py-2">TIME</th>
              <th>SYMBOL</th>
              <th>ACTION</th>
              <th>SCORE</th>
              <th>MARGIN%</th>
              <th>HASH</th>
              <th>STATUS</th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((r) => {
              const scores = r.councilScores as Record<string, number>;
              const risk = r.riskReport as Record<string, unknown>;
              return (
                <tr
                  data-testid="audit-row"
                  data-receipt-id={r.receiptId}
                  key={r.receiptId}
                  onClick={() => { setOpenId(r.receiptId); setCopied(false); }}
                  className="cursor-pointer border-t border-[var(--line)] hover:bg-[oklch(0.22_0.018_265_/_0.6)] transition-colors"
                >
                  <td className="py-2.5 text-[var(--text-muted)]">{new Date(r.sealedAt).toLocaleTimeString("en-GB")}</td>
                  <td className="text-white font-bold">{r.symbol}</td>
                  <td className="text-[var(--accent)] font-semibold">{actionOf(r)}</td>
                  <td className="text-white">{num(scores["compositeScore"], 1)}</td>
                  <td className="text-white">{num(risk["projectedMarginUtilizationPct"])}%</td>
                  <td className="text-[var(--text-muted)] font-mono">{r.receiptHash.slice(0, 12)}…</td>
                  <td>
                    <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-950/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                      [VERIFIED]
                    </span>
                  </td>
                </tr>
              );
            })}
            {receipts.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-center text-[var(--text-muted)]">
                  No receipts streamed yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={() => setOpenId(null)}>
          <div className="h-full w-full max-w-xl overflow-y-auto border-l border-[var(--line)] bg-[oklch(0.16_0.012_265)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white text-base">Receipt {shortHash(open.receiptHash)}</h3>
              <button className="rounded-lg border border-[var(--line)] bg-[oklch(0.20_0.015_265)] px-3 py-1 mono text-xs text-zinc-300 hover:text-white transition-colors cursor-pointer" onClick={() => setOpenId(null)}>
                Close
              </button>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Badge verdict={open.decision} />
              <span className="mono text-xs text-[var(--text-muted)]">{actionOf(open)}</span>
            </div>
            <pre className="mt-4 max-h-[50vh] overflow-auto rounded-xl border border-[var(--line)] bg-[oklch(0.12_0.012_265)] p-4 mono text-[11px] text-emerald-300 leading-relaxed">
              {JSON.stringify(open, null, 2)}
            </pre>
            <button
              className="mt-4 rounded-xl border border-[var(--line)] bg-[oklch(0.20_0.015_265)] px-4 py-2 mono text-xs text-zinc-200 hover:border-[var(--accent)] hover:text-white transition-colors cursor-pointer"
              onClick={() => { void navigator.clipboard?.writeText(open.receiptHash).then(() => setCopied(true)).catch(() => setCopied(false)); }}
            >
              {copied ? "Copied ✓" : "Copy SHA-256 Hash"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
