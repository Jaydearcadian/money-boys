import type { DeskState } from "../../lib/api";
import { fmtUsd } from "../cards";

function num(n: unknown, dp = 2): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(dp) : "—";
}

export function TopTelemetryBar(props: {
  state: DeskState | null;
  isConnected: boolean;
  busy: boolean;
  error: string | null;
  onSimulate: (params?: { symbol?: string; side?: string; quantity?: number; priceUsd?: number }) => void;
  onVetoProbe: () => void;
  onHalt: () => void;
}) {
  const halted = props.state?.systemHalt === true;
  const acct = props.state?.account;
  const util = acct?.marginUtilPct ?? 0;
  const pulse = halted
    ? "bg-rose-50 border-rose-200 text-rose-700"
    : props.isConnected
      ? "bg-orange-50 border-orange-200 text-orange-700"
      : "bg-emerald-50 border-emerald-200 text-emerald-700";
  const label = halted ? "EMERGENCY HALT" : props.isConnected ? "LIVE TELEMETRY" : "ARMED";
  return (
    <div className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-6 py-3">
        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-xs font-bold ${pulse}`}>
          <span className={`inline-block h-2 w-2 rounded-full ${halted ? "bg-rose-500" : "bg-orange-500"} animate-pulse`} />
          {label}
        </span>
        <div className="flex items-center gap-4 font-mono text-xs tabular-nums text-zinc-950">
          <span>EQUITY <b>{acct ? fmtUsd(acct.equityUsd) : "—"}</b></span>
          <span>FREE <b>{acct ? fmtUsd(acct.freeMarginUsd) : "—"}</b></span>
          <span>UTIL <b>{num(util)}%</b></span>
        </div>
        <div className="relative h-2 min-w-[160px] flex-1 overflow-visible rounded bg-zinc-100">
          <div className="h-2 rounded bg-orange-500" style={{ width: Math.min(100, util) + "%" }} />
          <div className="absolute -top-1 h-4 w-[2px] bg-rose-600" style={{ left: "65%" }} title="65% ceiling" />
        </div>
        <div className="flex gap-2">
          <button disabled={props.busy || halted} onClick={() => props.onSimulate()} className="bg-zinc-950 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-zinc-800 disabled:opacity-40">Simulate Catalyst Event</button>
          <button disabled={props.busy || halted} onClick={props.onVetoProbe} className="border border-zinc-200 bg-white px-3 py-2 font-mono text-xs hover:border-orange-300 disabled:opacity-40">Test Risk Veto</button>
          <button disabled={props.busy} onClick={props.onHalt} className={halted ? "bg-rose-600 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white" : "border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold uppercase tracking-wider text-rose-700"}>{halted ? "Resume" : "Emergency Halt"}</button>
        </div>
      </div>
      {props.error && <p className="mx-auto max-w-6xl px-6 pb-2 font-mono text-xs text-rose-700">{props.error}</p>}
    </div>
  );
}
