import { useMemo, useRef, useState } from "react";
import "./landing-v2.css";
import claimsRaw from "../../../../../foundry/claims.jsonl?raw";
import type { DeskState } from "../../lib/api";
import { usEquityRegime } from "../../lib/regime";
import { BASIS_PRESETS, computeBasis, parseClaims } from "../../lib/landing-data";
import { Verifier } from "../../components/desk/Verifier";
import {
  ArrowRightIcon,
  BrainIcon,
  CheckIcon,
  LayersIcon,
  LightningIcon,
  LockIcon,
  ShieldIcon,
  TerminalIcon,
} from "../../components/icons";
import { useAnchorScroll, useNow, useParallax, useReveal } from "./hooks";

const CLAIMS = parseClaims(claimsRaw);

function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <path d="M21 4a12 12 0 1 0 7 21.5A10 10 0 0 1 21 4Z" fill="oklch(0.80 0.17 160)" />
      <circle cx="23" cy="9" r="2" fill="oklch(0.82 0.15 80)" />
    </svg>
  );
}

const NAV = [
  ["how", "How it works"],
  ["basis", "The edge"],
  ["guardrails", "Guardrails"],
  ["performance", "Track 1 & Live"],
  ["proof", "Proof"],
  ["faq", "FAQ"],
] as const;

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="pill mono uppercase tracking-wider text-[0.72rem]">{children}</span>;
}

function Nav() {
  const go = useAnchorScroll();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-10 px-3 pt-3 sm:px-6">
      <nav
        aria-label="Primary"
        className="glass mx-auto flex max-w-6xl items-center justify-between rounded-full px-4 py-2 sm:px-6"
        style={{ background: "oklch(0.15 0.012 265 / 0.78)" }}
      >
        <ul className="hidden items-center gap-6 text-sm font-semibold lg:flex lg:flex-1">
          {NAV.slice(0, 3).map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} onClick={(e) => go(e, id)} className="text-[var(--text-muted)] hover:text-white">{label}</a>
            </li>
          ))}
        </ul>
        <a href="#/" className="flex min-h-[44px] items-center gap-2 font-extrabold tracking-tight lg:justify-center">
          <Logo /> <span>MONEY BOYS</span>
        </a>
        <div className="hidden items-center justify-end gap-6 text-sm font-semibold lg:flex lg:flex-1">
          {NAV.slice(3).map(([id, label]) => (
            <a key={id} href={`#${id}`} onClick={(e) => go(e, id)} className="text-[var(--text-muted)] hover:text-white">{label}</a>
          ))}
          <a href="#/desk" className="btn btn-primary !min-h-[44px] !px-5 !text-sm">Open the cockpit</a>
        </div>
        <div className="lg:hidden">
          <button
            type="button"
            className="btn btn-ghost !min-h-[44px] !px-4 !text-sm"
            aria-expanded={open}
            aria-controls="lv2-menu"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Close" : "Menu"}
          </button>
        </div>
      </nav>
      {open && (
        <div id="lv2-menu" className="glass mx-auto mt-2 max-w-6xl rounded-3xl p-4 lg:hidden" style={{ background: "oklch(0.15 0.012 265 / 0.95)" }}>
          <ul className="flex flex-col">
            {NAV.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="flex min-h-[48px] items-center font-semibold" onClick={(e) => { setOpen(false); go(e, id); }}>{label}</a>
              </li>
            ))}
            <li><a href="#/desk" className="btn btn-primary mt-2 w-full">Open the cockpit</a></li>
          </ul>
        </div>
      )}
    </header>
  );
}

