import type { SealedReasoningReceipt } from "../../lib/api";

const HURDLES: Record<string, number> = { macro: 70, quant: 75, risk: 80, exec: 65 };

export function QuorumGate({ receipt }: { receipt: SealedReasoningReceipt | null }) {
  const scores = (receipt?.councilScores ?? {}) as Record<string, number>;
  const members = ["macro", "quant", "risk", "exec"];
  const composite = typeof scores["compositeScore"] === "number" ? (scores["compositeScore"] as number) : null;
  const passing = members.filter((m) => typeof scores[m] === "number" && (scores[m] as number) >= (HURDLES[m] ?? 0));
  const status = receipt ? (receipt.decision === "APPROVED" ? "COUNCIL APPROVED" : "HARD VETO") : "—";
  const badge =
    status === "COUNCIL APPROVED"
      ? "border-emerald-500/30 bg-emerald-950/40 text-emerald-400"
      : status === "HARD VETO"
        ? "border-rose-500/40 bg-rose-950/40 text-rose-300"
        : "border-amber-500/30 bg-amber-950/40 text-amber-400";
  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[oklch(0.18_0.014_265_/_0.65)] p-5 backdrop-blur-md">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Quorum Gate &amp; Consensus</h2>
        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 mono text-xs font-bold ${badge}`}>{status}</span>
      </div>
      <div className="mt-4 space-y-3">
        {members.map((m) => {
          const v = typeof scores[m] === "number" ? (scores[m] as number) : 0;
          const hurdle = HURDLES[m] ?? 0;
          const pass = v >= hurdle;
          return (
            <div key={m}>
              <div className="flex justify-between mono text-[11px] tabular-nums mb-1">
                <span className="uppercase text-[var(--text-muted)] font-semibold">{m} <span className="text-white">{v.toFixed(1)}</span> / hurdle {hurdle}</span>
                <span className={pass ? "text-[var(--accent)] font-bold" : "text-rose-400 font-bold"}>{pass ? "PASS" : "FAIL"}</span>
              </div>
              <div className="relative h-2 rounded-full bg-[oklch(0.14_0.012_265)] border border-[var(--line)]">
                <div className={`h-full rounded-full transition-all ${pass ? "bg-[var(--accent)]" : "bg-rose-500"}`} style={{ width: Math.min(100, v) + "%" }} />
                <div className="absolute -top-1 h-4 w-[2px] bg-white shadow-sm" style={{ left: hurdle + "%" }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 pt-3 border-t border-[var(--line)] mono text-xs tabular-nums text-white">
        COMPOSITE <b className="text-[var(--accent)]">{composite !== null ? composite.toFixed(1) : "—"}</b> / 75.0 · QUORUM <b>{passing.length}/4</b> {passing.length >= 3 ? <span className="text-[var(--accent)] font-bold">(Quorum Met)</span> : <span className="text-amber-400 font-bold">(Soft Reject: 50% Scaled)</span>}
      </div>
    </section>
  );
}
