import { useEffect, useState } from "react";

export interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSandbox?: () => void;
}

export function OnboardingModal({ isOpen, onClose, onOpenSandbox }: OnboardingModalProps) {
  const [step, setStep] = useState(1);
  const totalSteps = 4;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (isOpen) {
      window.addEventListener("keydown", onKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl rounded-3xl border border-[var(--line)] bg-[oklch(0.16_0.012_265)] p-6 sm:p-8 shadow-2xl text-[var(--text)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Subtle decorative background glow */}
        <div className="absolute -right-20 -top-20 h-60 w-60 rounded-full bg-[var(--accent)] opacity-10 blur-3xl pointer-events-none" />
        <div className="absolute -left-20 -bottom-20 h-60 w-60 rounded-full bg-[var(--warn)] opacity-10 blur-3xl pointer-events-none" />

        {/* Top bar: Stepper & Close button */}
        <div className="flex items-center justify-between border-b border-[var(--line)] pb-4 mb-6">
          <div className="flex items-center gap-2">
            <span className="pill mono text-xs uppercase font-bold text-[var(--accent)]">
              Quickstart Tour · Step {step} of {totalSteps}
            </span>
            <div className="hidden sm:flex gap-1.5 ml-2">
              {Array.from({ length: totalSteps }, (_, i) => (
                <div
                  key={i}
                  className={`h-1.5 w-6 rounded-full transition-all ${
                    i + 1 === step
                      ? "bg-[var(--accent)]"
                      : i + 1 < step
                        ? "bg-white/40"
                        : "bg-white/10"
                  }`}
                />
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[var(--line)] p-1.5 text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors"
            aria-label="Close onboarding"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Step 1: The Opportunity */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-950/40 px-3 py-1 mono text-xs font-semibold text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              The Market Premise
            </div>
            <h2 id="onboarding-title" className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              The desk that trades while Wall Street sleeps.
            </h2>
            <p className="text-sm sm:text-base text-[var(--text-muted)] leading-relaxed">
              Traditional US equity markets (NYSE, NASDAQ) operate only from <strong className="text-white">09:30 to 16:00 ET</strong> on weekdays.
              Meanwhile, tokenized US equities (rTokens like <code className="mono text-[var(--accent)] font-semibold">rNVDA</code>, <code className="mono text-[var(--accent)] font-semibold">rAAPL</code>, <code className="mono text-[var(--accent)] font-semibold">rTSLA</code> on Bitget API v2) trade continuously <strong className="text-white">24 hours a day, 7 days a week</strong>.
            </p>
            <div className="rounded-2xl border border-[var(--line)] bg-[oklch(0.13_0.012_265)] p-4 text-xs sm:text-sm text-zinc-300 space-y-2">
              <div className="flex items-start gap-2">
                <span className="text-[var(--accent)] font-bold">▶</span>
                <span>
                  <strong>The Basis Dislocation:</strong> When earnings break after-hours, news catalysts drop overnight, or weekend macro shifts occur, the crypto token price deviates from the TradFi closing price.
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-[var(--accent)] font-bold">▶</span>
                <span>
                  <strong>Autonomous Arbitrage:</strong> Money Boys captures this price spread whenever the basis exceeds transaction friction (exchange fees, slippage, and overnight carry).
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: The 4 Agents */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-950/40 px-3 py-1 mono text-xs font-semibold text-indigo-300">
              <span>🤖</span> 4 Cooperating AI &amp; Algorithmic Agents
            </div>
            <h2 id="onboarding-title" className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              How consensus works: The Council.
            </h2>
            <p className="text-sm text-[var(--text-muted)] leading-relaxed">
              No single model or person can execute a trade alone. A trade only dispatches when the council reaches a quorum of 3 out of 4 passing votes:
            </p>
            <div className="grid gap-2.5 sm:grid-cols-2 pt-1">
              <div className="rounded-xl border border-[var(--line)] bg-[oklch(0.14_0.012_265)] p-3">
                <div className="flex items-center justify-between">
                  <span className="mono font-bold text-xs text-white">🧠 MACRO BOY</span>
                  <span className="mono text-[10px] text-amber-400">Advisory Only</span>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-1.5 leading-relaxed">
                  Evaluates earnings reports &amp; news catalysts via Qwen-Plus LLM. Proposes theses but possesses <strong>zero trade authority</strong>.
                </p>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-[oklch(0.14_0.012_265)] p-3">
                <div className="flex items-center justify-between">
                  <span className="mono font-bold text-xs text-white">⚡ QUANT BOY</span>
                  <span className="mono text-[10px] text-[var(--accent)]">&lt; 50ms Hot Path</span>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-1.5 leading-relaxed">
                  Computes the raw basis dislocation minus real friction (taker fee, adverse selection, funding carry). Approves only with positive edge.
                </p>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-[oklch(0.14_0.012_265)] p-3">
                <div className="flex items-center justify-between">
                  <span className="mono font-bold text-xs text-white">🛡️ RISK BOY</span>
                  <span className="mono text-[10px] text-rose-400 font-bold">HARD_VETO</span>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-1.5 leading-relaxed">
                  Deterministic circuit breaker. Instant hard veto if margin utilization &gt; 65%, single order &gt; $5,000, or free margin is low.
                </p>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-[oklch(0.14_0.012_265)] p-3">
                <div className="flex items-center justify-between">
                  <span className="mono font-bold text-xs text-white">🔐 EXECUTION BOY</span>
                  <span className="mono text-[10px] text-cyan-300">HMAC &amp; Notary</span>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-1.5 leading-relaxed">
                  Requires 3/4 quorum and seals a cryptographically auditable SHA-256 Reasoning Receipt before dispatching to Bitget API v2.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Governance & The Refusal Story */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-950/40 px-3 py-1 mono text-xs font-semibold text-amber-300">
              <span>⚖️</span> Deterministic Governance
            </div>
            <h2 id="onboarding-title" className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              The power of saying NO: The Refusal Story.
            </h2>
            <p className="text-sm text-[var(--text-muted)] leading-relaxed">
              Every system can say yes. The true differentiator of institutional algorithmic trading is mathematically knowing when to walk away:
            </p>
            <div className="rounded-2xl border border-[var(--line)] bg-[oklch(0.13_0.012_265)] p-4 text-xs sm:text-sm text-zinc-300 space-y-3">
              <div className="flex items-start gap-2.5">
                <span className="rounded-full bg-rose-500/20 text-rose-300 px-2 py-0.5 mono text-[11px] font-bold">I-01</span>
                <div>
                  <strong>Zero Direct LLM Authority:</strong> The AI model cannot sign orders or touch venue keys. It can only propose.
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="rounded-full bg-rose-500/20 text-rose-300 px-2 py-0.5 mono text-[11px] font-bold">I-02</span>
                <div>
                  <strong>Deterministic Hard Veto:</strong> Risk rules are non-negotiable code. No prompt, hallucination, or LLM score can bypass a veto.
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="rounded-full bg-emerald-500/20 text-emerald-300 px-2 py-0.5 mono text-[11px] font-bold">I-03</span>
                <div>
                  <strong>SHA-256 Reasoning Receipt:</strong> Sealed using Web Crypto. If anyone tampers with 1 byte, the receipt fails verification.
                </div>
              </div>
              <div className="flex items-start gap-2.5 pt-1 border-t border-[var(--line)]">
                <span className="text-[var(--warn)] font-bold">⚡</span>
                <div className="text-[var(--text-muted)]">
                  <strong>The Refusal Guarantee:</strong> If the basis gap is 0.01% but trading costs 0.04%, the desk refuses to trade. Trading without edge loses money.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Test It Yourself */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-950/40 px-3 py-1 mono text-xs font-semibold text-emerald-300">
              <span>🚀</span> Ready to Test
            </div>
            <h2 id="onboarding-title" className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              Test the council right in your browser.
            </h2>
            <p className="text-sm text-[var(--text-muted)] leading-relaxed">
              You do not need an account, an API key, or operator credentials. You can run the entire deliberation engine directly in your browser:
            </p>
            <div className="grid gap-2.5 sm:grid-cols-2 pt-1 text-xs">
              <div className="rounded-xl border border-[var(--line)] bg-[oklch(0.14_0.012_265)] p-3 space-y-1">
                <strong className="text-white block font-bold">1. Try Curated Scenarios</strong>
                <span className="text-[var(--text-muted)] block leading-relaxed">
                  Test the happy path (Clear Edge), $18k risk cap veto, 65% margin ceiling, or the refusal story.
                </span>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-[oklch(0.14_0.012_265)] p-3 space-y-1">
                <strong className="text-white block font-bold">2. Custom Scenario Playground</strong>
                <span className="text-[var(--text-muted)] block leading-relaxed">
                  Pick your own equity, trade size, stock price, and token price. Slide the sentiment scores and watch the council vote!
                </span>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-[oklch(0.14_0.012_265)] p-3 space-y-1">
                <strong className="text-white block font-bold">3. Web Crypto Seal &amp; Tamper Test</strong>
                <span className="text-[var(--text-muted)] block leading-relaxed">
                  Generate a real SHA-256 seal with W3C SubtleCrypto, tamper with it, and watch the verifier flag MISMATCH!
                </span>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-[oklch(0.14_0.012_265)] p-3 space-y-1">
                <strong className="text-white block font-bold">4. Live Trading Cockpit</strong>
                <span className="text-[var(--text-muted)] block leading-relaxed">
                  Inspect the live 4-node telemetry matrix, quorum gates, and streaming SSE audit ledger.
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Navigation actions */}
        <div className="mt-8 flex items-center justify-between border-t border-[var(--line)] pt-4">
          <div>
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                className="rounded-xl border border-[var(--line)] bg-[oklch(0.20_0.015_265)] px-4 py-2 mono text-xs text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors cursor-pointer"
              >
                ← Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="mono text-xs text-[var(--text-muted)] hover:text-white transition-colors cursor-pointer px-2 py-1"
            >
              Skip
            </button>
            {step < totalSteps ? (
              <button
                type="button"
                onClick={() => setStep((s) => s + 1)}
                className="rounded-xl bg-white px-5 py-2 mono text-xs font-bold text-zinc-950 hover:bg-zinc-200 transition-colors cursor-pointer"
              >
                Next Step →
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  if (onOpenSandbox) onOpenSandbox();
                }}
                className="rounded-xl bg-[var(--accent)] px-5 py-2 mono text-xs font-bold text-zinc-950 hover:bg-emerald-300 transition-colors cursor-pointer"
              >
                Launch Interactive Sandbox ⚡
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
