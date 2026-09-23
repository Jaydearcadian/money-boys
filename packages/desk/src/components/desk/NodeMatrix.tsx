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
    <section className="border border-zinc-200 bg-white p-4">
      <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Node Matrix</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <div key={c.key} className="border border-zinc-200 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold tracking-widest">{c.title}</span>
              <span className="inline-flex items-center rounded-full border border-zinc-200 px-2 py-0.5 font-mono text-[10px] text-zinc-700">{c.status}</span>
            </div>
            <div className="mt-2 font-mono text-xl tabular-nums text-zinc-950">{c.latency}</div>
            <div className="mt-1 truncate font-mono text-xs tabular-nums text-zinc-600" title={c.detail}>{c.detail}</div>
            <div className="font-mono text-[10px] text-zinc-400">{c.sub}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
