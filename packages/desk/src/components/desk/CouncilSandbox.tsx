import { useCallback, useMemo, useState } from "react";
import {
  runSandboxDeliberation,
  sandboxCanonicalJson,
  SANDBOX_PRESETS,
  type SandboxPreset,
  type SandboxResult,
} from "@money-boys/engine/council/browser-sandbox";
import { verifyReceiptInBrowser } from "../../lib/verify";
import type { SealedReasoningReceipt } from "../../lib/api";

/**
 * COUNCIL SANDBOX — run a real deliberation in the browser, seal it with Web
 * Crypto, and never touch the server.
 *
 * Deliberate design points:
 *  - Both curated presets and a custom scenario builder are available so
 *    anyone can drive the parameters themselves.
 *  - Verdicts are dynamically derived by the engine modules (reduceCouncilVote,
 *    evaluateBasisSpread, evaluateExecution, StructuralChangeGuard).
 *  - Web Crypto SHA-256 receipt generation & tamper verification are fully interactive.
 */

type Sealed = { receipt: SealedReasoningReceipt; recomputed: string; ok: boolean };

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sealInBrowser(
  payload: Record<string, unknown>,
): Promise<{ receipt: SealedReasoningReceipt; recomputed: string; ok: boolean }> {
  const bytes = new TextEncoder().encode(sandboxCanonicalJson(payload));
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  const receiptHash = hex(digest);
  const receipt = {
    ...payload,
    receiptId: crypto.randomUUID(),
    sealedAt: new Date().toISOString(),
    receiptHash,
  } as unknown as SealedReasoningReceipt;
  const v = await verifyReceiptInBrowser(receipt);
  return { receipt, recomputed: v.recomputed, ok: v.ok };
}

function Node({ name, score, note }: { name: string; score: string; note: string }) {
  return (
    <div className="sb-node">
      <div className="sb-node-head">
        <span className="sb-node-name">{name}</span>
        <span className="sb-node-score">{score}</span>
      </div>
      <div className="sb-node-note">{note}</div>
    </div>
  );
}

const SYMBOLS = [
  { id: "rNVDAUSDT", label: "rNVDA / USDT (NVIDIA)", defaultToken: 235.5, defaultTradFi: 230.0 },
  { id: "rAAPLUSDT", label: "rAAPL / USDT (Apple)", defaultToken: 224.0, defaultTradFi: 219.5 },
  { id: "rTSLAUSDT", label: "rTSLA / USDT (Tesla)", defaultToken: 412.0, defaultTradFi: 411.9588 },
  { id: "rMSFTUSDT", label: "rMSFT / USDT (Microsoft)", defaultToken: 448.2, defaultTradFi: 442.0 },
  { id: "rGOOGLUSDT", label: "rGOOGL / USDT (Alphabet)", defaultToken: 182.5, defaultTradFi: 180.0 },
];

