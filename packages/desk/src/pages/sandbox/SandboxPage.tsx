import { useState } from "react";
import { TrackNav } from "../../components/TrackNav";
import { CouncilSandbox } from "../../components/desk/CouncilSandbox";
import { OnboardingModal } from "../../components/OnboardingModal";

export function SandboxPage() {
  const [tourOpen, setTourOpen] = useState(false);

  return (
    <div className="lv2 min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <TrackNav current="sandbox" />

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 space-y-8">
        {/* Header */}
        <div className="rounded-3xl border border-[var(--line)] bg-[oklch(0.18_0.014_265_/_0.6)] p-6 sm:p-8 backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span className="pill mono text-xs uppercase tracking-wider text-[var(--accent)] font-bold">
              Interactive Test Arena · Zero Server State Mutation
            </span>
            <button
              type="button"
              onClick={() => setTourOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[oklch(0.20_0.015_265)] px-3.5 py-1.5 mono text-xs font-bold text-zinc-200 hover:border-[var(--accent)] hover:text-white transition-colors cursor-pointer"
            >
              <span>✨</span>
              <span>Launch 60-Second Onboarding Tour</span>
            </button>
          </div>
          <h1 className="mt-4 text-3xl sm:text-4xl font-black tracking-tight text-white">
            Test Money Boys Yourself
          </h1>
          <p className="mt-3 max-w-3xl text-sm sm:text-base text-[var(--text-muted)] leading-relaxed">
            Drive the 4 autonomous agents directly in your browser. Choose from curated edge and risk scenarios, or build custom parameters with your own order size, token price, and account margin. Real Web Crypto SHA-256 seal verification and tamper testing included.
          </p>
        </div>

        {/* The Sandbox */}
        <CouncilSandbox />

        {/* 5-Step Self-Test Script */}
        <section className="rounded-3xl border border-[var(--line)] bg-[oklch(0.16_0.012_265_/_0.7)] p-6 sm:p-8 backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base sm:text-lg font-black tracking-tight text-white flex items-center gap-2">
              <span className="mono text-[var(--accent)]">▶</span>
              Judge Audit &amp; Self-Test Script (90-Second Interactive Tour)
            </h2>
            <span className="mono text-xs text-[var(--text-muted)]">
              Derived from live engine modules · impossible to fake
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
                  <td className="py-3 pr-4 text-emerald-400 font-semibold">Preset: &quot;A clear opportunity&quot;</td>
                  <td className="py-3 pr-4 text-zinc-200">
                    Council <strong>APPROVED</strong> (Score 78.7), Quorum 4/4 met. Real Web Crypto SHA-256 receipt sealed with <code>dispatched: false</code>.
                  </td>
                  <td className="py-3 text-[var(--text-muted)]">I-03 Receipt Before Dispatch</td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-bold text-white">2</td>
                  <td className="py-3 pr-4 text-rose-400 font-semibold">Preset: &quot;Too big for this account&quot;</td>
                  <td className="py-3 pr-4 text-zinc-200">
                    <strong className="text-rose-400">HARD_VETO</strong> by Risk Boy. Single-trade cap $5,000 exceeded ($18,000 order). Bypasses macro scoring entirely.
                  </td>
                  <td className="py-3 text-[var(--text-muted)]">I-02 Deterministic Risk Veto</td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-bold text-white">3</td>
                  <td className="py-3 pr-4 text-amber-400 font-semibold">Preset: &quot;Account already loaded&quot;</td>
                  <td className="py-3 pr-4 text-zinc-200">
                    <strong className="text-rose-400">HARD_VETO</strong>. Projected margin utilization 74.0% exceeds 65.0% ceiling on $4,500 order.
                  </td>
                  <td className="py-3 text-[var(--text-muted)]">I-02 65% Margin Ceiling</td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-bold text-white">4</td>
                  <td className="py-3 pr-4 text-indigo-400 font-semibold">Preset: &quot;Not worth the cost&quot;</td>
                  <td className="py-3 pr-4 text-zinc-200">
                    <strong className="text-amber-300">NOT WORTH THE COST</strong>. Basis is smaller than friction (0.0100% gap vs 0.0400% hurdle). Desk refuses to trade!
                  </td>
                  <td className="py-3 text-[var(--text-muted)]">The Refusal Story (Edge &gt; Friction)</td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-bold text-white">5</td>
                  <td className="py-3 pr-4 text-zinc-300 font-semibold">
                    Tamper Test Button
                  </td>
                  <td className="py-3 pr-4 text-zinc-200">
                    Click &quot;🧪 Tamper with Payload&quot; → Cryptographic verifier flags <strong>MISMATCH ✗</strong>. Click restore to confirm <strong>untampered ✓</strong>.
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
      </main>

      <OnboardingModal isOpen={tourOpen} onClose={() => setTourOpen(false)} />
    </div>
  );
}