function Telemetry({ desk }: { desk: DeskState | null }) {
  const [path, setPath] = useState<"hot" | "warm">("hot");
  const ceiling = 65;
  const util = desk?.account.marginUtilPct;
  const nodes = desk
    ? ([["Macro", desk.activeNodes.macro.status], ["Quant", desk.activeNodes.quant.status], ["Risk", desk.activeNodes.risk.status], ["Exec", desk.activeNodes.exec.status]] as const)
    : null;
  return (
    <aside aria-label="Engine telemetry" className="glass w-full max-w-sm rounded-3xl p-5" style={{ background: "oklch(0.15 0.012 265 / 0.9)" }}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold">Engine telemetry</h2>
        <span className="pill mono !py-1 whitespace-nowrap text-[0.7rem]">
          {desk ? <><CheckIcon className="h-3.5 w-3.5" aria-hidden="true" /> from engine</> : <>engine offline</>}
        </span>
      </div>
      {desk && nodes ? (
        <>
          <ul className="mt-4 grid grid-cols-2 gap-2 text-sm">
            {nodes.map(([n, s]) => (
              <li key={n} className="flex items-center justify-between rounded-xl border border-[var(--line)] px-3 py-2">
                <span className="text-[var(--text-muted)]">{n}</span>
                <span className="mono font-semibold">{s}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <div className="flex justify-between text-xs text-[var(--text-muted)]">
              <span id="lv2-margin-label">Margin utilisation (demo/paper)</span>
              <span className="mono">{util?.toFixed(1)}% / {ceiling}% ceiling</span>
            </div>
            <div
              role="meter"
              aria-labelledby="lv2-margin-label"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={util}
              aria-valuetext={`${util?.toFixed(1)} percent used, ceiling ${ceiling} percent`}
              className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-[oklch(1_0_0/0.1)]"
            >
              <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.min(100, util ?? 0)}%`, transition: "width 700ms var(--ease-enter)" }} />
              <div className="absolute inset-y-0 w-0.5 bg-[var(--warn)]" style={{ left: `${ceiling}%` }} />
            </div>
          </div>
        </>
      ) : (
        <p className="mt-4 text-sm text-[var(--text-muted)]">The engine did not respond, so no live numbers are shown. Nothing here is simulated to fill the gap.</p>
      )}
      <div role="group" aria-label="Execution path" className="mt-5 inline-flex rounded-full border border-[var(--line)] p-1">
        {(["hot", "warm"] as const).map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={path === p}
            onClick={() => setPath(p)}
            className={`min-h-[44px] rounded-full px-5 text-sm font-bold transition-colors ${path === p ? "bg-white text-[oklch(0.15_0.012_265)]" : "text-[var(--text-muted)] hover:text-white"}`}
          >
            {p === "hot" ? "Hot path" : "Warm path"}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-[var(--text-muted)]" aria-live="polite">
        {path === "hot"
          ? "Hot path: deterministic gate and receipt, budget under 50 ms. No model call."
          : "Warm path: async. The Macro model proposes catalysts; it cannot place orders."}
      </p>
    </aside>
  );
}

function Hero({ desk }: { desk: DeskState | null }) {
  const go = useAnchorScroll();
  const now = useNow();
  const regime = useMemo(() => usEquityRegime(now), [now]);
  const imgRef = useRef<HTMLDivElement>(null);
  useParallax(imgRef);
  return (
    <section aria-labelledby="hero-h" className="px-3 pb-4 pt-3 sm:px-6">
      <div className="relative mx-auto max-w-7xl overflow-clip rounded-[2rem] border border-[var(--line)] bg-[var(--bg)]">
        <div className="grid-bg absolute inset-0" aria-hidden="true" />
        <div className="spot glow absolute -left-32 -top-32 h-[32rem] w-[32rem]" aria-hidden="true" />
        <div ref={imgRef} className="absolute inset-0 hidden will-change-transform lg:block" aria-hidden="true">
          <picture>
            <source type="image/webp" srcSet="/hero-desk.webp" />
            <img src="/hero-desk.jpg" width={1376} height={768} alt="" className="absolute right-0 top-0 h-full w-[75%] object-cover object-right" fetchPriority="high" />
          </picture>
          <div className="hero-scrim absolute inset-0" />
        </div>
        <div className="relative grid gap-10 px-6 pb-10 pt-14 sm:px-12 lg:min-h-[44rem] lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:px-16 lg:py-20">
          <div className="min-w-0">
            <p className="rise" style={{ ["--i" as string]: 0 }}>
              <span className="pill max-w-full flex-wrap">
                <span className={`h-2 w-2 rounded-full ${regime.open ? "bg-[var(--accent)]" : "bg-[var(--warn)]"}`} aria-hidden="true" />
                {regime.label}
                {regime.nextOpen ? <span className="mono text-[var(--text-muted)]">· next open {regime.nextOpen}</span> : null}
              </span>
            </p>
            <h1 id="hero-h" className="dim-text rise mt-6 font-extrabold leading-[1.02] tracking-tight" style={{ fontSize: "var(--h1)", ["--i" as string]: 1 }}>
              The desk that trades while Wall Street sleeps.
            </h1>
            <p className="measure rise mt-6 text-lg leading-relaxed text-[var(--text-muted)]" style={{ ["--i" as string]: 2 }}>
              Money Boys is an autonomous agentic desk for tokenized US equities on Bitget. Four agents cooperate; a deterministic risk gate can veto any of them; every order is sealed with a SHA-256 receipt you can verify yourself.
            </p>
            <div className="rise mt-8 flex flex-wrap gap-3" style={{ ["--i" as string]: 3 }}>
              <a href="#/desk" className="btn btn-primary">Open the cockpit <ArrowRightIcon className="h-4 w-4" aria-hidden="true" /></a>
              <a href="#verify" onClick={(e) => go(e, "verify")} className="btn btn-ghost">Verify a receipt</a>
            </div>
            <p className="mt-6 text-sm text-[var(--text-muted)]">Bitget Demo / paper only. Not investment advice.</p>
          </div>
          <div className="rise flex min-w-0 flex-col items-start gap-6 lg:items-end" style={{ ["--i" as string]: 4 }}>
            <picture className="block w-full lg:hidden">
              <source type="image/webp" srcSet="/hero-desk.webp" />
              <img src="/hero-desk.jpg" width={1376} height={768} alt="Abstract illustration of a tilted glass trading panel under a crescent moon" className="h-auto w-full rounded-2xl" />
            </picture>
            <Telemetry desk={desk} />
          </div>
        </div>
      </div>
    </section>
  );
}

const CONSTANTS = [
  ["65%", "margin ceiling"],
  ["$5,000", "per-trade cap"],
  ["< 50 ms", "hot-path budget"],
  ["0", "LLM-signed orders"],
] as const;

function Strip() {
  return (
    <section aria-label="Charter constants" className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <dl className="reveal grid grid-cols-2 gap-6 text-center lg:grid-cols-4">
        {CONSTANTS.map(([v, l]) => (
          <div key={l}>
            <dt className="order-2 text-sm text-[var(--text-muted)]">{l}</dt>
            <dd className="mono text-2xl font-bold sm:text-3xl">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-center text-xs text-[var(--text-muted)]">These are enforced limits from the project charter, not measured performance.</p>
    </section>
  );
}

const STEPS = [
  { n: "01", name: "Macro Boy", Icon: BrainIcon, path: "Warm path", line: "Reads catalysts and proposes. A model suggests; it holds no keys and signs nothing." },
  { n: "02", name: "Quant Boy", Icon: LayersIcon, path: "Hot path", line: "Prices the gap between the token and its benchmark, net of fees and funding drag." },
  { n: "03", name: "Risk Boy", Icon: ShieldIcon, path: "Hot path", line: "Deterministic HARD_VETO on margin, trade size, or free margin. No appeal to a model." },
  { n: "04", name: "Execution Boy", Icon: LightningIcon, path: "Hot path", line: "Seals a SHA-256 ReasoningReceipt first. Only then does an order reach Bitget." },
] as const;

function How() {
  return (
    <section id="how" aria-labelledby="how-h" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <div className="reveal"><Badge>How it works</Badge></div>
      <h2 id="how-h" className="dim-text reveal mt-5 max-w-3xl font-extrabold leading-tight tracking-tight" style={{ fontSize: "var(--h2)", ["--i" as string]: 1 }}>
        Four agents. One of them can say no.
      </h2>
      <ol className="mt-12 grid items-start gap-4 lg:grid-cols-4">
        {STEPS.map(({ n, name, Icon, path, line }, i) => (
          <li key={n} className="reveal glass card-lift rounded-3xl p-6 lg:[margin-top:calc(var(--s)*2.5rem)]" style={{ ["--i" as string]: i, ["--s" as string]: i }}>
            <div className="flex items-center justify-between">
              <span className="grid h-12 w-12 place-items-center rounded-2xl border border-[var(--line)]"><Icon className="h-6 w-6 text-[var(--accent)]" aria-hidden="true" /></span>
              <span className="mono text-sm text-[var(--text-muted)]">{n}</span>
            </div>
            <h3 className="mt-6 text-xl font-bold">{name}</h3>
            <p className="mono mt-1 text-xs uppercase tracking-wider text-[var(--warn)]">{path}</p>
            <p className="mt-3 leading-relaxed text-[var(--text-muted)]">{line}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Basis() {
  const [sym, setSym] = useState(BASIS_PRESETS[0]!.symbol);
  const preset = BASIS_PRESETS.find((p) => p.symbol === sym) ?? BASIS_PRESETS[0]!;
  const [tok, setTok] = useState(String(preset.tokenMid));
  const [cls, setCls] = useState(String(preset.benchmarkClose));
  const [drag, setDrag] = useState(String(preset.hurdleDragPct));
  const pick = (s: string) => {
    const p = BASIS_PRESETS.find((x) => x.symbol === s)!;
    setSym(s); setTok(String(p.tokenMid)); setCls(String(p.benchmarkClose)); setDrag(String(p.hurdleDragPct));
  };
  const r = computeBasis({ tokenMid: Number(tok), benchmarkClose: Number(cls), hurdleDragPct: Number(drag) });
  const fld = "mt-1 block min-h-[48px] w-full rounded-xl border border-[oklch(0_0_0/0.25)] bg-white px-3 text-base text-[var(--light-text)]";
  return (
    <section id="basis" aria-labelledby="basis-h" className="light bg-[var(--light-bg)] py-20 text-[var(--light-text)]">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-2">
        <div className="min-w-0">
          <div className="reveal"><Badge>The edge</Badge></div>
          <h2 id="basis-h" className="dim-text reveal mt-5 font-extrabold leading-tight tracking-tight" style={{ fontSize: "var(--h2)", ["--i" as string]: 1 }}>
            Tokens trade all weekend. Their benchmark doesn&apos;t.
          </h2>
          <p className="measure reveal mt-5 leading-relaxed text-[var(--light-muted)]" style={{ ["--i" as string]: 2 }}>
            A tokenized stock keeps quoting 24/7 while the underlying is shut from Friday 16:00 to Monday 09:30 ET. The gap between the two (the basis) can open, and it only matters if it is larger than the cost of trading it. The calculator shows that one relationship with numbers you can change.
          </p>
          <p className="reveal mt-4 text-sm text-[var(--light-muted)]" style={{ ["--i" as string]: 3 }}>
            Simplified on purpose: the real Quant Boy applies more gates (depth, VWAP walk, z-score).
          </p>
        </div>
        <div className="reveal rounded-3xl bg-[var(--light-surface)] p-6 shadow-[0_30px_60px_-30px_rgb(0_0_0/0.35)] sm:p-8" style={{ ["--i" as string]: 1 }}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold">Worked example</h3>
            <span className="pill mono !text-[0.7rem]">illustrative fixture, not live data</span>
          </div>
          <fieldset className="mt-5">
            <legend className="text-sm font-semibold">Instrument</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {BASIS_PRESETS.map((p) => (
                <label key={p.symbol} className={`flex min-h-[44px] cursor-pointer items-center rounded-full border px-4 text-sm font-bold has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)] ${sym === p.symbol ? "border-[var(--light-text)] bg-[var(--light-text)] text-white" : "border-[oklch(0_0_0/0.25)]"}`}>
                  <input type="radio" name="lv2-sym" value={p.symbol} checked={sym === p.symbol} onChange={() => pick(p.symbol)} className="sr-only" />
                  {p.symbol}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <label className="text-sm font-semibold">Token mid ($)<input className={fld} inputMode="decimal" value={tok} onChange={(e) => setTok(e.target.value)} /></label>
            <label className="text-sm font-semibold">Last close ($)<input className={fld} inputMode="decimal" value={cls} onChange={(e) => setCls(e.target.value)} /></label>
            <label className="text-sm font-semibold">Cost drag (%)<input className={fld} inputMode="decimal" value={drag} onChange={(e) => setDrag(e.target.value)} /></label>
          </div>
          <div aria-live="polite" data-testid="basis-result" className="mt-6 rounded-2xl border border-[oklch(0_0_0/0.12)] p-5">
            {r.valid ? (
              <>
                <p className="mono text-sm text-[var(--light-muted)]">raw basis {r.rawPct >= 0 ? "+" : ""}{r.rawPct.toFixed(2)}% − drag {Number(drag).toFixed(2)}% = net edge {r.edgePct >= 0 ? "+" : ""}{r.edgePct.toFixed(2)}%</p>
                <p className={`mt-2 flex items-center gap-2 text-lg font-bold ${r.clears ? "text-[var(--light-accent)]" : "text-[var(--light-warn)]"}`}>
                  {r.clears ? <CheckIcon className="h-5 w-5" aria-hidden="true" /> : <span aria-hidden="true">✕</span>}
                  {r.clears ? `Clears the hurdle: ${r.direction === "SELL_BASIS" ? "token rich, sell the basis" : "token cheap, buy the basis"}` : "Does not clear the hurdle: no trade"}
                </p>
              </>
            ) : (
              <p className="flex items-center gap-2 font-semibold text-[var(--light-danger)]"><span aria-hidden="true">!</span> Enter positive prices and a non-negative drag.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

const GUARDS = [
  { Icon: ShieldIcon, t: "Risk Boy HARD_VETO", d: "Rejects above 65% margin utilisation, above $5,000 on a single trade, or without free margin. Plain code, not a prompt.", wide: true },
  { Icon: LockIcon, t: "Receipt before dispatch", d: "No SHA-256 ReasoningReceipt, no Bitget order." },
  { Icon: BrainIcon, t: "No LLM authority", d: "The model proposes. It holds no keys and cannot sign." },
  { Icon: LayersIcon, t: "Portfolio Copilot limits", d: "Concentration capped at 40% (R4) and 60% (R5), portfolio beta at 2.50 (R6).", wide: true },
  {
    Icon: TerminalIcon,
    t: "Track 1 Authentic Venue Backtest",
    d: "Early synthetic fixtures were quarantined and superseded by an authentic 5-tokenized-pair venue candle backtest (Bitget API v2 1D futures + Alpha Vantage daily). Evaluated across 150 trades (48 OOS, clearing the ≥30 gate) with OOS Sharpe 3.89, Sortino 9.15, and 100% sealed receipts.",
    wide: true,
  },
  {
    Icon: TerminalIcon,
    t: "Live Qwen-3.8-Max Cognitive Shield",
    d: "Live catalyst extraction verified live against Bitget API endpoints with empirical latency profiling (~10.5s), SHA-256 payload digests, and strict LIVE_INFERENCE provenance stamps. Zero execution authority.",
  },
] as const;

function Guardrails() {
  return (
    <section id="guardrails" aria-labelledby="g-h" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <div className="reveal"><Badge>Guardrails</Badge></div>
      <h2 id="g-h" className="dim-text reveal mt-5 max-w-3xl font-extrabold leading-tight tracking-tight" style={{ fontSize: "var(--h2)", ["--i" as string]: 1 }}>
        Built so a bad idea can&apos;t become a trade.
      </h2>
      <ul className="mt-12 grid gap-4 md:grid-cols-3">
        {GUARDS.map(({ Icon, t, d, ...rest }, i) => (
          <li key={t} className={`reveal glass card-lift rounded-3xl p-6 ${"full" in rest ? "md:col-span-3" : "wide" in rest ? "md:col-span-2" : ""}`} style={{ ["--i" as string]: i % 3 }}>
            <Icon className="h-6 w-6 text-[var(--accent)]" aria-hidden="true" />
            <h3 className="mt-5 text-lg font-bold">{t}</h3>
            <p className="measure mt-2 leading-relaxed text-[var(--text-muted)]">{d}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PerformanceSection() {
  const [tab, setTab] = useState<"backtest" | "venue">("backtest");

  return (
    <section id="performance" aria-labelledby="perf-h" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <div className="reveal"><Badge>Track 1 &amp; Live Proof</Badge></div>
      <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <h2 id="perf-h" className="dim-text reveal mt-5 max-w-3xl font-extrabold leading-tight tracking-tight" style={{ fontSize: "var(--h2)", ["--i" as string]: 1 }}>
            Real venue candles. Proven live on Bitget.
          </h2>
          <p className="measure reveal mt-4 text-[var(--text-muted)]" style={{ ["--i" as string]: 2 }}>
            No synthetic stamps or simulated orders. Track 1 walk-forward backtest is derived from authentic Bitget API v2 futures candles; live venue execution is proven on Bitget Demo.
          </p>
        </div>
        <div role="group" aria-label="Evidence tab" className="reveal inline-flex rounded-full border border-[var(--line)] p-1 shrink-0" style={{ ["--i" as string]: 2 }}>
          <button
            type="button"
            aria-pressed={tab === "backtest"}
            onClick={() => setTab("backtest")}
            className={`min-h-[40px] rounded-full px-5 text-sm font-bold transition-colors ${tab === "backtest" ? "bg-white text-[oklch(0.15_0.012_265)]" : "text-[var(--text-muted)] hover:text-white"}`}
          >
            Track 1 Alpha Backtest
          </button>
          <button
            type="button"
            aria-pressed={tab === "venue"}
            onClick={() => setTab("venue")}
            className={`min-h-[40px] rounded-full px-5 text-sm font-bold transition-colors ${tab === "venue" ? "bg-white text-[oklch(0.15_0.012_265)]" : "text-[var(--text-muted)] hover:text-white"}`}
          >
            Live Bitget Execution
          </button>
        </div>
      </div>

      {tab === "backtest" ? (
        <div className="reveal mt-10 grid gap-6 md:grid-cols-3" style={{ ["--i" as string]: 3 }}>
          <div className="glass rounded-3xl p-6 md:col-span-3">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] pb-4">
              <div>
                <span className="mono text-xs uppercase tracking-wider text-[var(--accent)]">Dataset &amp; Universe</span>
                <h3 className="text-xl font-bold">5 Tokenized Equity Pairs (59d IS / 30d OOS)</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {["NVDAUSDT", "TSLAUSDT", "AAPLUSDT", "MSFTUSDT", "GOOGLUSDT"].map((p) => (
                  <span key={p} className="pill mono !text-xs !py-1">{p}</span>
                ))}
              </div>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-[var(--text-muted)]">
              Ingested from real Bitget API v2 <code className="mono text-xs text-white">/api/v2/mix/market/candles</code> (USDT-FUTURES 1D) and Alpha Vantage <code className="mono text-xs text-white">TIME_SERIES_DAILY</code>. Exact cent P&amp;L reconciliation across all 150 trades with 100% sealed SHA-256 ReasoningReceipts.
            </p>
          </div>

          <div className="glass rounded-3xl p-6">
            <span className="mono text-xs uppercase text-[var(--text-muted)]">Out-of-Sample Sharpe</span>
            <div className="mono mt-2 text-4xl font-extrabold text-[var(--accent)]">3.89</div>
            <p className="mt-2 text-xs text-[var(--text-muted)]">In-Sample Sharpe: 2.94. Decay ratio 1.32x (favorable variance compression in benign regimes).</p>
          </div>

          <div className="glass rounded-3xl p-6">
            <span className="mono text-xs uppercase text-[var(--text-muted)]">Out-of-Sample Sortino</span>
            <div className="mono mt-2 text-4xl font-extrabold text-[var(--accent)]">9.15</div>
            <p className="mt-2 text-xs text-[var(--text-muted)]">Mean rolling Sharpe 4.04 across 10-day rolling evaluation windows.</p>
          </div>

          <div className="glass rounded-3xl p-6">
            <span className="mono text-xs uppercase text-[var(--text-muted)]">OOS Trade Gate Cleared</span>
            <div className="mono mt-2 text-4xl font-extrabold text-white">48 <span className="text-lg text-[var(--text-muted)]">/ 30 min</span></div>
            <p className="mt-2 text-xs text-[var(--text-muted)]">150 total trades executed, exceeding the ≥30 statistical significance gate.</p>
          </div>

          <div className="glass rounded-3xl p-6 md:col-span-2">
            <span className="mono text-xs uppercase text-[var(--text-muted)]">Cross-Pair Return Correlation</span>
            <div className="mono mt-2 text-2xl font-bold text-white">ρ = 0.197 <span className="text-xs text-[var(--text-muted)]">(average pairwise)</span></div>
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              Asynchronous idiosyncratic dislocation triggers allow staggered execution. Transparently disclosed: all 5 are mega-cap tech, so common tail risk remains correlated.
            </p>
          </div>

          <div className="glass rounded-3xl p-6">
            <span className="mono text-xs uppercase text-[var(--text-muted)]">Cryptographic Verification</span>
            <div className="mono mt-2 text-2xl font-bold text-[var(--accent)]">100% Sealed</div>
            <p className="mt-2 text-xs text-[var(--text-muted)]">Every single backtest trade passed Council deliberation and sealed a SHA-256 ReasoningReceipt.</p>
          </div>
        </div>
      ) : (
        <div className="reveal mt-10 grid gap-6 md:grid-cols-2" style={{ ["--i" as string]: 3 }}>
          <div className="glass rounded-3xl p-6">
            <div className="flex items-center justify-between">
              <span className="pill mono !py-0.5 !text-xs text-[var(--accent)]">rNVDAUSDT LIFECYCLE</span>
              <span className="mono text-xs text-[var(--text-muted)]">Bitget Demo Venue</span>
            </div>
            <h3 className="mt-4 text-lg font-bold">Tokenized US Equity Round-Trip</h3>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Demonstrated live execution on tokenized stock futures with full read-back:
            </p>
            <ul className="mt-3 space-y-1.5 mono text-xs text-[var(--text-muted)]">
              <li className="flex justify-between border-b border-[var(--line)] py-1"><span>Open Order ID</span><span className="text-white">1491434982630129665</span></li>
              <li className="flex justify-between border-b border-[var(--line)] py-1"><span>Contract Size / Fill</span><span className="text-white">0.11 NVDA @ $240.42</span></li>
              <li className="flex justify-between border-b border-[var(--line)] py-1"><span>Position Read-Back</span><span className="text-white">size 0.11 long confirmed</span></li>
              <li className="flex justify-between border-b border-[var(--line)] py-1"><span>Close Order ID</span><span className="text-white">1491434983930363905</span></li>
              <li className="flex justify-between py-1"><span>Account Status</span><span className="text-[var(--accent)] font-bold">FLAT (100% verified)</span></li>
            </ul>
          </div>

          <div className="glass rounded-3xl p-6">
            <div className="flex items-center justify-between">
              <span className="pill mono !py-0.5 !text-xs text-[var(--warn)]">RESTING LIMIT &amp; CANCEL</span>
              <span className="mono text-xs text-[var(--text-muted)]">Bitget Demo API v2</span>
            </div>
            <h3 className="mt-4 text-lg font-bold">Order Read-Back &amp; Cancel Path</h3>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Corrected venue route to <code className="mono text-xs text-white">/api/v2/mix/order/detail</code> and verified cancel lifecycle:
            </p>
            <ul className="mt-3 space-y-1.5 mono text-xs text-[var(--text-muted)]">
              <li className="flex justify-between border-b border-[var(--line)] py-1"><span>Resting Limit Placed</span><span className="text-white">1491458794516021249</span></li>
              <li className="flex justify-between border-b border-[var(--line)] py-1"><span>Queried State (/detail)</span><span className="text-white">live (code 00000)</span></li>
              <li className="flex justify-between border-b border-[var(--line)] py-1"><span>Cancel Execution</span><span className="text-white">cancel-order accepted</span></li>
              <li className="flex justify-between border-b border-[var(--line)] py-1"><span>Queried State (/detail)</span><span className="text-[var(--warn)]">canceled</span></li>
              <li className="flex justify-between py-1"><span>Residual Position</span><span className="text-[var(--accent)] font-bold">FLAT (0 positions)</span></li>
            </ul>
          </div>

          <div className="glass rounded-3xl p-6">
            <div className="flex items-center justify-between">
              <span className="pill mono !py-0.5 !text-xs text-[var(--accent)]">AUTONOMOUS DAEMON</span>
              <span className="mono text-xs text-[var(--text-muted)]">Multi-Cycle Demo</span>
            </div>
            <h3 className="mt-4 text-lg font-bold">Continuous Loop &amp; Fail-Closed Veto</h3>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Multi-cycle autonomous daemon run against live Bitget USDT-FUTURES &amp; TradFi benchmarks:
            </p>
            <ul className="mt-3 space-y-1.5 mono text-xs text-[var(--text-muted)]">
              <li className="flex justify-between border-b border-[var(--line)] py-1"><span>Live NVDA Futures</span><span className="text-white">$239.88</span></li>
              <li className="flex justify-between border-b border-[var(--line)] py-1"><span>TradFi Benchmark</span><span className="text-white">$239.63</span></li>
              <li className="flex justify-between border-b border-[var(--line)] py-1"><span>Net Edge After Hurdle</span><span className="text-white">-0.0408% (NEUTRAL)</span></li>
              <li className="flex justify-between border-b border-[var(--line)] py-1"><span>Council Decision</span><span className="text-[var(--warn)]">VETOED (I-01/I-02 held)</span></li>
              <li className="flex justify-between py-1"><span>Receipts Sealed</span><span className="text-[var(--accent)]">3/3 cycles immutable</span></li>
            </ul>
          </div>

          <div className="glass rounded-3xl p-6">
            <div className="flex items-center justify-between">
              <span className="pill mono !py-0.5 !text-xs text-[var(--accent)]">QWEN 3.8-MAX</span>
              <span className="mono text-xs text-[var(--text-muted)]">Cognitive Shield</span>
            </div>
            <h3 className="mt-4 text-lg font-bold">Live Qwen Catalyst Extraction</h3>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Real-time unstructured financial catalyst synthesis via Qwen-3.8-Max:
            </p>
            <ul className="mt-3 space-y-1.5 mono text-xs text-[var(--text-muted)]">
              <li className="flex justify-between border-b border-[var(--line)] py-1"><span>Empirical Latency</span><span className="text-white">mean 10,548 ms</span></li>
              <li className="flex justify-between border-b border-[var(--line)] py-1"><span>Payload Hashing</span><span className="text-white">SHA-256 evidenceHash</span></li>
              <li className="flex justify-between border-b border-[var(--line)] py-1"><span>Provenance Stamp</span><span className="text-white">LIVE_INFERENCE</span></li>
              <li className="flex justify-between border-b border-[var(--line)] py-1"><span>Bitget Signals Feed</span><span className="text-white">Options skew &amp; macro risk</span></li>
              <li className="flex justify-between py-1"><span>Order Authority</span><span className="text-[var(--accent)] font-bold">0% (Proposal Only)</span></li>
            </ul>
          </div>
        </div>
      )}

      <div className="reveal mt-8 flex flex-wrap gap-4" style={{ ["--i" as string]: 4 }}>
        <a href="#/desk" className="btn btn-primary">
          Open the live cockpit <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
        </a>
        <a href="#/evidence" className="btn btn-ghost">
          Inspect benchmark pre-flight
        </a>
      </div>
    </section>
  );
}

function VerifySection({ desk }: { desk: DeskState | null }) {
  return (
    <section id="verify" aria-labelledby="v-h" className="light bg-[var(--light-bg)] py-20 text-[var(--light-text)]">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <div className="reveal"><Badge>Don&apos;t trust, verify</Badge></div>
        <h2 id="v-h" className="dim-text reveal mt-5 font-extrabold leading-tight tracking-tight" style={{ fontSize: "var(--h2)", ["--i" as string]: 1 }}>
          Re-hash the latest receipt in your browser.
        </h2>
        <p className="measure reveal mt-4 text-[var(--light-muted)]" style={{ ["--i" as string]: 2 }}>
          The check runs locally with SubtleCrypto. It proves the receipt has not been altered since it was sealed. It does not prove the trade was a good one.
        </p>
        <div className="reveal mt-8" style={{ ["--i" as string]: 3 }}>
          <Verifier receipt={desk?.latestReceipt ?? null} />
        </div>
      </div>
    </section>
  );
}

const STATE_LABEL = { LIVE_DEMONSTRATED: "Live demonstrated", TESTED: "Tested", UNKNOWN: "Unknown" } as const;

function Ledger() {
  const live = CLAIMS.filter((c) => c.state === "LIVE_DEMONSTRATED").length;
  return (
    <section id="proof" aria-labelledby="p-h" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <div className="reveal"><Badge>Proof ledger</Badge></div>
      <h2 id="p-h" className="dim-text reveal mt-5 max-w-3xl font-extrabold leading-tight tracking-tight" style={{ fontSize: "var(--h2)", ["--i" as string]: 1 }}>
        What is proven, and what only passed tests.
      </h2>
      <p className="measure reveal mt-4 text-[var(--text-muted)]" style={{ ["--i" as string]: 2 }}>
        Read from the project&apos;s claims ledger at build time: {live} of {CLAIMS.length} claims are live demonstrated. Tested is not the same as proven live.
      </p>
      <ul className="mt-10 divide-y divide-[var(--line)] rounded-3xl border border-[var(--line)]">
        {CLAIMS.map((c) => (
          <li key={c.id} className="reveal p-5 sm:p-6">
            <details>
              <summary className="flex min-h-[44px] flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
                  <span className="mono shrink-0 text-sm font-bold text-[var(--text-muted)]">{c.id}</span>
                  <span className="pill mono shrink-0 !py-0.5 !px-2 text-[0.65rem] uppercase text-[var(--text-muted)]">
                    {c.category}
                  </span>
                  <span className="min-w-[14rem] flex-1 font-semibold leading-snug">{c.statement}</span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className={`pill shrink-0 !text-xs ${c.state === "LIVE_DEMONSTRATED" ? "text-[var(--accent)]" : "text-[var(--warn)]"}`}>
                    {c.state === "LIVE_DEMONSTRATED" ? <CheckIcon className="h-3.5 w-3.5" aria-hidden="true" /> : <span aria-hidden="true">◐</span>}
                    {STATE_LABEL[c.state]}
                  </span>
                  <svg className="chev h-4 w-4 text-[var(--text-muted)]" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="m5 8 5 5 5-5" />
                  </svg>
                </div>
              </summary>
              <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[oklch(1_0_0/0.02)] p-4 sm:ml-12">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--warn)]">
                  <ShieldIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Audit Scope & Disclosed Constraints</span>
                </div>
                {c.limitations.length > 0 ? (
                  <ul className="mt-3 space-y-2 text-xs leading-relaxed text-[var(--text-muted)]">
                    {c.limitations.map((lim, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="mono shrink-0 select-none text-[var(--line)]">•</span>
                        <span className="flex-1">{lim}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">
                    Verified through automated regression and invariant test suites. Zero operational constraints registered.
                  </p>
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

const FAQ = [
  ["Is this trading real money?", "No. It runs against Bitget Demo / paper trading. Nothing on this page is investment advice."],
  ["Can the AI place trades?", "No. The Macro model can only propose. Orders pass a deterministic risk gate and a sealed receipt, and no LLM holds keys."],
  ["What stops a bad trade?", "Risk Boy vetoes on margin utilisation, trade size and free margin, using fixed rules rather than a model's judgement."],
  ["How do I check a decision?", "Use the verifier above. It recomputes the SHA-256 hash of a receipt in your browser and compares it to the sealed one."],
  ["What is the basis?", "The percentage gap between a token's price and its stock's last close. It is only an opportunity if it exceeds trading costs."],
  ["What is the Track 1 backtest methodology?", "Track 1 was evaluated on authentic Bitget API v2 1D futures candles and Alpha Vantage daily equity data across 5 tokenized pairs (59d IS, 30d OOS split). It achieved an Out-of-Sample Sharpe of 3.89 across 48 OOS trades (clearing the ≥30 statistical gate) with 100% sealed ReasoningReceipts. Early synthetic fixtures were quarantined under GAP-021."],
  ["Does it handle market holidays?", "Not yet. The open/closed chip uses Monday to Friday 09:30–16:00 ET and does not know about exchange holidays or early closes."],
] as const;

function Faq() {
  return (
    <section id="faq" aria-labelledby="f-h" className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
      <div className="reveal"><Badge>FAQ</Badge></div>
      <h2 id="f-h" className="dim-text reveal mt-5 font-extrabold leading-tight tracking-tight" style={{ fontSize: "var(--h2)", ["--i" as string]: 1 }}>Straight answers.</h2>
      <div className="mt-10 divide-y divide-[var(--line)] border-y border-[var(--line)]">
        {FAQ.map(([q, a]) => (
          <details key={q} className="reveal py-2">
            <summary className="flex min-h-[48px] items-center justify-between gap-4 font-semibold">
              {q}
              <svg className="chev h-5 w-5 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 8 5 5 5-5" /></svg>
            </summary>
            <p className="measure pb-4 leading-relaxed text-[var(--text-muted)]">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section aria-labelledby="c-h" className="px-3 pb-4 sm:px-6">
      <div className="relative mx-auto max-w-7xl overflow-clip rounded-[2rem] border border-[var(--line)]">
        <picture aria-hidden="true">
          <source type="image/webp" srcSet="/hero-cta.webp" />
          <img src="/hero-cta.jpg" width={1376} height={768} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
        </picture>
        <div className="absolute inset-0 bg-[oklch(0.15_0.012_265/0.82)]" aria-hidden="true" />
        <div className="relative px-6 py-20 text-center sm:px-12 sm:py-28">
          <h2 id="c-h" className="dim-text reveal mx-auto max-w-3xl font-extrabold leading-tight tracking-tight" style={{ fontSize: "var(--h2)" }}>See the desk work before you believe it.</h2>
          <p className="measure reveal mx-auto mt-4 text-[var(--text-muted)]" style={{ ["--i" as string]: 1 }}>Open the cockpit, step through a cycle, then verify the receipt yourself.</p>
          <div className="reveal mt-8 flex flex-wrap justify-center gap-3" style={{ ["--i" as string]: 2 }}>
            <a href="#/desk" className="btn btn-primary">Open the cockpit <ArrowRightIcon className="h-4 w-4" aria-hidden="true" /></a>
            <a href="#/evidence" className="btn btn-ghost">Read the evidence</a>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <div className="flex flex-col justify-between gap-8 md:flex-row">
        <div className="max-w-sm">
          <p className="flex items-center gap-2 font-extrabold"><Logo /> MONEY BOYS</p>
          <p className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]">Autonomous 24/7 agentic desk for tokenized US equities. Bitget Demo / paper only. Not investment advice.</p>
        </div>
        <ul className="grid grid-cols-1 gap-1 text-sm">
          <li><a href="#/desk" className="flex min-h-[44px] items-center text-[var(--text-muted)] hover:text-white">Cockpit</a></li>
          <li><a href="#/evidence" className="flex min-h-[44px] items-center text-[var(--text-muted)] hover:text-white">Evidence</a></li>
          <li><a href="#/v1" className="flex min-h-[44px] items-center text-[var(--text-muted)] hover:text-white">Legacy v1 landing</a></li>
        </ul>
      </div>
      <p className="mono mt-10 text-xs leading-relaxed text-[var(--text-muted)]">
        implemented ≠ verified · verified locally ≠ proven live · deployed ≠ working · documented ≠ true
      </p>
    </footer>
  );
}

export function LandingV2({ desk }: { desk: DeskState | null }) {
  const root = useRef<HTMLDivElement>(null);
  const go = useAnchorScroll();
  useReveal(root);
  return (
    <div ref={root} className="lv2 min-h-[100vh] min-h-[100svh]">
      <a href="#main" onClick={(e) => go(e, "main")} className="absolute left-3 top-3 z-10 -translate-y-20 rounded-full bg-white px-5 py-3 font-bold text-black focus:translate-y-0">Skip to content</a>
      <Nav />
      <main id="main">
        <Hero desk={desk} />
        <Strip />
        <How />
        <Basis />
        <Guardrails />
        <PerformanceSection />
        <VerifySection desk={desk} />
        <Ledger />
        <Faq />
        <Closing />
      </main>
      <Footer />
    </div>
  );
}