export function CouncilSandbox() {
  const [mode, setMode] = useState<"presets" | "custom">("presets");
  const [result, setResult] = useState<SandboxResult | null>(null);
  const [sealed, setSealed] = useState<Sealed | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [isTampered, setIsTampered] = useState(false);

  // Custom playground state
  const [symbol, setSymbol] = useState("rNVDAUSDT");
  const [side, setSide] = useState<"BUY_BASIS" | "SELL_BASIS">("BUY_BASIS");
  const [tokenPrice, setTokenPrice] = useState(235.5);
  const [tradFiClosePrice, setTradFiClosePrice] = useState(230.0);
  const [notionalUsd, setNotionalUsd] = useState(2500);
  const [accountEquityUsd, setAccountEquityUsd] = useState(25000);
  const [accountUsedMarginUsd, setAccountUsedMarginUsd] = useState(0);
  const [macroScore, setMacroScore] = useState(80);
  const [execScore, setExecScore] = useState(85);

  const runPreset = useCallback(async (id: string) => {
    setBusy(true);
    setErr(null);
    setSealed(null);
    setIsTampered(false);
    try {
      const preset = SANDBOX_PRESETS.find((p) => p.id === id);
      if (!preset) throw new Error(`unknown preset: ${id}`);
      const r = runSandboxDeliberation(preset);
      setResult(r);
      setSealed(await sealInBrowser(r.receiptPayload));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const runCustom = useCallback(async () => {
    setBusy(true);
    setErr(null);
    setSealed(null);
    setIsTampered(false);
    try {
      const customPreset: SandboxPreset = {
        id: "custom-deliberation",
        label: `Custom: ${symbol} (${side})`,
        intent: "Evaluates your exact custom parameters in real-time.",
        symbol,
        side,
        tokenPrice: Number(tokenPrice),
        tradFiClosePrice: Number(tradFiClosePrice),
        notionalUsd: Number(notionalUsd),
        accountEquityUsd: Number(accountEquityUsd),
        accountUsedMarginUsd: Number(accountUsedMarginUsd),
        macroScore: Number(macroScore),
        execScore: Number(execScore),
        spreadHalfPct: 0.0004,
        plainMeaning: `Custom user scenario: $${Number(notionalUsd).toLocaleString()} trade on ${symbol} against $${Number(accountEquityUsd).toLocaleString()} account equity.`,
      };
      const r = runSandboxDeliberation(customPreset);
      setResult(r);
      setSealed(await sealInBrowser(r.receiptPayload));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }, [symbol, side, tokenPrice, tradFiClosePrice, notionalUsd, accountEquityUsd, accountUsedMarginUsd, macroScore, execScore]);

  const toggleTamper = useCallback(async () => {
    if (!result || !sealed) return;
    if (isTampered) {
      setIsTampered(false);
      const v = await sealInBrowser(result.receiptPayload);
      setSealed(v);
    } else {
      setIsTampered(true);
      const alteredPayload = {
        ...result.receiptPayload,
        notionalUsd: (result.notionalUsd || 1000) * 10,
        decision: "APPROVED_ALTERED_BY_ATTACKER",
      };
      const tamperedReceipt = {
        ...alteredPayload,
        receiptId: sealed.receipt.receiptId,
        sealedAt: sealed.receipt.sealedAt,
        receiptHash: sealed.receipt.receiptHash, // Keeps original digest to provoke mismatch!
      } as unknown as SealedReasoningReceipt;
      const v = await verifyReceiptInBrowser(tamperedReceipt);
      setSealed({ receipt: tamperedReceipt, recomputed: v.recomputed, ok: v.ok });
    }
  }, [result, sealed, isTampered]);

  // Pre-flight metrics calculations
  const rawBasisPct = useMemo(() => {
    if (!tradFiClosePrice || tradFiClosePrice <= 0) return 0;
    return ((tokenPrice - tradFiClosePrice) / tradFiClosePrice) * 100;
  }, [tokenPrice, tradFiClosePrice]);

  const projectedMarginPct = useMemo(() => {
    if (!accountEquityUsd || accountEquityUsd <= 0) return 0;
    return ((accountUsedMarginUsd + notionalUsd) / accountEquityUsd) * 100;
  }, [accountUsedMarginUsd, notionalUsd, accountEquityUsd]);

  const blocked = useMemo(() => result !== null && result.council.status !== "APPROVED", [result]);

  return (
    <section className="sandbox" aria-label="Council sandbox">
      <header className="sandbox-head">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2>Interactive Council Sandbox</h2>
            <p>
              Run genuine deliberations <strong>directly in your browser</strong> using real engine math.
              Sealed with Web Crypto SHA-256. Zero server state changes · safe for anyone to test.
            </p>
          </div>
          {/* Mode Switcher */}
          <div className="inline-flex rounded-full border border-[var(--line)] bg-[oklch(0.14_0.012_265)] p-1 text-xs mono">
            <button
              type="button"
              onClick={() => { setMode("presets"); setErr(null); }}
              className={`rounded-full px-4 py-1.5 font-bold transition-all cursor-pointer ${
                mode === "presets"
                  ? "bg-white text-zinc-950 shadow-sm"
                  : "text-[var(--text-muted)] hover:text-white"
              }`}
            >
              Curated Presets (4)
            </button>
            <button
              type="button"
              onClick={() => { setMode("custom"); setErr(null); }}
              className={`rounded-full px-4 py-1.5 font-bold transition-all cursor-pointer ${
                mode === "custom"
                  ? "bg-[var(--accent)] text-zinc-950 shadow-sm"
                  : "text-[var(--text-muted)] hover:text-white"
              }`}
            >
              Custom Playground ⚡
            </button>
          </div>
        </div>
      </header>

      {/* Mode A: Presets */}
      {mode === "presets" && (
        <div className="space-y-3">
          <div className="sandbox-presets" role="group" aria-label="Sandbox scenarios">
            {SANDBOX_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="sandbox-preset cursor-pointer"
                onClick={() => void runPreset(p.id)}
                disabled={busy}
                aria-pressed={result?.presetId === p.id}
              >
                <span className="sandbox-preset-label">{p.label}</span>
                <span className="sandbox-preset-intent">{p.intent}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mode B: Custom Playground (Test It Yourself) */}
      {mode === "custom" && (
        <div className="rounded-2xl border border-[var(--line)] bg-[oklch(0.14_0.012_265_/_0.8)] p-5 mb-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-3">
            <div>
              <span className="mono text-xs font-bold uppercase tracking-wider text-[var(--accent)]">
                Custom Scenario Builder
              </span>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Set trade and account parameters below to see how Macro, Quant, Risk, and Execution react.
              </p>
            </div>
            {/* Quick Templates */}
            <div className="flex flex-wrap gap-1.5 text-xs mono">
              <span className="text-[var(--text-muted)] self-center mr-1 text-[11px]">Quick Load:</span>
              <button
                type="button"
                onClick={() => {
                  setSymbol("rNVDAUSDT");
                  setSide("BUY_BASIS");
                  setTokenPrice(235.5);
                  setTradFiClosePrice(230.0);
                  setNotionalUsd(2000);
                  setAccountEquityUsd(25000);
                  setAccountUsedMarginUsd(0);
                  setMacroScore(80);
                  setExecScore(85);
                }}
                className="rounded-lg border border-[var(--line)] bg-white/5 px-2.5 py-1 text-zinc-300 hover:text-white hover:border-emerald-400 transition-colors cursor-pointer"
              >
                Clear Edge
              </button>
              <button
                type="button"
                onClick={() => {
                  setSymbol("rNVDAUSDT");
                  setNotionalUsd(18000); // Trips $5k cap
                  setAccountUsedMarginUsd(0);
                  setAccountEquityUsd(25000);
                }}
                className="rounded-lg border border-[var(--line)] bg-white/5 px-2.5 py-1 text-rose-300 hover:text-white hover:border-rose-400 transition-colors cursor-pointer"
              >
                $18k Cap Breach
              </button>
              <button
                type="button"
                onClick={() => {
                  setSymbol("rAAPLUSDT");
                  setNotionalUsd(4500);
                  setAccountEquityUsd(25000);
                  setAccountUsedMarginUsd(14000); // Trips 65% ceiling
                }}
                className="rounded-lg border border-[var(--line)] bg-white/5 px-2.5 py-1 text-amber-300 hover:text-white hover:border-amber-400 transition-colors cursor-pointer"
              >
                65% Margin Limit
              </button>
              <button
                type="button"
                onClick={() => {
                  setSymbol("rTSLAUSDT");
                  setTokenPrice(412.0);
                  setTradFiClosePrice(411.9588); // Sub-fee gap
                  setNotionalUsd(2000);
                  setAccountUsedMarginUsd(0);
                }}
                className="rounded-lg border border-[var(--line)] bg-white/5 px-2.5 py-1 text-cyan-300 hover:text-white hover:border-cyan-400 transition-colors cursor-pointer"
              >
                No Edge / Refusal
              </button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Asset Selection */}
            <div>
              <label className="block text-xs font-bold uppercase text-[var(--text-muted)] mb-1.5">
                Token Asset
              </label>
              <select
                value={symbol}
                onChange={(e) => {
                  const s = e.target.value;
                  setSymbol(s);
                  const found = SYMBOLS.find((x) => x.id === s);
                  if (found) {
                    setTokenPrice(found.defaultToken);
                    setTradFiClosePrice(found.defaultTradFi);
                  }
                }}
                className="w-full rounded-xl border border-[var(--line)] bg-[oklch(0.18_0.014_265)] px-3 py-2 text-xs mono text-white focus:outline-none focus:border-[var(--accent)]"
              >
                {SYMBOLS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Direction */}
            <div>
              <label className="block text-xs font-bold uppercase text-[var(--text-muted)] mb-1.5">
                Trade Direction
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setSide("BUY_BASIS")}
                  className={`rounded-xl border py-2 text-xs mono font-bold cursor-pointer transition-all ${
                    side === "BUY_BASIS"
                      ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                      : "border-[var(--line)] bg-white/5 text-[var(--text-muted)] hover:text-white"
                  }`}
                >
                  BUY BASIS
                </button>
                <button
                  type="button"
                  onClick={() => setSide("SELL_BASIS")}
                  className={`rounded-xl border py-2 text-xs mono font-bold cursor-pointer transition-all ${
                    side === "SELL_BASIS"
                      ? "border-amber-500 bg-amber-500/20 text-amber-300"
                      : "border-[var(--line)] bg-white/5 text-[var(--text-muted)] hover:text-white"
                  }`}
                >
                  SELL BASIS
                </button>
              </div>
            </div>

            {/* Token Venue Price */}
            <div>
              <label className="block text-xs font-bold uppercase text-[var(--text-muted)] mb-1.5">
                Token Price ($)
              </label>
              <input
                type="number"
                step="0.01"
                value={tokenPrice}
                onChange={(e) => setTokenPrice(parseFloat(e.target.value) || 0)}
                className="w-full rounded-xl border border-[var(--line)] bg-[oklch(0.18_0.014_265)] px-3 py-2 text-xs mono text-white focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

            {/* TradFi Stock Benchmark Price */}
            <div>
              <label className="block text-xs font-bold uppercase text-[var(--text-muted)] mb-1.5">
                TradFi Close Price ($)
              </label>
              <input
                type="number"
                step="0.01"
                value={tradFiClosePrice}
                onChange={(e) => setTradFiClosePrice(parseFloat(e.target.value) || 0)}
                className="w-full rounded-xl border border-[var(--line)] bg-[oklch(0.18_0.014_265)] px-3 py-2 text-xs mono text-white focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

            {/* Order Notional */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold uppercase text-[var(--text-muted)]">
                  Order Notional ($)
                </label>
                {notionalUsd > 5000 && (
                  <span className="mono text-[10px] text-rose-400 font-bold">
                    &gt; $5,000 CAP!
                  </span>
                )}
              </div>
              <input
                type="number"
                step="500"
                value={notionalUsd}
                onChange={(e) => setNotionalUsd(parseFloat(e.target.value) || 0)}
                className={`w-full rounded-xl border px-3 py-2 text-xs mono text-white focus:outline-none ${
                  notionalUsd > 5000
                    ? "border-rose-500/80 bg-rose-950/20"
                    : "border-[var(--line)] bg-[oklch(0.18_0.014_265)]"
                }`}
              />
            </div>

            {/* Account Equity */}
            <div>
              <label className="block text-xs font-bold uppercase text-[var(--text-muted)] mb-1.5">
                Account Equity ($)
              </label>
              <input
                type="number"
                step="1000"
                value={accountEquityUsd}
                onChange={(e) => setAccountEquityUsd(parseFloat(e.target.value) || 0)}
                className="w-full rounded-xl border border-[var(--line)] bg-[oklch(0.18_0.014_265)] px-3 py-2 text-xs mono text-white focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

            {/* Account Used Margin */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold uppercase text-[var(--text-muted)]">
                  Used Margin ($)
                </label>
                {projectedMarginPct > 65 && (
                  <span className="mono text-[10px] text-rose-400 font-bold">
                    {projectedMarginPct.toFixed(1)}% &gt; 65% CEILING!
                  </span>
                )}
              </div>
              <input
                type="number"
                step="1000"
                value={accountUsedMarginUsd}
                onChange={(e) => setAccountUsedMarginUsd(parseFloat(e.target.value) || 0)}
                className={`w-full rounded-xl border px-3 py-2 text-xs mono text-white focus:outline-none ${
                  projectedMarginPct > 65
                    ? "border-rose-500/80 bg-rose-950/20"
                    : "border-[var(--line)] bg-[oklch(0.18_0.014_265)]"
                }`}
              />
            </div>

            {/* Pre-Flight Status Badge */}
            <div className="rounded-xl border border-[var(--line)] bg-[oklch(0.12_0.012_265)] p-3 flex flex-col justify-between">
              <div className="text-[10px] mono uppercase text-[var(--text-muted)] font-bold">
                Live Pre-Flight Metric
              </div>
              <div className="space-y-1 text-xs mono">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Raw Basis:</span>
                  <span className={rawBasisPct > 0 ? "text-emerald-400 font-bold" : "text-zinc-300"}>
                    {rawBasisPct.toFixed(4)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Proj Margin:</span>
                  <span className={projectedMarginPct > 65 ? "text-rose-400 font-bold" : "text-zinc-300"}>
                    {projectedMarginPct.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Sliders for Macro & Execution scores */}
          <div className="grid gap-4 sm:grid-cols-2 pt-2 border-t border-[var(--line)]">
            <div>
              <div className="flex justify-between text-xs mono mb-1">
                <span className="text-[var(--text-muted)] uppercase font-bold">Macro Sentiment Score:</span>
                <span className="text-white font-bold">{macroScore} / 100</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={macroScore}
                onChange={(e) => setMacroScore(parseInt(e.target.value, 10))}
                className="w-full accent-emerald-400 cursor-pointer"
              />
              <span className="text-[10px] text-[var(--text-muted)] block mt-0.5">
                Hurdle: 70.0 (Advisory only — model cannot sign orders)
              </span>
            </div>

            <div>
              <div className="flex justify-between text-xs mono mb-1">
                <span className="text-[var(--text-muted)] uppercase font-bold">Execution Readiness Score:</span>
                <span className="text-white font-bold">{execScore} / 100</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={execScore}
                onChange={(e) => setExecScore(parseInt(e.target.value, 10))}
                className="w-full accent-emerald-400 cursor-pointer"
              />
              <span className="text-[10px] text-[var(--text-muted)] block mt-0.5">
                Hurdle: 65.0 (Venue slippage, depth coverage, and fee test)
              </span>
            </div>
          </div>

          {/* Run Button */}
          <div className="pt-2">
            <button
              type="button"
              onClick={() => void runCustom()}
              disabled={busy}
              className="w-full rounded-xl bg-[var(--accent)] py-3 px-6 mono text-xs font-black uppercase tracking-wider text-zinc-950 hover:bg-emerald-300 transition-colors shadow-lg cursor-pointer flex items-center justify-center gap-2"
            >
              <span>⚡</span>
              <span>Run Council Deliberation in Your Browser</span>
            </button>
          </div>
        </div>
      )}

      {busy ? <p className="sandbox-status">Running the council in your browser…</p> : null}
      {err ? (
        <p className="sandbox-status sandbox-error">
          Could not run this scenario: {err}. Try adjusting the parameters or reload the page.
        </p>
      ) : null}

      {!busy && !err && result === null ? (
        <p className="sandbox-status">Choose a preset above or click &quot;Run Council Deliberation&quot; to see the 4 agents deliberate.</p>
      ) : null}

      {result !== null ? (
        <div className="sandbox-result">
          <div className={`sandbox-verdict ${blocked ? "is-blocked" : "is-open"}`}>
            <strong>{blocked ? "Refused" : "Approved"}</strong>
            <span>{result.verdictPlain}</span>
          </div>

          <p className="sandbox-plain">{result.plainMeaning}</p>

          <div className="sandbox-nodes">
            <Node
              name="Macro Boy"
              score={`${result.quant.executionStyle} thesis`}
              note={`Sees the catalyst. Advisory only — it has no keys and cannot trade.`}
            />
            <Node
              name="Quant Boy"
              score={`net ${result.quant.netEdgePct.toFixed(4)}%`}
              note={`Gap ${result.quant.rawBasisPct.toFixed(4)}% minus a ${result.quant.hurdleRatePct.toFixed(4)}% cost of trading.`}
            />
            <Node
              name="Risk Boy"
              score={result.risk.permitted ? "permitted" : "HARD VETO"}
              note={
                result.risk.permitted
                  ? `Exposure $${result.risk.exposureUsd.toFixed(2)} on a $${result.notionalUsd.toFixed(0)} order.`
                  : result.risk.reasons.join(" ")
              }
            />
            <Node
              name="Execution Boy"
              score={`quorum ${result.council.quorum}/4`}
              note={`Council ${result.council.status} at score ${result.council.compositeScore.toFixed(1)}.`}
            />
          </div>

          <div className="sandbox-nodispatch">
            <span className="sandbox-nodispatch-key">dispatched</span>
            <span className="sandbox-nodispatch-value">false</span>
            <span className="sandbox-nodispatch-note">
              This sandbox cannot place an order. No API key exists in this page.
            </span>
          </div>

          {sealed !== null ? (
            <div className="sandbox-receipt">
              <div className="sandbox-receipt-row">
                <span>SHA-256 Reasoning Receipt</span>
                <code>{sealed.receipt.receiptHash}</code>
              </div>
              <div className="sandbox-receipt-row">
                <span>Verified in your browser</span>
                <strong className={sealed.ok ? "text-emerald-400" : "text-rose-400"}>
                  {sealed.ok ? "untampered ✓" : "MISMATCH ✗ (Tampered!)"}
                </strong>
              </div>
              <p className="sandbox-receipt-note">
                Sealed with <code>crypto.subtle.digest</code> using canonical JSON — the same
                scheme the server uses.
              </p>

              {/* Interactive Tamper Testing Control */}
              <div className="mt-3 pt-3 border-t border-[var(--line)] flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-[var(--text-muted)]">
                  Verify Invariant I-03: Altering any single byte invalidates the receipt hash.
                </span>
                <button
                  type="button"
                  onClick={() => void toggleTamper()}
                  className={`rounded-lg px-3 py-1.5 mono text-xs font-bold transition-colors cursor-pointer border ${
                    isTampered
                      ? "border-emerald-500/50 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/40"
                      : "border-rose-500/50 bg-rose-950/40 text-rose-300 hover:bg-rose-900/40"
                  }`}
                >
                  {isTampered ? "↺ Restore Genuine Receipt" : "🧪 Tamper with Payload (Test Rejection)"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default CouncilSandbox;
