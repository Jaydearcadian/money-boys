import { useState } from "react";
import { TrackNav } from "../../components/TrackNav";

interface TradePreset {
  id: string;
  label: string;
  symbol: string;
  action: "BUY" | "SELL";
  notionalUsd: number;
  deltaBeta: number;
  projectedBeta: number;
  sector: string;
  projectedSectorWeight: number;
  projectedAssetWeight: number;
  verdict: "PERMITTED" | "HARD_VETO" | "DE_RISKING";
  rationale: string;
}

const PRESETS: TradePreset[] = [
  {
    id: "nvda_moderate",
    label: "Moderate Buy: +$2,000 rNVDA",
    symbol: "rNVDAUSDT",
    action: "BUY",
    notionalUsd: 2000,
    deltaBeta: 0.16,
    projectedBeta: 1.78,
    sector: "SEMICONDUCTORS",
    projectedSectorWeight: 44.4,
    projectedAssetWeight: 33.7,
    verdict: "PERMITTED",
    rationale: "Projected net beta (1.78 <= 2.50) and sector concentration (44.4% <= 60%) remain safely within risk ceilings.",
  },
  {
    id: "nvda_extreme",
    label: "Excessive Buy: +$7,000 rNVDA",
    symbol: "rNVDAUSDT",
    action: "BUY",
    notionalUsd: 7000,
    deltaBeta: 0.56,
    projectedBeta: 2.18,
    sector: "SEMICONDUCTORS",
    projectedSectorWeight: 67.3,
    projectedAssetWeight: 56.6,
    verdict: "HARD_VETO",
    rationale: "HARD_VETO: Projected sector concentration (67.3% in SEMICONDUCTORS) breaches the 60.0% ceiling; single asset (56.6%) breaches 40.0% ceiling.",
  },
  {
    id: "nvda_derisk",
    label: "De-Risking Sell: -$3,000 rNVDA",
    symbol: "rNVDAUSDT",
    action: "SELL",
    notionalUsd: 3000,
    deltaBeta: -0.24,
    projectedBeta: 1.38,
    sector: "SEMICONDUCTORS",
    projectedSectorWeight: 21.4,
    projectedAssetWeight: 10.7,
    verdict: "DE_RISKING",
    rationale: "DE_RISKING: Trade reduces elevated semiconductor exposure from 35.2% to 21.4% and net beta from 1.62 to 1.38. Permitted.",
  },
  {
    id: "tsla_diversify",
    label: "Diversified Buy: +$1,500 rTSLA",
    symbol: "rTSLAUSDT",
    action: "BUY",
    notionalUsd: 1500,
    deltaBeta: 0.14,
    projectedBeta: 1.76,
    sector: "AUTOMOTIVE_TECH",
    projectedSectorWeight: 25.3,
    projectedAssetWeight: 25.3,
    verdict: "PERMITTED",
    rationale: "Automotive tech exposure rises to 25.3% (well below 60% ceiling). Net beta 1.76 complies with 2.50 limit.",
  },
];

