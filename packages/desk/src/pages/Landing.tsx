import { useState } from "react";
import { BasisTickerboard } from "../components/desk/Ticker";
import { Verifier } from "../components/desk/Verifier";
import type { SealedReasoningReceipt } from "../lib/api";
import {
  TerminalIcon,
  ShieldIcon,
  LightningIcon,
  BrainIcon,
  LockIcon,
  ActivityIcon,
  LayersIcon,
  ArrowRightIcon,
  CheckIcon,
  SparklesIcon,
} from "../components/icons";

interface LandingProps {
  latest: SealedReasoningReceipt | null;
}

export function LandingPage({ latest }: LandingProps) {
  const [heroView, setHeroView] = useState<"basis" | "risk">("basis");

  return (
    <div className="min-h-screen bg-canvas text-zinc-950 antialiased selection:bg-emerald-500 selection:text-white">
      {/* 1. TOP NAVIGATION */}
      <header role="banner" className="sticky top-0 z-50 border-b border-zinc-200/80 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <a href="#/" className="flex items-center gap-2 group">
              <span className="font-extrabold tracking-tight text-zinc-950 text-base sm:text-lg group-hover:text-emerald-600 transition-colors">
                MONEY BOYS
              </span>
              <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-zinc-600">
                DESK-01
              </span>
            </a>
            <span className="hidden lg:inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 font-mono text-[11px] text-zinc-500">
              Bitget AI Base Camp S2
            </span>
          </div>

          <nav aria-label="Main Navigation" className="hidden md:flex items-center gap-6 font-sans text-xs font-medium text-zinc-600">
            <a href="#basis-spreads" className="hover:text-zinc-950 transition-colors">Live Basis</a>
            <a href="#architecture" className="hover:text-zinc-950 transition-colors">Four Boys Quorum</a>
            <a href="#innovations" className="hover:text-zinc-950 transition-colors">Portfolio Copilot</a>
            <a href="#verifier" className="hover:text-zinc-950 transition-colors">Proof Verifier</a>
          </nav>

          <div className="flex items-center gap-2.5 sm:gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 sm:px-3 py-1 font-mono text-[10px] sm:text-xs font-semibold text-amber-800">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
              </span>
              <span className="hidden sm:inline">TRADFI CLOSED:</span> WEEKEND ARMED
            </span>
            <a
              href="#/desk"
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-3.5 sm:px-4 py-1.5 sm:py-2 text-xs font-semibold text-white shadow-sm transition-all duration-150 hover:bg-zinc-800 active:scale-95"
            >
              <TerminalIcon className="h-3.5 w-3.5 text-emerald-400" />
              <span>Cockpit</span>
              <ArrowRightIcon className="h-3 w-3 hidden sm:inline" />
            </a>
          </div>
        </div>
      </header>

      <main id="main-content" className="mx-auto max-w-7xl space-y-12 sm:space-y-16 px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        {/* 2. HERO SECTION (DARK OBSIDIAN LUXURY CONTAINER) */}
        <section aria-labelledby="hero-heading" className="relative rounded-[28px] sm:rounded-[36px] border border-white/[0.08] bg-obsidian-900 p-6 sm:p-10 lg:p-12 text-white shadow-2xl overflow-hidden bg-grid-mesh">
          {/* Ambient emerald radial glow */}
          <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-emerald-500/15 blur-[120px]" />
          <div className="pointer-events-none absolute -bottom-40 right-10 h-80 w-80 rounded-full bg-teal-500/10 blur-[100px]" />

          <div className="relative z-10 max-w-4xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[11px] font-semibold text-emerald-400 backdrop-blur-md">
              <SparklesIcon className="h-3 w-3" />
              <span>TWO-SPEED AGENTIC DESK // BITGET rTOKEN BASIS ARBITRAGE</span>
            </div>

            <h1 id="hero-heading" className="mt-4 text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.1]">
              Autonomous basis{" "}
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-300 to-white">
                where TradFi sleeps.
              </span>
            </h1>

            <p className="mt-5 max-w-2xl text-base sm:text-lg text-zinc-300 leading-relaxed font-normal">
              Sub-millisecond quantitative math paired with deterministic non-LLM risk guardrails and Qwen-driven catalyst extraction. Every trade decision is verified through 3-of-4 council quorum and sealed to an immutable SHA-256 receipt before order dispatch.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3 sm:gap-4">
              <a
                href="#/desk"
                className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3.5 text-xs sm:text-sm font-bold text-zinc-950 shadow-lg transition-all duration-200 hover:bg-zinc-100 hover:shadow-glow-emerald active:scale-95"
              >
                <TerminalIcon className="h-4 w-4 text-emerald-600" />
                <span>Enter Operator Cockpit</span>
                <ArrowRightIcon className="h-4 w-4" />
              </a>

              <a
                href="#verifier"
                className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-5 py-3.5 font-mono text-xs text-white backdrop-blur-md transition-all duration-200 hover:bg-white/10 active:scale-95"
              >
                <LockIcon className="h-3.5 w-3.5 text-emerald-400" />
                <span>Inspect Cryptographic Proof</span>
              </a>

              <a
                href="#/evidence"
                className="inline-flex items-center gap-2 rounded-full px-4 py-3.5 font-sans text-xs text-zinc-400 hover:text-white transition-colors"
              >
                <span>Evidence Vault (Pre-Flight)</span>
                <ArrowRightIcon className="h-3 w-3" />
              </a>
            </div>
          </div>

          {/* 3. HERO EMBEDDED COCKPIT MOCKUP (MONELIQ INSPIRED COCKPIT PREVIEW) */}
          <div className="relative z-10 mt-10 rounded-2xl border border-white/10 bg-obsidian-850/80 p-4 sm:p-6 backdrop-blur-xl shadow-2xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
              <div className="flex items-center gap-3">
                <span className="flex h-3 w-3 items-center justify-center">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                </span>
                <span className="font-mono text-xs font-semibold text-zinc-200">
                  OPERATOR TELEMETRY // BITGET V2 (DEMO & PAPER ENGINE)
                </span>
              </div>

              {/* View Toggle Pill */}
              <div role="tablist" aria-label="Cockpit Preview Mode" className="inline-flex rounded-full border border-white/10 bg-black/40 p-1">
                <button
                  role="tab"
                  aria-selected={heroView === "basis"}
                  onClick={() => setHeroView("basis")}
                  className={`rounded-full px-3.5 py-1 font-mono text-[11px] font-semibold transition-all duration-200 ${
                    heroView === "basis"
                      ? "bg-white text-zinc-950 shadow-sm"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  Live Basis View
                </button>
                <button
                  role="tab"
                  aria-selected={heroView === "risk"}
                  onClick={() => setHeroView("risk")}
                  className={`rounded-full px-3.5 py-1 font-mono text-[11px] font-semibold transition-all duration-200 ${
                    heroView === "risk"
                      ? "bg-white text-zinc-950 shadow-sm"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  Risk Guardrails
                </button>
              </div>
            </div>

            {heroView === "basis" ? (
              <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
                {/* Panel 1: Node Matrix */}
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-400">Agent Node Matrix</span>
                    <span className="font-mono text-[10px] text-emerald-400">4/4 ACTIVE</span>
                  </div>
                  <ul className="mt-3 space-y-2.5 font-mono text-xs">
                    <li className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-zinc-300">
                        <BrainIcon className="h-3.5 w-3.5 text-purple-400" />
                        Macro Boy (Qwen)
                      </span>
                      <span className="text-[11px] text-zinc-400">~1200ms · WARM</span>
                    </li>
                    <li className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-zinc-300">
                        <LightningIcon className="h-3.5 w-3.5 text-amber-400" />
                        Quant Boy (TS Math)
                      </span>
                      <span className="text-[11px] text-emerald-400">0.15ms · HOT</span>
                    </li>
                    <li className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-zinc-300">
                        <ShieldIcon className="h-3.5 w-3.5 text-rose-400" />
                        Risk Boy (iGraph)
                      </span>
                      <span className="text-[11px] text-rose-300">HARD_VETO</span>
                    </li>
                    <li className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-zinc-300">
                        <LockIcon className="h-3.5 w-3.5 text-cyan-400" />
                        Execution Boy (HMAC)
                      </span>
                      <span className="text-[11px] text-cyan-300">SHA-256 SEAL</span>
                    </li>
                  </ul>
                </div>

                {/* Panel 2: Opportunity Spread */}
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-400">Top Weekend Dislocation</span>
                    <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                      APPROVED
                    </span>
                  </div>
                  <div className="mt-3">
                    <div className="flex items-baseline justify-between">
                      <span className="font-bold text-lg text-white">rNVDAUSDT</span>
                      <span className="font-mono text-xs text-emerald-400 font-semibold">+2.14% Net Edge</span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-mono">
                      <div className="rounded bg-black/40 p-2">
                        <span className="block text-[10px] text-zinc-500">TOKEN MID</span>
                        <span className="font-bold text-zinc-200">$132.50</span>
                      </div>
                      <div className="rounded bg-black/40 p-2">
                        <span className="block text-[10px] text-zinc-500">MCP FRIDAY</span>
                        <span className="font-bold text-zinc-200">$128.80</span>
                      </div>
                    </div>
                    <div className="mt-2 text-[11px] font-mono text-zinc-400">
                      Raw Dislocation: <span className="text-zinc-200">+2.87%</span> · Hurdle: <span className="text-zinc-200">0.73%</span>
                    </div>
                  </div>
                </div>

                {/* Panel 3: Risk Summary */}
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-400">Blast Radius & Beta</span>
                    <span className="font-mono text-[10px] text-emerald-400">PASS (0 VETO)</span>
                  </div>
                  <div className="mt-3 space-y-2.5 font-mono text-xs">
                    <div>
                      <div className="flex justify-between text-[11px] text-zinc-300">
                        <span>Margin Utilization</span>
                        <span className="text-emerald-400 font-bold">18.4% / 65.0%</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: "28.3%" }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-[11px] text-zinc-300">
                        <span>Single-Asset Cap (R4)</span>
                        <span className="text-emerald-400 font-bold">14.2% / 40.0%</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: "35.5%" }} />
                      </div>
                    </div>
                    <div className="pt-1 flex items-center justify-between text-[11px]">
                      <span className="text-zinc-400">Net Portfolio Beta (R6)</span>
                      <span className="font-bold text-zinc-200">1.18 / 2.50 Limit</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-400 block border-b border-white/5 pb-2">
                    Charter Invariant I-01
                  </span>
                  <h4 className="mt-3 font-bold text-sm text-white">Zero Direct LLM Authority</h4>
                  <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
                    Macro Boy operates in proposal-only mode via strict Zod schema. It cannot sign orders or hold Bitget API keys.
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-400 block border-b border-white/5 pb-2">
                    Charter Invariant I-02
                  </span>
                  <h4 className="mt-3 font-bold text-sm text-white">Deterministic HARD_VETO</h4>
                  <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
                    Unilateral mathematical veto triggered instantly if margin &gt; 65%, single trade &gt; $5k, or free margin is insufficient.
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-400 block border-b border-white/5 pb-2">
                    Charter Invariant I-03
                  </span>
                  <h4 className="mt-3 font-bold text-sm text-white">SHA-256 Provenance Seal</h4>
                  <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
                    Order dispatch is structurally blocked unless a valid ReasoningReceipt exists, sealed with a verified SHA-256 cryptographic digest.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* 4. LIVE BASIS ARBITRAGE TICKERBOARD */}
        <div id="basis-spreads">
          <BasisTickerboard />
        </div>

        {/* 5. THE FOUR BOYS ARCHITECTURE GRID (SEPARATION OF POWERS) */}
        <section
          id="architecture"
          aria-labelledby="architecture-heading"
          className="rounded-[32px] border border-white/[0.08] bg-obsidian-900 p-6 sm:p-10 lg:p-12 text-white shadow-xl relative overflow-hidden bg-grid-mesh"
        >
          <div className="max-w-3xl">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[11px] font-semibold text-emerald-400">
              <LayersIcon className="h-3 w-3" />
              MULTI-AGENT CONSENSUS &amp; HARD BOUNDS
            </span>
            <h2 id="architecture-heading" className="mt-3 text-2xl sm:text-4xl font-extrabold tracking-tight">
              The Four Boys Architecture
            </h2>
            <p className="mt-2 text-sm sm:text-base text-zinc-400 leading-relaxed">
              Separation of powers between catalyst extraction, quantitative execution, deterministic safety, and cryptographic audit.
            </p>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Macro Boy */}
            <div className="group rounded-2xl border border-white/10 bg-white/[0.02] p-5 backdrop-blur-sm transition-all duration-200 hover:-translate-y-1 hover:border-purple-500/40 hover:bg-white/[0.04]">
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
                  <BrainIcon className="h-5 w-5" />
                </span>
                <span className="rounded-full border border-purple-500/20 bg-purple-500/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-purple-300">
                  WARM PATH
                </span>
              </div>
              <h3 className="mt-4 font-bold text-base text-white">Macro Boy</h3>
              <p className="mt-1 font-mono text-xs text-purple-300/80">qwen3.8-max · DashScope Gateway</p>
              <p className="mt-3 text-xs text-zinc-400 leading-relaxed">
                Extracts catalysts, weekend news, and guidance shocks. Proposes direction only through a strict Zod schema with SHA-256 evidence hashing.
              </p>
              <div className="mt-4 border-t border-white/5 pt-3 font-mono text-[11px] text-zinc-500">
                Latency: ~1200ms (Async)
              </div>
            </div>

            {/* Quant Boy */}
            <div className="group rounded-2xl border border-white/10 bg-white/[0.02] p-5 backdrop-blur-sm transition-all duration-200 hover:-translate-y-1 hover:border-amber-500/40 hover:bg-white/[0.04]">
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400">
                  <LightningIcon className="h-5 w-5" />
                </span>
                <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-amber-300">
                  HOT PATH
                </span>
              </div>
              <h3 className="mt-4 font-bold text-base text-white">Quant Boy</h3>
              <p className="mt-1 font-mono text-xs text-amber-300/80">Pure TypeScript · Zero-LLM</p>
              <p className="mt-3 text-xs text-zinc-400 leading-relaxed">
                Computes microsecond pricing math, orderbook VWAP slippage, 8-hour funding carry drag, and minimum executable net edge.
              </p>
              <div className="mt-4 border-t border-white/5 pt-3 font-mono text-[11px] text-emerald-400">
                Latency: 0.15ms measured
              </div>
            </div>

            {/* Risk Boy */}
            <div className="group rounded-2xl border border-white/10 bg-white/[0.02] p-5 backdrop-blur-sm transition-all duration-200 hover:-translate-y-1 hover:border-rose-500/40 hover:bg-white/[0.04]">
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10 text-rose-400">
                  <ShieldIcon className="h-5 w-5" />
                </span>
                <span className="rounded-full border border-rose-500/20 bg-rose-500/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-rose-300">
                  HARD VETO
                </span>
              </div>
              <h3 className="mt-4 font-bold text-base text-white">Risk Boy</h3>
              <p className="mt-1 font-mono text-xs text-rose-300/80">iGraph Structural Guard</p>
              <p className="mt-3 text-xs text-zinc-400 leading-relaxed">
                Unilateral deterministic veto authority. Hard-blocks any order breaching 65% margin util, $5,000 single-trade cap, or R4/R5/R6 beta limits.
              </p>
              <div className="mt-4 border-t border-white/5 pt-3 font-mono text-[11px] text-zinc-500">
                Latency: &lt;1ms (Sync)
              </div>
            </div>

            {/* Execution Boy */}
            <div className="group rounded-2xl border border-white/10 bg-white/[0.02] p-5 backdrop-blur-sm transition-all duration-200 hover:-translate-y-1 hover:border-cyan-500/40 hover:bg-white/[0.04]">
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
                  <LockIcon className="h-5 w-5" />
                </span>
                <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-cyan-300">
                  SEAL &amp; SIGN
                </span>
              </div>
              <h3 className="mt-4 font-bold text-base text-white">Execution Boy</h3>
              <p className="mt-1 font-mono text-xs text-cyan-300/80">Bitget v2 HMAC Dispatcher</p>
              <p className="mt-3 text-xs text-zinc-400 leading-relaxed">
                Sorts decision parameters canonical JSON lexicographically, computes the SHA-256 ReasoningReceipt, and signs the Bitget order payload.
              </p>
              <div className="mt-4 border-t border-white/5 pt-3 font-mono text-[11px] text-zinc-500">
                Proof: Immutable Hash
              </div>
            </div>
          </div>
        </section>

        {/* 6. DUAL TRACK INNOVATIONS BENTO GRID (TRACK 2 & TRACK 3) */}
        <section id="innovations" aria-labelledby="innovations-heading" className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-0.5 font-mono text-[11px] font-semibold text-zinc-600">
                EMPIRICAL RESEARCH &amp; VERIFICATION
              </span>
              <h2 id="innovations-heading" className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900">
                Track Innovations &amp; Safety Bounds
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-zinc-500 max-w-md">
              Demonstrated through strict quarantine protocols, historical market ingest, and automated test gates.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Bento Card 1: Track 2 A/B Deliberation */}
            <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 sm:p-8 shadow-sm transition-all duration-200 hover:shadow-md">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 font-mono text-xs font-bold text-emerald-700">
                  <CheckIcon className="h-3.5 w-3.5" />
                  TRACK 2 INNOVATION
                </span>
                <span className="font-mono text-xs text-zinc-400">ab-paper-runner.ts</span>
              </div>

              <h3 className="mt-4 text-xl font-bold text-zinc-900">
                Council vs. Unconstrained LLM Deliberation
              </h3>
              <p className="mt-2 text-sm text-zinc-600 leading-relaxed">
                Empirical comparative harness evaluating 4-Boy Council quorum against single-LLM execution. Demonstrates that structural non-LLM risk vetoes achieve 0% violation rates under conditions where single LLMs hallucinate high-leverage orders.
              </p>

              <div className="mt-6 rounded-2xl border border-zinc-100 bg-zinc-50 p-4 font-mono text-xs">
                <div className="flex justify-between py-1 border-b border-zinc-200/60">
                  <span className="text-zinc-500">Risk Violation Rate</span>
                  <span className="font-bold text-emerald-600">0.00% (Structurally Forced)</span>
                </div>
                <div className="flex justify-between py-1 border-b border-zinc-200/60">
                  <span className="text-zinc-500">Structural Hard Veto</span>
                  <span className="font-bold text-zinc-800">Pre-empts Both Arms</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-zinc-500">Evidence Integrity</span>
                  <span className="font-bold text-zinc-800">QUARANTINE.md / GAP-022</span>
                </div>
              </div>
            </div>

            {/* Bento Card 2: Track 3 Portfolio Copilot */}
            <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 sm:p-8 shadow-sm transition-all duration-200 hover:shadow-md">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 font-mono text-xs font-bold text-blue-700">
                  <ShieldIcon className="h-3.5 w-3.5" />
                  TRACK 3 COPILOT
                </span>
                <span className="font-mono text-xs text-zinc-400">portfolio-copilot.ts</span>
              </div>

              <h3 className="mt-4 text-xl font-bold text-zinc-900">
                Pre-Flight Capital &amp; Net Beta Guard
              </h3>
              <p className="mt-2 text-sm text-zinc-600 leading-relaxed">
                Integrated blast radius engine enforcing strict concentration caps before execution. Dynamically rejects trades that would over-concentrate single assets or sectors, with automatic de-risking rebalancer calculations.
              </p>

              <div className="mt-6 rounded-2xl border border-zinc-100 bg-zinc-50 p-4 font-mono text-xs">
                <div className="flex justify-between py-1 border-b border-zinc-200/60">
                  <span className="text-zinc-500">R4 Single-Asset Limit</span>
                  <span className="font-bold text-zinc-800">Max 40.0% Portfolio</span>
                </div>
                <div className="flex justify-between py-1 border-b border-zinc-200/60">
                  <span className="text-zinc-500">R5 Sector Concentration</span>
                  <span className="font-bold text-zinc-800">Max 60.0% (e.g. Tech)</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-zinc-500">R6 Net Portfolio Beta</span>
                  <span className="font-bold text-zinc-800">Max 2.50 Ceiling</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 7. CRYPTOGRAPHIC PROOF VERIFIER */}
        <Verifier receipt={latest} />
      </main>

      {/* 8. INSTITUTIONAL FOOTER */}
      <footer role="contentinfo" className="mt-16 border-t border-zinc-200 bg-white py-12 text-zinc-600">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
            <div className="space-y-3">
              <span className="font-extrabold tracking-tight text-zinc-950 text-base">
                MONEY BOYS // DESK-01
              </span>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Autonomous 24/7 Agentic Trading Desk for Tokenized US Equities on Bitget. Operating under the Money Boys Charter and Build Foundry standards.
              </p>
              <div className="font-mono text-[11px] text-zinc-400">
                HEAD 7712faa · 704/704 Passing
              </div>
            </div>

            <div>
              <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-900">Charter Invariants</h4>
              <ul className="mt-3 space-y-1.5 font-mono text-[11px] text-zinc-500">
                <li>I-01: Zero Direct LLM Authority</li>
                <li>I-02: Deterministic HARD_VETO</li>
                <li>I-03: SHA-256 ReasoningReceipt</li>
                <li>I-04: Hot Path &lt;50ms (0.15ms)</li>
                <li>I-05: Zero Framework Bloat</li>
              </ul>
            </div>

            <div>
              <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-900">Substrate &amp; Model</h4>
              <ul className="mt-3 space-y-1.5 text-xs text-zinc-500">
                <li>Exchange: Bitget API v2 (Spot / Margin)</li>
                <li>Contracts: Reality rTokens (24/7)</li>
                <li>LLM Gateway: DashScope native qwen3.8-max</li>
                <li>Cryptographic Engine: Web Crypto SubtleCrypto</li>
              </ul>
            </div>

            <div>
              <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-900">Operator Navigation</h4>
              <ul className="mt-3 space-y-2 text-xs">
                <li><a href="#/desk" className="font-semibold text-zinc-900 hover:text-emerald-600">Operator Cockpit →</a></li>
                <li><a href="#/evidence" className="text-zinc-600 hover:text-zinc-900">Evidence Vault (Pre-Flight)</a></li>
                <li><a href="#verifier" className="text-zinc-600 hover:text-zinc-900">Client-Side Receipt Verifier</a></li>
              </ul>
            </div>
          </div>

          <div className="mt-8 border-t border-zinc-100 pt-6 flex flex-col sm:flex-row items-center justify-between text-[11px] text-zinc-400">
            <p>Prime Directive: implemented ≠ verified · verified locally ≠ proven live · deployed ≠ working · documented ≠ true</p>
            <p className="mt-2 sm:mt-0 font-mono">Bitget AI Base Camp S2 · 2026</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
