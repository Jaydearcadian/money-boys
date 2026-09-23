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
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "HARD VETO"
        ? "border-rose-200 bg-rose-50 text-rose-700"
        : "border-amber-200 bg-amber-50 text-amber-700";
  return (
    <section className="border border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Quorum Gate</h2>
        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${badge}`}>{status}</span>
      </div>
      <div className="mt-3 space-y-2">
        {members.map((m) => {
          const v = typeof scores[m] === "number" ? (scores[m] as number) : 0;
          const hurdle = HURDLES[m] ?? 0;
          const pass = v >= hurdle;
          return (
            <div key={m}>
              <div className="flex justify-between font-mono text-[11px] tabular-nums">
                <span className="uppercase text-zinc-500">{m} {v.toFixed(1)} / hurdle {hurdle}</span>
                <span className={pass ? "text-emerald-700" : "text-rose-700"}>{pass ? "PASS" : "FAIL"}</span>
              </div>
              <div className="relative h-2 rounded bg-zinc-100">
                <div className={`h-2 rounded ${pass ? "bg-emerald-500" : "bg-rose-400"}`} style={{ width: Math.min(100, v) + "%" }} />
                <div className="absolute -top-1 h-4 w-[2px] bg-zinc-950" style={{ left: hurdle + "%" }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 font-mono text-xs tabular-nums text-zinc-950">
        COMPOSITE {composite !== null ? composite.toFixed(1) : "—"} / 75.0 · QUORUM {passing.length}/4 {passing.length >= 3 ? "passing" : "Soft Reject (50% Scaled)"}
      </div>
    </section>
  );
}