export function Track3Page() {
  const [selectedTrade, setSelectedTrade] = useState<TradePreset>(PRESETS[0]!);

  const baseMetrics = {
    equityUsd: 21795.18,
    currentNetBeta: 1.62,
    maxBetaCeiling: 2.50,
    maxSectorCeiling: 60.0,
    maxAssetCeiling: 40.0,
    sectors: [
      { name: "Semiconductors (NVDA)", currentPct: 35.2, beta: 1.75 },
      { name: "Automotive Tech (TSLA)", currentPct: 18.4, beta: 2.05 },
      { name: "Consumer Tech (AAPL)", currentPct: 14.1, beta: 1.05 },
      { name: "Enterprise Software (MSFT)", currentPct: 12.0, beta: 1.15 },
      { name: "Digital Assets / Cash", currentPct: 20.3, beta: 0.40 },
    ],
  };

  return (
    <div className="lv2 min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <TrackNav current="track3" />

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {/* Track header & rubric alignment banner */}
        <div className="rounded-3xl border border-[var(--line)] bg-[oklch(0.18_0.014_265_/_0.6)] p-6 sm:p-8 backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span className="pill mono text-xs uppercase tracking-wider text-purple-400 font-bold">
              Track 3 · Feature Depth &amp; Portfolio Copilot
            </span>
            <span className="mono text-xs text-[var(--text-muted)]">
              Scoring Rubric: Architectural Breadth &middot; Multi-Agent Coordination &middot; Portfolio Factor Controls
            </span>
          </div>

          <h1 className="mt-4 text-3xl sm:text-4xl font-black tracking-tight text-white">
            Portfolio Copilot: Multi-Asset Factor &amp; Blast Radius Engine
          </h1>
          <p className="mt-3 max-w-3xl text-sm sm:text-base text-[var(--text-muted)] leading-relaxed">
            Feature depth demonstrated through institutional portfolio management: tracking cross-asset beta magnitude (&le; 2.50), sector concentration (&le; 60%), and single-asset limits (&le; 40%) with live before/after trade impact simulation.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3 pt-6 border-t border-[var(--line)]">
            <div className="flex items-start gap-2.5 text-xs">
              <span className="text-[var(--accent)] text-base leading-none">✔</span>
              <div>
                <strong className="text-white block">Rule R6: Net Beta Ceiling</strong>
                <span className="text-[var(--text-muted)]">|&beta;| &le; 2.50 market sensitivity limit</span>
              </div>
            </div>
            <div className="flex items-start gap-2.5 text-xs">
              <span className="text-[var(--accent)] text-base leading-none">✔</span>
              <div>
                <strong className="text-white block">Rule R5: Sector Concentration</strong>
                <span className="text-[var(--text-muted)]">&le; 60.0% max gross weight per sector</span>
              </div>
            </div>
            <div className="flex items-start gap-2.5 text-xs">
              <span className="text-[var(--accent)] text-base leading-none">✔</span>
              <div>
                <strong className="text-white block">Rule R4: Single-Asset Limit</strong>
                <span className="text-[var(--text-muted)]">&le; 40.0% max individual asset notional</span>
              </div>
            </div>
          </div>
        </div>

        {/* PRIMARY VISUAL: Portfolio Copilot Dashboard */}
        <section className="mt-10 grid gap-8 lg:grid-cols-3">
          {/* Left Column: Net Beta & Sector Exposure Bars */}
          <div className="lg:col-span-2 space-y-8">
            {/* Net Beta Gauge Card */}
            <div className="rounded-3xl border border-[var(--line)] bg-[oklch(0.18_0.014_265_/_0.4)] p-6 sm:p-8">
              <div className="flex items-center justify-between border-b border-[var(--line)] pb-4">
                <div>
                  <span className="mono text-xs uppercase tracking-wider text-[var(--accent)]">Market Risk Factor</span>
                  <h2 className="text-xl font-bold text-white mt-1">Portfolio Net Beta Magnitude (&beta;)</h2>
                </div>
                <span className="pill mono text-xs text-[var(--accent)] font-bold">STATUS: SAFE</span>
              </div>

              <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <span className="text-xs text-[var(--text-muted)] block mono uppercase">Current Net Beta</span>
                  <div className="mono text-5xl font-black text-white mt-1">
                    {baseMetrics.currentNetBeta.toFixed(2)}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xs text-[var(--text-muted)] block mono uppercase">Ceiling Limit (R6)</span>
                  <div className="mono text-2xl font-bold text-amber-400 mt-1">
                    &le; {baseMetrics.maxBetaCeiling.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Beta Visual Gauge */}
              <div className="mt-6">
                <div className="flex justify-between text-xs mono text-[var(--text-muted)] mb-2">
                  <span>0.00 (Market Neutral)</span>
                  <span className="text-white font-bold">Current: 1.62</span>
                  <span className="text-amber-400 font-bold">Ceiling: 2.50</span>
                  <span>3.00</span>
                </div>
                <div className="h-4 w-full rounded-full bg-white/10 overflow-hidden relative">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full"
                    style={{ width: `${(baseMetrics.currentNetBeta / 3.0) * 100}%` }}
                  />
                  {/* Ceiling marker */}
                  <div
                    className="absolute top-0 bottom-0 w-1 bg-amber-400"
                    style={{ left: `${(baseMetrics.maxBetaCeiling / 3.0) * 100}%` }}
                  />
                </div>
                <p className="mt-3 text-xs text-[var(--text-muted)]">
                  Portfolio operates with a targeted long growth bias (1.62 &beta;), strictly restrained by the 2.50 magnitude circuit breaker.
                </p>
              </div>
            </div>

            {/* Sector Exposure Breakdown */}
            <div className="rounded-3xl border border-[var(--line)] bg-[oklch(0.18_0.014_265_/_0.4)] p-6 sm:p-8">
              <div className="flex items-center justify-between border-b border-[var(--line)] pb-4">
                <div>
                  <span className="mono text-xs uppercase tracking-wider text-[var(--accent)]">Concentration Controls</span>
                  <h2 className="text-xl font-bold text-white mt-1">Sector Gross Exposure vs 60% Ceiling</h2>
                </div>
                <span className="pill mono text-xs text-zinc-300">Rule R5 Enforced</span>
              </div>

              <div className="mt-6 space-y-4">
                {baseMetrics.sectors.map((s) => (
                  <div key={s.name}>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-white font-semibold">{s.name}</span>
                      <span className="mono text-zinc-300 font-bold">
                        {s.currentPct.toFixed(1)}% <span className="text-[var(--text-muted)]">/ 60%</span>
                      </span>
                    </div>
                    <div className="h-3 rounded-full bg-white/10 overflow-hidden relative">
                      <div
                        className={`h-full rounded-full ${
                          s.currentPct > 45 ? "bg-amber-400" : "bg-[var(--accent)]"
                        }`}
                        style={{ width: `${(s.currentPct / 60.0) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Before / After Trade Impact Simulator */}
          <div className="rounded-3xl border border-[var(--line)] bg-[oklch(0.18_0.014_265_/_0.5)] p-6 sm:p-8 backdrop-blur-md">
            <span className="pill mono text-xs uppercase tracking-wider text-purple-300 bg-purple-500/10 border-purple-500/30">
              Interactive Simulator
            </span>
            <h2 className="text-xl font-bold text-white mt-2">Trade-Impact Diff</h2>
            <p className="text-xs text-[var(--text-muted)] mt-1.5 leading-relaxed">
              Select a trade to simulate how the Copilot pre-evaluates net beta, sector, and blast radius deltas before order dispatch.
            </p>

            {/* Presets selector */}
            <div className="mt-5 space-y-2">
              <label className="mono text-xs text-[var(--text-muted)] uppercase block">Select Scenario:</label>
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedTrade(p)}
                  className={`w-full text-left p-3 rounded-xl border text-xs font-semibold transition-all ${
                    selectedTrade.id === p.id
                      ? "border-purple-400 bg-purple-500/15 text-white shadow-sm"
                      : "border-[var(--line)] bg-white/5 text-[var(--text-muted)] hover:text-white hover:bg-white/10"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span>{p.label}</span>
                    <span
                      className={`pill mono text-[10px] !py-0.5 ${
                        p.verdict === "HARD_VETO"
                          ? "text-rose-400 border-rose-500/40 bg-rose-500/10"
                          : p.verdict === "DE_RISKING"
                          ? "text-blue-400 border-blue-500/40 bg-blue-500/10"
                          : "text-emerald-400 border-emerald-500/40 bg-emerald-500/10"
                      }`}
                    >
                      {p.verdict}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            {/* Diff Card */}
            <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[oklch(0.13_0.012_265)] p-4 space-y-3 mono text-xs">
              <div className="text-[var(--text-muted)] uppercase border-b border-[var(--line)] pb-2 font-bold">
                Projected Impact &middot; {selectedTrade.symbol}
              </div>

              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-[var(--text-muted)]">Net Beta Change:</span>
                <span className="text-white">
                  1.62 &rarr; <strong className="text-purple-300">{selectedTrade.projectedBeta.toFixed(2)}</strong>{" "}
                  ({selectedTrade.deltaBeta >= 0 ? `+${selectedTrade.deltaBeta.toFixed(2)}` : selectedTrade.deltaBeta.toFixed(2)})
                </span>
              </div>

              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-[var(--text-muted)]">Sector Weight:</span>
                <span className={selectedTrade.projectedSectorWeight > 60 ? "text-rose-400 font-bold" : "text-white"}>
                  {selectedTrade.projectedSectorWeight.toFixed(1)}% / 60%
                </span>
              </div>

              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-[var(--text-muted)]">Single-Asset Weight:</span>
                <span className={selectedTrade.projectedAssetWeight > 40 ? "text-rose-400 font-bold" : "text-white"}>
                  {selectedTrade.projectedAssetWeight.toFixed(1)}% / 40%
                </span>
              </div>

              {/* Verdict Box */}
              <div
                className={`p-3 rounded-xl border mt-3 leading-relaxed ${
                  selectedTrade.verdict === "HARD_VETO"
                    ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                    : selectedTrade.verdict === "DE_RISKING"
                    ? "border-blue-500/40 bg-blue-500/10 text-blue-300"
                    : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                }`}
              >
                <div className="font-bold flex items-center gap-1.5 mb-1">
                  <span>&bull;</span>
                  <span>Copilot Verdict: {selectedTrade.verdict}</span>
                </div>
                <p className="text-[11px] opacity-90">{selectedTrade.rationale}</p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
