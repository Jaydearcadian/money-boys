import type { DeskState } from "../../lib/api";

function num(n: unknown, dp = 2): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(dp) : "—";
}

export function NodeMatrix({ state }: { state: DeskState | null }) {
  const cards = [
    { key: "macro", title: "MACRO", status: state?.activeNodes.macro.status ?? "—", latency: state ? num(state.activeNodes.macro.latencyMs, 0) + "ms" : "—", detail: state?.activeNodes.macro.lastCatalyst ?? "—", sub: state?.activeNodes.macro.model ?? "" },
    { key: "quant", title: "QUANT", status: state?.activeNodes.quant.status ?? "—", latency: state ? num(state.activeNodes.quant.latencyMs) + "ms" : "—", detail: state ? "net edge " + num(state.activeNodes.quant.lastNetEdgePct) + "%" : "—", sub: "hot path pure TS" },
    { key: "risk", title: "RISK", status: state?.activeNodes.risk.status ?? "—", latency: "—", detail: state ? "margin util " + num(state.activeNodes.risk.marginUtilizationPct) + "%" : "—", sub: state?.activeNodes.risk.hardVetoActive ? "HARD VETO ACTIVE" : "ARMED" },
    { key: "exec", title: "EXEC", status: state?.activeNodes.exec.status ?? "—", latency: state ? num(state.activeNodes.exec.latencyMs, 0) + "ms" : "—", detail: state?.activeNodes.exec.venue ?? "—", sub: "bitget v2 HMAC" },
  ];
  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[oklch(0.18_0.014_265_/_0.65)] p-5 backdrop-blur-md">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Live Agent Node Matrix</h2>
        <span className="mono text-[11px] text-[var(--accent)] font-semibold flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[var(--accent)] animate-pulse" />
          4 AGENTS ACTIVE
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {cards.map((c) => {
          const isHardVeto = c.sub.includes("HARD VETO");
          return (
            <div key={c.key} className="rounded-xl border border-[var(--line)] bg-[oklch(0.20_0.015_265_/_0.7)] p-3.5 hover:border-zinc-500/40 transition-all">
              <div className="flex items-center justify-between">
                <span className="mono text-xs font-black tracking-widest text-white">{c.title}</span>
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 mono text-[10px] font-semibold ${
                  isHardVeto
                    ? "border-rose-500/40 bg-rose-950/40 text-rose-300"
                    : "border-emerald-500/30 bg-emerald-950/40 text-emerald-400"
                }`}>
                  {c.status}
                </span>
              </div>
              <div className="mt-2.5 mono text-2xl font-bold tabular-nums text-white">{c.latency}</div>
              <div className="mt-1 truncate mono text-xs tabular-nums text-[var(--text-muted)]" title={c.detail}>{c.detail}</div>
              <div className="mt-0.5 mono text-[10px] text-zinc-500">{c.sub}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
