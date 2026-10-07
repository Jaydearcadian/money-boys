import { TrackNav } from "../../components/TrackNav";

export function Track2Page() {
  return (
    <div className="lv2 min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <TrackNav current="track2" />

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {/* Track header & rubric alignment banner */}
        <div className="rounded-3xl border border-[var(--line)] bg-[oklch(0.18_0.014_265_/_0.6)] p-6 sm:p-8 backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span className="pill mono text-xs uppercase tracking-wider text-[var(--warn)] font-bold">
              Track 2 · 50/50 Strategy &amp; Autonomous Agent Execution
            </span>
            <span className="mono text-xs text-[var(--text-muted)]">
              Scoring Rubric: Event &rarr; Decision &rarr; Execution &middot; Risk Isolation &middot; Venue Proof
            </span>
          </div>

          <h1 className="mt-4 text-3xl sm:text-4xl font-black tracking-tight text-white">
            Three-Beat Event &rarr; Decision &rarr; Execution Pipeline
          </h1>
          <p className="mt-3 max-w-3xl text-sm sm:text-base text-[var(--text-muted)] leading-relaxed">
            Judges evaluate agentic desks on how cleanly they separate cognitive intelligence from deterministic execution authority. Money Boys enforces strict architectural invariants: the LLM proposes only, deterministic risk gates veto without LLM override, and cryptographic receipts seal every action before dispatch.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3 pt-6 border-t border-[var(--line)]">
            <div className="flex items-start gap-2.5 text-xs">
              <span className="text-[var(--accent)] text-base leading-none">✔</span>
              <div>
                <strong className="text-white block">Invariant I-01: Zero Direct LLM Keys</strong>
                <span className="text-[var(--text-muted)]">Macro Boy proposes only; holds no Bitget API credentials</span>
              </div>
            </div>
            <div className="flex items-start gap-2.5 text-xs">
              <span className="text-[var(--accent)] text-base leading-none">✔</span>
              <div>
                <strong className="text-white block">Invariant I-02: Deterministic HARD_VETO</strong>
                <span className="text-[var(--text-muted)]">&gt;65% margin util or &gt;$5k single trade triggers hard circuit break</span>
              </div>
            </div>
            <div className="flex items-start gap-2.5 text-xs">
              <span className="text-[var(--accent)] text-base leading-none">✔</span>
              <div>
                <strong className="text-white block">Invariant I-03: Pre-Dispatch SHA-256 Seal</strong>
                <span className="text-[var(--text-muted)]">ReasoningReceipt sealed before network call is dispatched</span>
              </div>
            </div>
          </div>
        </div>

        {/* PRIMARY VISUAL: Three-Beat Vertical Timeline */}
        <section className="mt-10 rounded-3xl border border-[var(--line)] bg-[oklch(0.18_0.014_265_/_0.4)] p-6 sm:p-8">
          <div className="border-b border-[var(--line)] pb-5">
            <span className="mono text-xs uppercase tracking-wider text-[var(--accent)]">Execution Architecture</span>
            <h2 className="text-xl sm:text-2xl font-bold text-white mt-1">The Three-Beat Timeline</h2>
            <p className="text-xs sm:text-sm text-[var(--text-muted)] mt-2">
              Trace a single trade from unstructured market catalyst to Bitget private venue execution. Notice the immutable cryptographic receipt materializing at each beat.
            </p>
          </div>

          <div className="mt-8 space-y-8 relative before:absolute before:inset-0 before:left-5 sm:before:left-8 before:w-0.5 before:bg-[var(--line)]">
            {/* BEAT 1: Catalyst Ingestion & LLM Proposal */}
            <div className="relative flex items-start gap-4 sm:gap-6">
              <div className="flex h-10 w-10 sm:h-16 sm:w-16 shrink-0 items-center justify-center rounded-2xl bg-[oklch(0.22_0.016_265)] border border-amber-500/40 text-amber-400 font-black text-sm sm:text-xl shadow-lg z-10">
                01
              </div>

              <div className="flex-1 rounded-2xl border border-[var(--line)] bg-[oklch(0.14_0.012_265)] p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-4">
                  <div>
                    <span className="pill mono text-xs uppercase text-amber-300 bg-amber-500/10 border-amber-500/30">
                      Beat 1 · Event Ingestion &amp; Advisory Thesis
                    </span>
                    <h3 className="text-lg font-bold text-white mt-1">Macro Boy (Qwen-3.8-Max via DashScope)</h3>
                  </div>

                  {/* HUGE DISPATCHED: FALSE BADGE */}
                  <div className="rounded-xl border-2 border-amber-500 bg-amber-500/20 px-4 py-2 text-center animate-pulse">
                    <span className="block mono text-[10px] uppercase font-bold text-amber-300">Execution Status</span>
                    <span className="mono text-lg sm:text-xl font-black text-amber-400 tracking-wider">
                      dispatched: false
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2 text-xs">
                  <div>
                    <span className="mono text-[var(--text-muted)] uppercase block mb-1">Inputs &amp; Signals Ingested</span>
                    <ul className="space-y-1 text-zinc-300 mono bg-white/5 p-3 rounded-xl border border-[var(--line)]">
                      <li>&bull; Catalyst: TSMC CoWoS capacity expansion notice</li>
                      <li>&bull; Bitget Options Skew: +3.2&sigma; Call premium on NVDA</li>
                      <li>&bull; Volatility Regime: EXPANSION (VIX term spread elevated)</li>
                    </ul>
                  </div>

                  <div>
                    <span className="mono text-[var(--text-muted)] uppercase block mb-1">Generated Output (Proposal Only)</span>
                    <div className="p-3 rounded-xl border border-[var(--line)] bg-white/5 mono text-zinc-300">
                      <div className="text-white font-bold">&gt; action: &quot;SELL_BASIS&quot;</div>
                      <div>&gt; targetSymbol: &quot;rNVDAUSDT&quot;</div>
                      <div>&gt; proposedNotional: $1,300.00 (0.11 NVDA)</div>
                      <div className="text-amber-400 mt-1">&gt; authority: ADVISORY_ONLY (0% key access)</div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between rounded-xl bg-black/40 px-3 py-2 text-[11px] mono border border-white/5">
                  <span className="text-[var(--text-muted)]">Empirical Inference Latency: 10,548ms (Warm Path)</span>
                  <span className="text-amber-300 font-bold">I-01 HELD</span>
                </div>
              </div>
            </div>

            {/* BEAT 2: Council Deliberation & Risk Gate */}
            <div className="relative flex items-start gap-4 sm:gap-6">
              <div className="flex h-10 w-10 sm:h-16 sm:w-16 shrink-0 items-center justify-center rounded-2xl bg-[oklch(0.22_0.016_265)] border border-emerald-500/40 text-emerald-400 font-black text-sm sm:text-xl shadow-lg z-10">
                02
              </div>

              <div className="flex-1 rounded-2xl border border-[var(--line)] bg-[oklch(0.14_0.012_265)] p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-4">
                  <div>
                    <span className="pill mono text-xs uppercase text-emerald-300 bg-emerald-500/10 border-emerald-500/30">
                      Beat 2 · Quorum Gate &amp; Cryptographic Seal
                    </span>
                    <h3 className="text-lg font-bold text-white mt-1">Quant Boy + Deterministic Risk Boy</h3>
                  </div>

                  <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-center">
                    <span className="block mono text-[10px] uppercase font-bold text-emerald-300">Council Decision</span>
                    <span className="mono text-base sm:text-lg font-black text-emerald-400 tracking-wider">
                      APPROVED (Quorum 4/4)
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2 text-xs">
                  <div>
                    <span className="mono text-[var(--text-muted)] uppercase block mb-1">Quant Boy Orderbook Depth Walk</span>
                    <ul className="space-y-1 text-zinc-300 mono bg-white/5 p-3 rounded-xl border border-[var(--line)]">
                      <li>&bull; Depth Walk: 100 bids / 100 asks ($66,282 available)</li>
                      <li>&bull; VWAP Slippage: 0.02% (Depth coverage 100%)</li>
                      <li>&bull; Hurdle Rate: 0.15% &rarr; Net Edge: <strong className="text-emerald-400">+2.89%</strong></li>
                    </ul>
                  </div>

                  <div>
                    <span className="mono text-[var(--text-muted)] uppercase block mb-1">Risk Boy Deterministic Guardrails</span>
                    <ul className="space-y-1 text-zinc-300 mono bg-white/5 p-3 rounded-xl border border-[var(--line)]">
                      <li>&bull; Projected Margin Util: 31% &lt; <strong className="text-white">65% Hard Ceiling</strong></li>
                      <li>&bull; Trade Blast Radius: $1,300 &lt; <strong className="text-white">$5,000 Cap</strong></li>
                      <li>&bull; Liquidation Distance: $32.50 (Adequate buffer)</li>
                    </ul>
                  </div>
                </div>

                {/* Sealed ReasoningReceipt callout */}
                <div className="mt-4 rounded-xl border border-[var(--accent)] bg-emerald-500/10 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="mono font-bold text-white flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
                      ReasoningReceipt Sealed (Invariant I-03)
                    </span>
                    <span className="pill mono text-[10px] text-[var(--accent)]">100% Immutable</span>
                  </div>
                  <div className="mt-2 text-xs mono text-zinc-300 break-all bg-black/40 p-2 rounded-lg">
                    SHA-256 Digest: <span className="text-[var(--accent)]">16f2ecd5378818e8a6ae244e777f7790c7c0b9955699d069d4da5b01e9870fe9</span>
                  </div>
                </div>
              </div>
            </div>

            {/* BEAT 3: Venue Execution & Read-Back */}
            <div className="relative flex items-start gap-4 sm:gap-6">
              <div className="flex h-10 w-10 sm:h-16 sm:w-16 shrink-0 items-center justify-center rounded-2xl bg-[oklch(0.22_0.016_265)] border border-blue-500/40 text-blue-400 font-black text-sm sm:text-xl shadow-lg z-10">
                03
              </div>

              <div className="flex-1 rounded-2xl border border-[var(--line)] bg-[oklch(0.14_0.012_265)] p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-4">
                  <div>
                    <span className="pill mono text-xs uppercase text-blue-300 bg-blue-500/10 border-blue-500/30">
                      Beat 3 · Private Signed Venue Execution
                    </span>
                    <h3 className="text-lg font-bold text-white mt-1">Execution Boy (Bitget API v2 REST Client)</h3>
                  </div>

                  <div className="rounded-xl border border-blue-500/40 bg-blue-500/10 px-4 py-2 text-center">
                    <span className="block mono text-[10px] uppercase font-bold text-blue-300">Venue Status</span>
                    <span className="mono text-base sm:text-lg font-black text-blue-400 tracking-wider">
                      FILLED &amp; CONFIRMED
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2 text-xs">
                  <div>
                    <span className="mono text-[var(--text-muted)] uppercase block mb-1">Live Venue Round-Trip Fill</span>
                    <ul className="space-y-1 text-zinc-300 mono bg-white/5 p-3 rounded-xl border border-[var(--line)]">
                      <li>&bull; Open Order ID: <span className="text-white">1491434982630129665</span></li>
                      <li>&bull; Contract Fill: 0.11 NVDA @ $240.42</li>
                      <li>&bull; Close Order ID: <span className="text-white">1491434983930363905</span></li>
                      <li>&bull; Account Balance: <strong className="text-emerald-400">FLAT (0 positions)</strong></li>
                    </ul>
                  </div>

                  <div>
                    <span className="mono text-[var(--text-muted)] uppercase block mb-1">GAP-020 Resting Limit &amp; /detail Cancel</span>
                    <ul className="space-y-1 text-zinc-300 mono bg-white/5 p-3 rounded-xl border border-[var(--line)]">
                      <li>&bull; Resting Limit: <span className="text-white">1491458794516021249</span></li>
                      <li>&bull; /detail Read-Back: <span className="text-white font-bold">&quot;live&quot; (code 00000)</span></li>
                      <li>&bull; Cancel Dispatched: cancel-order accepted</li>
                      <li>&bull; /detail Read-Back: <span className="text-amber-400 font-bold">&quot;canceled&quot; (code 00000)</span></li>
                    </ul>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between rounded-xl bg-black/40 px-3 py-2 text-[11px] mono border border-white/5">
                  <span className="text-[var(--text-muted)]">Hot-Path Latency: 0.13ms (Target &lt;50ms)</span>
                  <span className="text-emerald-400 font-bold">100% RECONCILED ON VENUE</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
