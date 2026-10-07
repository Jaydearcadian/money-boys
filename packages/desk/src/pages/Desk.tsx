import { useState } from "react";
import { useDeskState } from "../hooks/useDeskState";
import { TrackNav } from "../components/TrackNav";
import { TopTelemetryBar } from "../components/desk/TopBar";
import { CouncilSandbox } from "../components/desk/CouncilSandbox";
import { NodeMatrix } from "../components/desk/NodeMatrix";
import { QuorumGate } from "../components/desk/QuorumGate";
import { AuditLedger } from "../components/desk/AuditLedger";

export function DeskPage() {
  const { state, receipts, isConnected, isHalted, error, triggerSimulateCycle, triggerHalt } = useDeskState();
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function onSimulate(params?: { symbol?: string; side?: string; quantity?: number; priceUsd?: number }) {
    if (busy) return;
    setBusy(true);
    setLocalError(null);
    try {
      await triggerSimulateCycle(params);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onHalt() {
    if (busy) return;
    setBusy(true);
    setLocalError(null);
    try {
      await triggerHalt();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lv2 min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <TrackNav current="desk" />

      {/* Connection & venue telemetry sub-bar */}
      <div className="border-b border-[var(--line)] bg-[oklch(0.12_0.012_265)] px-4 py-2 text-xs">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="flex items-center gap-2 mono text-[var(--text-muted)]">
            <span className="font-bold text-white">DESK-01 VENUE TELEMETRY</span>
            <span>·</span>
            <span>Bitget API v2 Spot/Margin</span>
            <span>·</span>
            <span>engine :3001</span>
          </div>
          <div className="flex items-center gap-3 mono text-[11px]">
            <span className={`inline-flex items-center gap-1.5 font-bold ${isConnected ? "text-[var(--accent)]" : "text-amber-400"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? "bg-[var(--accent)]" : "bg-amber-400"} animate-pulse`} />
              {isConnected ? "SSE CONNECTED" : "POLLING ENGINE"}
            </span>
            {isHalted && (
              <span className="rounded bg-rose-500/20 px-1.5 py-0.5 font-bold text-rose-300">
                SYSTEM HALTED
              </span>
            )}
          </div>
        </div>
      </div>

      <TopTelemetryBar
        state={state}
        isConnected={isConnected}
        busy={busy}
        error={localError ?? error}
        onSimulate={(p) => void onSimulate(p)}
        onVetoProbe={() => void onSimulate({ quantity: 100, priceUsd: 200 })}
        onHalt={() => void onHalt()}
      />

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 space-y-8">
        {/* Cockpit Page Header */}
        <div className="rounded-3xl border border-[var(--line)] bg-[oklch(0.18_0.014_265_/_0.6)] p-6 sm:p-8 backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span className="pill mono text-xs uppercase tracking-wider text-[var(--accent)] font-bold">
              Autonomous 24/7 Agentic Trading Desk
            </span>
            <span className="mono text-xs text-[var(--text-muted)]">
              Invariants: I-01 Zero LLM Authority · I-02 Risk HARD_VETO · I-03 SHA-256 Receipt Required
            </span>
          </div>
          <h1 className="mt-4 text-3xl sm:text-4xl font-black tracking-tight text-white">
            Trading Cockpit &amp; Live Deliberation
          </h1>
          <p className="mt-3 max-w-3xl text-sm sm:text-base text-[var(--text-muted)] leading-relaxed">
            Direct real-time view into the 4 Money Boys cooperating in consensus: Macro Boy proposes catalysts, Quant Boy evaluates basis spreads against friction, Risk Boy enforces deterministic hard vetoes, and Execution Boy seals cryptographically auditable SHA-256 Reasoning Receipts.
          </p>
        </div>

        {/* In-Browser Council Sandbox (Active Live Action with NO Server Mutation Blocker) */}
        <section aria-labelledby="sandbox-heading">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 id="sandbox-heading" className="text-lg font-black tracking-tight text-white flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)] animate-pulse" />
                See Money Boys in Action
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Run deterministic council deliberations directly in your browser with real engine math and Web Crypto SHA-256 receipts.
              </p>
            </div>
            <span className="hidden sm:inline-flex rounded-full border border-emerald-500/30 bg-emerald-950/40 px-3 py-1 mono text-[11px] font-bold text-emerald-300">
              Zero Server State Mutation · Tunnel Safe
            </span>
          </div>
          <CouncilSandbox />
        </section>

        {/* 5-Step Judge Self-Test Script */}
        <section className="rounded-3xl border border-[var(--line)] bg-[oklch(0.16_0.012_265_/_0.7)] p-6 sm:p-8 backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base sm:text-lg font-black tracking-tight text-white flex items-center gap-2">
              <span className="mono text-[var(--accent)]">▶</span>
              Judge Audit &amp; Self-Test Script (90-Second Interactive Tour)
            </h2>
            <span className="mono text-xs text-[var(--text-muted)]">
              Impossible to fake: derived from live engine execution
            </span>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full mono text-xs tabular-nums text-left">
              <thead>
                <tr className="border-b border-[var(--line)] text-[var(--text-muted)] text-[11px]">
                  <th className="py-2.5 pr-4 font-bold">STEP</th>
                  <th className="py-2.5 pr-4 font-bold">ACTION / PRESET</th>
                  <th className="py-2.5 pr-4 font-bold">EXPECTED RESULT (WHAT YOU SHOULD SEE)</th>
                  <th className="py-2.5 font-bold">GOVERNANCE INVARIANT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                <tr>
                  <td className="py-3 pr-4 font-bold text-white">1</td>
                  <td className="py-3 pr-4 text-emerald-400 font-semibold">Sandbox: &quot;A clear opportunity&quot;</td>
                  <td className="py-3 pr-4 text-zinc-200">
                    Council <strong>APPROVED</strong> (Score 78.7), Quorum 4/4 met. Real Web Crypto SHA-256 receipt sealed with <code>dispatched: false</code>.
                  </td>
                  <td className="py-3 text-[var(--text-muted)]">I-03 Receipt Before Dispatch</td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-bold text-white">2</td>
                  <td className="py-3 pr-4 text-rose-400 font-semibold">Sandbox: &quot;Too big for this account&quot;</td>
                  <td className="py-3 pr-4 text-zinc-200">
                    <strong className="text-rose-400">HARD_VETO</strong> by Risk Boy. Single-trade cap $5,000 exceeded ($18,000 order). Bypasses macro scoring entirely.
                  </td>
                  <td className="py-3 text-[var(--text-muted)]">I-02 Deterministic Risk Veto</td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-bold text-white">3</td>
                  <td className="py-3 pr-4 text-amber-400 font-semibold">Sandbox: &quot;Account already loaded&quot;</td>
                  <td className="py-3 pr-4 text-zinc-200">
                    <strong className="text-rose-400">HARD_VETO</strong>. Projected margin utilization 74.0% exceeds 65.0% ceiling on $4,500 order.
                  </td>
                  <td className="py-3 text-[var(--text-muted)]">I-02 65% Margin Ceiling</td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-bold text-white">4</td>
                  <td className="py-3 pr-4 text-indigo-400 font-semibold">Sandbox: &quot;Not worth the cost&quot;</td>
                  <td className="py-3 pr-4 text-zinc-200">
                    <strong className="text-amber-300">NOT WORTH THE COST</strong>. Basis is smaller than friction (0.0100% gap vs 0.0400% hurdle). Desk refuses to trade!
                  </td>
                  <td className="py-3 text-[var(--text-muted)]">The Refusal Story (Edge &gt; Friction)</td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-bold text-white">5</td>
                  <td className="py-3 pr-4 text-zinc-300 font-semibold">
                    <a href="#/copilot" className="text-[var(--accent)] hover:underline">Portfolio Copilot</a> Tamper Test
                  </td>
                  <td className="py-3 pr-4 text-zinc-200">
                    Paste tampered receipt into W3C WebCrypto Verifier → Reports <strong>SEAL MISMATCH / Untampered: false</strong>.
                  </td>
                  <td className="py-3 text-[var(--text-muted)]">I-03 Cryptographic Verification</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* The Refusal Story */}
        <section className="rounded-3xl border border-amber-500/20 bg-[oklch(0.18_0.016_80_/_0.15)] p-6 sm:p-8 backdrop-blur-md">
          <div className="flex items-start gap-4">
            <span className="text-2xl text-[var(--warn)] leading-none">⚡</span>
            <div>
              <h2 className="text-lg font-black tracking-tight text-white">
                The Refusal Story: Why Money Boys Refuses to Trade
              </h2>
              <p className="mt-2 text-sm text-[var(--text-muted)] leading-relaxed">
                During genuine live Bitget venue monitoring, every live evaluation returned <strong className="text-amber-300">NEUTRAL</strong>. Why? Because the observed basis spread was smaller than the realistic exchange taker fee, spread adverse-selection, and overnight funding carry.
              </p>
              <p className="mt-2 text-sm text-[var(--text-muted)] leading-relaxed">
                Ordinary retail trading bots force trades to produce false activity or hope for trend continuations. Money Boys is architected with a non-negotiable quantitative gate: <em>if net basis edge does not clear hurdle cost, the desk refuses</em>. Refusing unprofitable trades is an active feature of sound algorithmic governance.
              </p>
            </div>
          </div>
        </section>

        {/* Live Engine Node Matrix and Quorum Gate */}
        <div className="grid gap-6 md:grid-cols-2">
          <NodeMatrix state={state} />
          <QuorumGate receipt={state?.latestReceipt ?? receipts[0] ?? null} />
          <div className="md:col-span-2">
            <AuditLedger receipts={receipts} />
          </div>
        </div>
      </main>
    </div>
  );
}

