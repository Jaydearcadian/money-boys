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
    ? "border-rose-500/40 bg-rose-950/40 text-rose-300"
    : props.isConnected
      ? "border-amber-500/40 bg-amber-950/40 text-amber-300"
      : "border-emerald-500/40 bg-emerald-950/40 text-emerald-300";
  const label = halted ? "EMERGENCY HALT" : props.isConnected ? "LIVE TELEMETRY" : "ARMED";
  return (
    <div className="border-b border-[var(--line)] bg-[oklch(0.14_0.012_265_/_0.8)] backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-6 py-3">
        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 mono text-xs font-bold ${pulse}`}>
          <span className={`inline-block h-2 w-2 rounded-full ${halted ? "bg-rose-500" : props.isConnected ? "bg-amber-400" : "bg-emerald-400"} animate-pulse`} />
          {label}
        </span>
        <div className="flex items-center gap-4 mono text-xs tabular-nums text-[var(--text-muted)]">
          <span>EQUITY <b className="text-white">{acct ? fmtUsd(acct.equityUsd) : "—"}</b></span>
          <span>FREE <b className="text-white">{acct ? fmtUsd(acct.freeMarginUsd) : "—"}</b></span>
          <span>UTIL <b className={util > 65 ? "text-rose-400" : "text-white"}>{num(util)}%</b></span>
        </div>
        <div className="relative h-2 min-w-[140px] flex-1 overflow-visible rounded-full bg-[oklch(0.12_0.012_265)] border border-[var(--line)]">
          <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-amber-500" style={{ width: Math.min(100, util) + "%" }} />
          <div className="absolute -top-1 h-4 w-[2px] bg-rose-500" style={{ left: "65%" }} title="65% ceiling" />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            disabled={props.busy || halted}
            onClick={() => props.onSimulate()}
            className="rounded-xl bg-white px-3.5 py-1.5 mono text-xs font-bold uppercase tracking-wider text-zinc-950 hover:bg-zinc-200 disabled:opacity-40 transition-colors cursor-pointer"
          >
            Simulate Catalyst
          </button>
          <button
            disabled={props.busy || halted}
            onClick={props.onVetoProbe}
            className="rounded-xl border border-[var(--line)] bg-[oklch(0.20_0.015_265)] px-3.5 py-1.5 mono text-xs text-zinc-200 hover:border-amber-400 hover:text-white disabled:opacity-40 transition-colors cursor-pointer"
          >
            Probe Risk Veto
          </button>
          <button
            disabled={props.busy}
            onClick={props.onHalt}
            className={`rounded-xl border px-3.5 py-1.5 mono text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${
              halted
                ? "border-rose-500 bg-rose-600 text-white"
                : "border-rose-500/40 bg-rose-950/40 text-rose-300 hover:bg-rose-900/50"
            }`}
          >
            {halted ? "Resume" : "Emergency Halt"}
          </button>
        </div>
      </div>
      {props.error && (
        <div className="mx-auto max-w-6xl px-6 pb-2.5">
          <p className="mono text-xs text-rose-400 flex items-center gap-1.5">
            <span>⚠</span>
            <span>{props.error}</span>
            <span className="text-[var(--text-muted)] text-[11px] ml-2">(Mutating commands require local operator session; use Council Sandbox below for public tunnel testing)</span>
          </p>
        </div>
      )}
    </div>
  );
}

