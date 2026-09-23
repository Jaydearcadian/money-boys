import { BasisTickerboard } from "../components/desk/Ticker";
import { Verifier } from "../components/desk/Verifier";
import type { SealedReasoningReceipt } from "../lib/api";

export function LandingPage({ latest }: { latest: SealedReasoningReceipt | null }) {
  return (
    <div className="min-h-screen text-zinc-950" style={{ backgroundColor: "#FAF9F5" }}>
      <nav className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="font-bold tracking-tight">MONEY BOYS // DESK-01</span>
            <span className="rounded-full border border-zinc-200 px-2.5 py-0.5 font-mono text-xs text-zinc-600">Bitget AI Base Camp S2</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 font-mono text-xs text-orange-700">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-orange-500" />
              TRADFI CLOSED: WEEKEND SESSION ARMED
            </span>
            <a href="#/desk" className="bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">Launch Cockpit →</a>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-6xl space-y-8 px-6 py-10">
        <section>
          <p className="font-mono text-xs tracking-wider text-orange-600">TWO-SPEED AGENTIC DESK // BITGET rTOKEN BASIS ARBITRAGE</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-bold leading-tight tracking-tight">Autonomous Basis Arbitrage on Tokenized Equities with Cryptographically Sealed Provenance.</h1>
          <p className="mt-4 max-w-2xl text-zinc-600">Sub-millisecond execution math paired with non-LLM risk guardrails and Qwen-driven catalyst extraction. Every trade decision is verified through 3-of-4 council quorum and sealed to an immutable SHA-256 receipt before order dispatch.</p>
          <div className="mt-6 flex gap-3">
            <a href="#/desk" className="bg-zinc-950 px-6 py-3 text-sm font-medium text-white hover:bg-zinc-800">Enter Operator Cockpit</a>
            <a href="#verifier" className="border border-zinc-200 bg-white px-6 py-3 font-mono text-sm text-zinc-900">Inspect Verification Proof</a>
          </div>
        </section>

        <BasisTickerboard />

        <section className="grid gap-4 md:grid-cols-2">
          <div className="border border-zinc-200 bg-white p-6"><h3 className="text-xs font-bold uppercase tracking-widest text-orange-600">Warm Path — Macro Boy</h3><p className="mt-2 text-sm text-zinc-700">qwen3.8-max via Bitget Gateway + noema-qa strict Zod shield, SHA-256 evidenceHash, ~1200ms latency.</p></div>
          <div className="border border-zinc-200 bg-white p-6"><h3 className="text-xs font-bold uppercase tracking-widest text-orange-600">Hot Path — Quant Boy</h3><p className="mt-2 text-sm text-zinc-700">Pure TypeScript zero-LLM, VWAP orderbook slippage, funding carry cost hurdle, 0.15ms measured latency.</p></div>
          <div className="border border-zinc-200 bg-white p-6"><h3 className="text-xs font-bold uppercase tracking-widest text-orange-600">Deterministic Safety — Risk Boy</h3><p className="mt-2 text-sm text-zinc-700">iGraph-derived Structural Change Guard, unilateral HARD VETO, 65% margin ceiling, $5k position limit.</p></div>
          <div className="border border-zinc-200 bg-white p-6"><h3 className="text-xs font-bold uppercase tracking-widest text-orange-600">Cryptographic Trust — Execution Boy</h3><p className="mt-2 text-sm text-zinc-700">Canonical JSON lexicographical sort, native SHA-256 sealReceipt(), Bitget v2 HMAC OrderDispatcher.</p></div>
        </section>

        <Verifier receipt={latest} />
      </main>
    </div>
  );
}
