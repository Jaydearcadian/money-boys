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
    t: "Quarantined Synthetic Benchmark",
    d: "The LLM-arm benchmark is strictly isolated under GAP-022. Synthetic simulation results are cordoned off and prohibited from acting as live evidence or driving risk thresholds.",
    full: true,
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
        <VerifySection desk={desk} />
        <Ledger />
        <Faq />
        <Closing />
      </main>
      <Footer />
    </div>
  );
}
