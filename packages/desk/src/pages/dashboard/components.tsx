import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { SANDBOX_PRESETS } from "@money-boys/engine/council/browser-sandbox";
import type { SandboxResult } from "@money-boys/engine/council/browser-sandbox";
import { COUNCIL_THRESHOLDS, COUNCIL_WEIGHTS } from "@money-boys/engine/council/reducer";
import { MAX_MARGIN_UTILIZATION, MAX_SINGLE_EXPOSURE_USD } from "@money-boys/engine/skills/igraph-guard/security";
import {
  ActivityIcon,
  AlertTriangleIcon,
  BrainIcon,
  CheckIcon,
  CopyIcon,
  CrossIcon,
  LayersIcon,
  LightningIcon,
  LockIcon,
  SearchIcon,
  ShieldIcon,
  SparklesIcon,
  TerminalIcon,
  TrendingUpIcon,
} from "../../components/icons";
import { baseTicker, isHash, type Decision, type Trade } from "../../lib/records";
import { seal, verdictOf } from "../../lib/seal";
import { canonicalJson, useDesk, type Run, type TabId } from "./state";

/* ───────────────────────── shared bits ───────────────────────── */

const SYMBOL_COLORS: Record<string, string> = {
  NVDA: "#60a5fa",
  AAPL: "#f59e0b",
  TSLA: "#34d399",
  MSFT: "#a78bfa",
  GOOGL: "#f472b6",
};
export const colorOf = (s: string) => SYMBOL_COLORS[baseTicker(s)] ?? "#9ca3af";

export const shortHash = (h: string) => (isHash(h) ? `${h.slice(0, 8)}…${h.slice(-6)}` : h || "none");
export const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
export const pct = (n: number, d = 2) => `${n.toFixed(d)}%`;

export function Pill({ tone, children }: { tone: "ok" | "warn" | "bad" | "info"; children: ReactNode }) {
  return <span className={`db-pill ${tone}`}>{children}</span>;
}

function Card({ title, aside, children, className = "" }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`db-card ${className}`}>
      {title && (
        <header className="db-card-head">
          <h2>{title}</h2>
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}
export { Card };

export function Loading({ error }: { error: string | null }) {
  return error ? (
    <div className="db-empty bad" role="alert">
      <AlertTriangleIcon className="h-4 w-4" /> Could not load the records: {error}
    </div>
  ) : (
    <div className="db-empty">Loading the records…</div>
  );
}

/* ───────────────────────── sidebar ───────────────────────── */

const NAV: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: "cockpit", label: "Cockpit", icon: <LayersIcon className="h-4 w-4" /> },
  { id: "strategy", label: "Alpha Factory", icon: <TrendingUpIcon className="h-4 w-4" /> },
  { id: "copilot", label: "Portfolio Copilot", icon: <ShieldIcon className="h-4 w-4" /> },
  { id: "audit", label: "Agentic Audit", icon: <LockIcon className="h-4 w-4" /> },
  { id: "sandbox", label: "Sandbox Lab", icon: <LightningIcon className="h-4 w-4" /> },
];

export function Sidebar() {
  const { tab, go, bases, symbol, setSymbol, halted, setHalted, query, setQuery } = useDesk();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <aside className="db-side">
      <a href="#/" className="db-brand" aria-label="Back to Money Boys home">
        <svg viewBox="0 0 32 32" width="20" height="20" aria-hidden="true">
          <path d="M21 4a12 12 0 1 0 7 21.5A10 10 0 0 1 21 4Z" fill="currentColor" />
          <circle cx="23" cy="9" r="2" fill="currentColor" />
        </svg>
        <span>Money Boys</span>
        <em>Desk</em>
      </a>

      <label className="db-search">
        <SearchIcon className="h-3 w-3" />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search symbol or hash"
          aria-label="Search records"
        />
        <kbd>/</kbd>
      </label>

      <nav className="db-nav" aria-label="Dashboard navigation">
        {NAV.map((n) => (
          <button
            key={n.id}
            className={tab === n.id ? "on" : ""}
            aria-current={tab === n.id ? "page" : undefined}
            onClick={() => go(n.id)}
          >
            {n.icon}
            {n.label}
          </button>
        ))}
      </nav>

      <div className="db-tracks">
        <span className="db-label">Competition tracks</span>
        <div className="db-track-pills" role="group" aria-label="Hackathon tracks">
          <button className={tab === "strategy" ? "on" : ""} onClick={() => go("strategy")}>Track 1 Alpha</button>
          <button className={tab === "audit" ? "on" : ""} onClick={() => go("audit")}>Track 2 Agentic</button>
          <button className={tab === "copilot" ? "on" : ""} onClick={() => go("copilot")}>Track 3 Copilot</button>
        </div>
      </div>

      <div className="db-watch" aria-label="Symbols in the records">
        <span className="db-label">Stocks</span>
        <div className="db-chips">
          <button className={symbol === null ? "on" : ""} onClick={() => setSymbol(null)}>
            All
          </button>
          {bases.map((b) => (
            <button key={b} className={symbol === b ? "on" : ""} onClick={() => setSymbol(symbol === b ? null : b)}>
              <i style={{ background: SYMBOL_COLORS[b] ?? "#9ca3af" }} />r{b}
            </button>
          ))}
        </div>
      </div>

      <div className="db-status">
        <div className="db-status-row">
          <i className="on" /> Browser sandbox
        </div>
        <p>Runs the real engine code on this page. No server is contacted and no order can be sent.</p>
        <button
          className={`db-halt ${halted ? "is-halted" : ""}`}
          onClick={() => setHalted(!halted)}
          aria-pressed={halted}
        >
          {halted ? "Resume sandbox" : "Halt sandbox"}
        </button>
      </div>
    </aside>
  );
}

/* ───────────────────────── header ───────────────────────── */

const TITLES: Record<TabId, string> = {
  cockpit: "Cockpit",
  strategy: "Track 1 · Alpha Factory",
  copilot: "Track 3 · Portfolio Copilot",
  audit: "Track 2 · Agentic Execution",
  sandbox: "Interactive Sandbox Lab",
};

export function TopHeader() {
  const { tab, sessionOpen, halted } = useDesk();
  return (
    <header className="db-top">
      <div>
        <p className="db-crumb">Dashboard / {TITLES[tab]}</p>
        <h1>{tab === "cockpit" ? "Welcome back" : TITLES[tab]}</h1>
      </div>
      <div className="db-top-r">
        {halted && <Pill tone="bad">Halted</Pill>}
        <span className="db-sess" data-testid="session-pill">
          <i className={sessionOpen ? "on" : "off"} />
          US stocks {sessionOpen ? "open" : "closed"}
        </span>
        <a className="db-btn" href="/money_boys_paper_trades.csv" download>
          Export CSV
        </a>
      </div>
    </header>
  );
}

/* ───────────────────────── KPI row ───────────────────────── */

function Kpi({ label, value, sub, tone, icon, testId }: { label: string; value: string; sub: string; tone?: "ok" | "warn" | "bad"; icon: ReactNode; testId: string }) {
  return (
    <div className="db-card db-kpi" data-testid={testId}>
      <div>
        <span className="db-label">{label}</span>
        <strong className={tone ?? ""}>{value}</strong>
        <small>{sub}</small>
      </div>
      <span className="db-kpi-ic">{icon}</span>
    </div>
  );
}

export function KpiRow() {
  const { records, run } = useDesk();
  const [daemon, setDaemon] = useState<{ totalCyclesAcrossAllBots: number } | null>(null);

  useEffect(() => {
    fetch("/evidence/demo_bots_summary.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setDaemon(j))
      .catch(() => {});
  }, []);

  const symbolsInDecisions = records ? new Set(records.decisions.map((d) => d.symbol)).size : null;
  const approved = records?.decisions.filter((d) => d.decision === "APPROVED").length ?? 0;
  const vetoed = records?.decisions.filter((d) => d.decision === "VETOED").length ?? 0;
  const margin = run ? run.result.risk.projectedMarginUtilization : null;
  return (
    <div className="db-kpis">
      <Kpi
        testId="kpi-stocks"
        label="Stocks on record"
        value={symbolsInDecisions === null ? "…" : String(symbolsInDecisions)}
        sub={records ? `${new Set(records.trades.map((t) => t.symbol)).size} in the 89-day log` : "loading"}
        icon={<ActivityIcon className="h-5 w-5" />}
      />
      <Kpi
        testId="kpi-margin"
        label="Account use (last run)"
        value={margin === null ? "…" : pct(margin * 100, 1)}
        sub={`Limit ${(MAX_MARGIN_UTILIZATION * 100).toFixed(0)}% · from the last sandbox run`}
        tone={margin === null ? undefined : margin > MAX_MARGIN_UTILIZATION ? "bad" : "ok"}
        icon={<ShieldIcon className="h-5 w-5" />}
      />
      <Kpi
        testId="kpi-receipts"
        label={daemon ? "24/7 Cycles on record" : "Decisions on record"}
        value={daemon ? daemon.totalCyclesAcrossAllBots.toLocaleString() : records ? String(records.decisions.length) : "…"}
        sub={daemon ? "Autonomous daemon · 5 bots active" : records ? `${approved} approved · ${vetoed} vetoed` : "loading"}
        icon={<LockIcon className="h-5 w-5" />}
      />
      <Kpi
        testId="kpi-latency"
        label="Engine run time"
        value={run ? `${run.ms.toFixed(1)} ms` : "…"}
        sub="Measured in this browser · target under 50 ms"
        tone={run ? (run.ms < 50 ? "ok" : "warn") : undefined}
        icon={<LightningIcon className="h-5 w-5" />}
      />
    </div>
  );
}

/* ───────────────────────── basis chart ───────────────────────── */

type Sample = "all" | "in" | "out";

export function BasisChart({ trades }: { trades: Trade[] }) {
  const { symbol } = useDesk();
  const [sample, setSample] = useState<Sample>("all");
  const [hover, setHover] = useState<number | null>(null);

  const pts = useMemo(
    () =>
      trades
        .filter((t) => (symbol ? baseTicker(t.symbol) === symbol : true))
        .filter((t) => (sample === "all" ? true : sample === "out" ? t.isOutSample : !t.isOutSample))
        .sort((a, b) => a.entryDate.localeCompare(b.entryDate))
        .map((t) => {
          const basis = Math.abs(t.entryBasisPct);
          const drag = t.notionalUsd > 0 ? (t.feesUsd / t.notionalUsd) * 100 : 0;
          return { t, basis, drag, edge: basis - drag };
        }),
    [trades, symbol, sample],
  );

  const W = 720;
  const H = 250;
  const pad = { l: 40, r: 12, t: 12, b: 26 };
  const maxY = Math.max(1, ...pts.map((p) => p.basis)) * 1.1;
  const x = (i: number) => pad.l + (pts.length <= 1 ? 0 : (i / (pts.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => H - pad.b - (v / maxY) * (H - pad.t - pad.b);
  const line = (key: "basis" | "drag") => pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(" ");
  const area = (key: "basis" | "drag") =>
    pts.length ? `${line(key)} L${x(pts.length - 1).toFixed(1)} ${y(0)} L${x(0).toFixed(1)} ${y(0)} Z` : "";
  const sel = hover !== null ? pts[hover] : undefined;
  const winning = pts.filter((p) => p.edge > 0).length;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!pts.length) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (pts.length - 1));
    setHover(Math.max(0, Math.min(pts.length - 1, i)));
  };

  return (
    <Card
      title={`Price gap vs trading cost${symbol ? ` · r${symbol}` : ""}`}
      aside={
        <div className="db-seg" role="group" aria-label="Sample">
          {([["all", "All"], ["in", "In-sample"], ["out", "Out-of-sample"]] as [Sample, string][]).map(([k, l]) => (
            <button key={k} className={sample === k ? "on" : ""} onClick={() => setSample(k)}>
              {l}
            </button>
          ))}
        </div>
      }
    >
      {pts.length === 0 ? (
        <div className="db-empty">No trades for this filter.</div>
      ) : (
        <>
          <svg
            className="db-chart"
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`Chart of ${pts.length} trades: price gap against trading cost`}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            data-testid="basis-chart"
          >
            <defs>
              <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" stroke="#34d399" strokeOpacity="0.45" strokeWidth="2" />
              </pattern>
            </defs>
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <g key={f}>
                <line x1={pad.l} x2={W - pad.r} y1={y(maxY * f)} y2={y(maxY * f)} stroke="rgba(255,255,255,0.06)" />
                <text x={pad.l - 6} y={y(maxY * f) + 3} textAnchor="end" className="db-axis">
                  {(maxY * f).toFixed(1)}%
                </text>
              </g>
            ))}
            <path d={area("basis")} fill="url(#hatch)" />
            <path d={area("drag")} fill="#151821" />
            <path d={line("drag")} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="5 4" />
            <path d={line("basis")} fill="none" stroke="#fff" strokeWidth="1.8" />
            {pts.length > 0 && (
              <>
                <text x={pad.l} y={H - 8} className="db-axis">{pts[0]!.t.entryDate}</text>
                <text x={W - pad.r} y={H - 8} textAnchor="end" className="db-axis">{pts[pts.length - 1]!.t.entryDate}</text>
              </>
            )}
            {sel && hover !== null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="rgba(255,255,255,0.25)" />
                <circle cx={x(hover)} cy={y(sel.basis)} r="4" fill="#fff" />
              </g>
            )}
          </svg>
          <div className="db-legend">
            <span><i className="w" /> Price gap at entry</span>
            <span><i className="a" /> Fees as % of trade</span>
            <span><i className="h" /> Gap above fees</span>
          </div>
          <p className="db-readout" data-testid="chart-readout" aria-live="polite">
            {sel ? (
              <>
                <b style={{ color: colorOf(sel.t.symbol) }}>{sel.t.symbol}</b> {sel.t.side} on {sel.t.entryDate}
                {" · "}token {usd(sel.t.entryTokenPrice)} vs stock {usd(sel.t.entryEquityPrice)}
                {" · "}gap {pct(sel.basis)} − fees {pct(sel.drag)} = <b className={sel.edge > 0 ? "ok" : "bad"}>{pct(sel.edge)}</b>
              </>
            ) : (
              <>
                {pts.length} trades · gap cleared fees on {winning}. Hover the chart to inspect a trade. Fees only; slippage and
                funding are not in this log.
              </>
            )}
          </p>
        </>
      )}
    </Card>
  );
}

/* ───────────────────────── decision feed ───────────────────────── */

export function useFilteredDecisions(): Decision[] {
  const { records, query, symbol } = useDesk();
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    return (records?.decisions ?? [])
      .filter((d) => (symbol ? baseTicker(d.symbol) === symbol : true))
      .filter(
        (d) =>
          !q ||
          d.symbol.toLowerCase().includes(q) ||
          d.receiptHash.toLowerCase().includes(q) ||
          d.evidenceHash.toLowerCase().includes(q) ||
          d.catalyst.toLowerCase().includes(q) ||
          d.decision.toLowerCase().includes(q),
      )
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [records, query, symbol]);
}

export function DecisionFeed({ limit }: { limit?: number }) {
  const { setDrawer, records, recordsError } = useDesk();
  const rows = useFilteredDecisions();
  const shown = limit ? rows.slice(0, limit) : rows;
  return (
    <Card title="Decision feed" aside={<span className="db-count">{rows.length} shown</span>} className="db-feed">
      {!records ? (
        <Loading error={recordsError} />
      ) : shown.length === 0 ? (
        <div className="db-empty">Nothing matches.</div>
      ) : (
        <ul data-testid="decision-feed">
          {shown.map((d) => (
            <li key={d.receiptHash + d.timestamp}>
              <button onClick={() => setDrawer({ kind: "record", d })} aria-label={`Open receipt for ${d.symbol} ${d.decision}`}>
                <span className="db-sym" style={{ color: colorOf(d.symbol) }}>{d.symbol}</span>
                <Pill tone={d.decision === "APPROVED" ? "ok" : "bad"}>{d.decision === "APPROVED" ? "Approved" : "Vetoed"}</Pill>
                <span className="db-when">{d.timestamp.slice(0, 16).replace("T", " ")}</span>
                <span className="db-meta">
                  {d.decision === "APPROVED" ? `fill ${usd(d.fillPrice)} · P&L ${usd(d.pnlUsd)}` : d.status.replace("_", " ").toLowerCase()}
                  {" · score "}
                  {d.score.toFixed(1)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ───────────────────────── sandbox result + receipt ───────────────────────── */

export function ReceiptView({ payload, hash }: { payload: Record<string, unknown>; hash: string }) {
  const [tampered, setTampered] = useState(false);
  const [state, setState] = useState<{ recomputed: string; ok: boolean } | null>(null);
  const shown = useMemo(
    () => (tampered ? { ...payload, decision: "APPROVED_ALTERED_BY_ATTACKER" } : payload),
    [payload, tampered],
  );
  useEffect(() => {
    let live = true;
    setState(null);
    void seal(shown).then((recomputed) => live && setState({ recomputed, ok: recomputed === hash }));
    return () => {
      live = false;
    };
  }, [shown, hash]);
  const [copied, setCopied] = useState(false);
  return (
    <div className="db-receipt">
      <div className="db-code-head">
        <span>receipt.json</span>
        <button
          className="db-mini"
          onClick={() => {
            void navigator.clipboard?.writeText(JSON.stringify(shown, null, 2)).then(() => setCopied(true));
            window.setTimeout(() => setCopied(false), 1200);
          }}
        >
          <CopyIcon className="h-3 w-3" /> {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>{JSON.stringify(JSON.parse(canonicalJson(shown)), null, 2)}</pre>
      <dl className="db-hashes">
        <div><dt>Sealed hash (SHA-256)</dt><dd data-testid="seal-hash">{hash || "sealing…"}</dd></div>
        <div><dt>Recomputed from this body</dt><dd data-testid="seal-recomputed">{state ? state.recomputed : "…"}</dd></div>
      </dl>
      <div className="db-verify">
        {state && (
          <Pill tone={state.ok ? "ok" : "bad"}>
            <span data-testid="seal-status">{state.ok ? "Verified: body matches the seal" : "MISMATCH: body was changed"}</span>
          </Pill>
        )}
        <button className="db-mini" onClick={() => setTampered((t) => !t)} aria-pressed={tampered}>
          {tampered ? "Undo tamper" : "Try tampering"}
        </button>
      </div>
    </div>
  );
}

function agentRows(r: SandboxResult) {
  const s = (r.receiptPayload as { councilScores?: Record<string, number> }).councilScores ?? {};
  const rows = [
    { key: "macro", name: "Macro Boy", icon: <BrainIcon className="h-4 w-4" />, score: s.macro, th: COUNCIL_THRESHOLDS.macro, w: COUNCIL_WEIGHTS.macro, note: "Opinion on the news. Suggests only." },
    { key: "quant", name: "Quant Boy", icon: <ActivityIcon className="h-4 w-4" />, score: s.quant, th: COUNCIL_THRESHOLDS.quant, w: COUNCIL_WEIGHTS.quant, note: `Gap ${pct(r.quant.rawBasisPct)} − costs ${pct(r.quant.hurdleRatePct)} = ${pct(r.quant.netEdgePct)}` },
    { key: "risk", name: "Risk Boy", icon: <ShieldIcon className="h-4 w-4" />, score: s.risk, th: COUNCIL_THRESHOLDS.risk, w: COUNCIL_WEIGHTS.risk, note: r.risk.permitted ? `Account use ${pct(r.risk.projectedMarginUtilization * 100, 1)} after the trade` : r.risk.reasons.join(" ") },
    { key: "exec", name: "Execution Boy", icon: <LightningIcon className="h-4 w-4" />, score: s.exec, th: COUNCIL_THRESHOLDS.exec, w: COUNCIL_WEIGHTS.exec, note: "Can the order actually fill at this size?" },
  ];
  return rows;
}

export function ResultPanel({ run }: { run: Run | null }) {
  if (!run) return <div className="db-empty">Run a scenario to see the helpers decide.</div>;
  const r = run.result;
  const v = verdictOf(r);
  return (
    <div className="db-result" data-testid="result-panel">
      <div className="db-result-head">
        <div>
          <h3>{r.label}</h3>
          <p>{r.plainMeaning}</p>
        </div>
        <Pill tone={v.tone === "ok" ? "ok" : v.tone === "warn" ? "warn" : "bad"}>
          <span data-testid="verdict">{v.label}</span>
        </Pill>
      </div>
      <p className="db-verdict-plain">{r.verdictPlain}</p>

      <ul className="db-agents">
        {agentRows(r).map((a) => {
          const pass = a.score !== undefined && a.score >= a.th;
          return (
            <li key={a.key}>
              <span className="db-agent-ic">{a.icon}</span>
              <div>
                <b>{a.name}</b>
                <small>{a.note}</small>
              </div>
              <span className={`db-score ${pass ? "ok" : "bad"}`}>
                {a.score === undefined ? "–" : a.score.toFixed(0)}
                <small>needs {a.th}</small>
              </span>
            </li>
          );
        })}
      </ul>

      <dl className="db-nums">
        <div><dt>Council score</dt><dd>{r.council.compositeScore.toFixed(1)} <small>needs 75</small></dd></div>
        <div><dt>Helpers agreeing</dt><dd>{r.council.quorum} of 4 <small>needs 3</small></dd></div>
        <div><dt>Trade size</dt><dd>{usd(r.risk.exposureUsd)} <small>cap {usd(MAX_SINGLE_EXPOSURE_USD)}</small></dd></div>
        <div><dt>Account use</dt><dd>{pct(r.risk.projectedMarginUtilization * 100, 1)} <small>cap {(MAX_MARGIN_UTILIZATION * 100).toFixed(0)}%</small></dd></div>
      </dl>

      <ReceiptView payload={r.receiptPayload} hash={run.hash} />
      <p className="db-foot">
        Computed in {run.ms.toFixed(1)} ms in your browser. Dispatched: no. Server contacted: no.
      </p>
    </div>
  );
}

/* ───────────────────────── scenario cards ───────────────────────── */

const PRESET_TAG: Record<string, string> = {
  "clean-edge": "Happy path",
  "risk-veto": "Size cap",
  "margin-ceiling": "Margin ceiling",
  "no-edge": "No edge",
};

export function ScenarioGrid() {
  const { runPreset, run, halted } = useDesk();
  return (
    <div className="db-scen" data-testid="scenario-grid">
      {SANDBOX_PRESETS.map((p) => {
        const active = run?.result.presetId === p.id;
        return (
          <article key={p.id} className={`db-card db-scen-card ${active ? "is-active" : ""}`}>
            <div className="db-scen-top">
              <Pill tone="info">{PRESET_TAG[p.id] ?? "Scenario"}</Pill>
              <span className="db-sym" style={{ color: colorOf(p.symbol) }}>{p.symbol}</span>
            </div>
            <h3>{p.label}</h3>
            <p>{p.plainMeaning}</p>
            <dl className="db-mini-kv">
              <div><dt>Trade</dt><dd>{usd(p.notionalUsd)}</dd></div>
              <div><dt>Account</dt><dd>{usd(p.accountEquityUsd)}</dd></div>
              <div><dt>Already used</dt><dd>{usd(p.accountUsedMarginUsd)}</dd></div>
            </dl>
            <button className="db-btn solid" disabled={halted} onClick={() => runPreset(p)} aria-label={`Run ${p.label}`}>
              {active ? <CheckIcon className="h-3 w-3" /> : <LightningIcon className="h-3 w-3" />} Run scenario
            </button>
          </article>
        );
      })}
    </div>
  );
}


/* ───────────────────────── custom sandbox sliders ───────────────────────── */

export function CustomSandbox() {
  const { runCustom, halted, runError } = useDesk();
  const base = SANDBOX_PRESETS[0]!;
  const [tokenPrice, setTokenPrice] = useState(base.tokenPrice);
  const [notionalUsd, setNotionalUsd] = useState(base.notionalUsd);
  const [usedMargin, setUsedMargin] = useState(base.accountUsedMarginUsd);
  return (
    <Card title="Custom dislocation" aside={<span className="db-label">Live engine · no server</span>}>
      <p className="db-lead">
        Drag the token price, trade size, and already-used margin. The same browser council that powers the presets
        evaluates the proposal and seals a SHA-256 receipt — nothing is posted.
      </p>
      <div className="db-sliders">
        <label>
          Token midpoint ${tokenPrice.toFixed(2)}
          <input type="range" min={210} max={260} step={0.1} value={tokenPrice} onChange={(e) => setTokenPrice(Number(e.target.value))} />
        </label>
        <label>
          Notional ${notionalUsd.toLocaleString()}
          <input type="range" min={500} max={20000} step={100} value={notionalUsd} onChange={(e) => setNotionalUsd(Number(e.target.value))} />
        </label>
        <label>
          Account already used ${usedMargin.toLocaleString()}
          <input type="range" min={0} max={20000} step={100} value={usedMargin} onChange={(e) => setUsedMargin(Number(e.target.value))} />
        </label>
      </div>
      {runError && <div className="db-empty bad" role="alert">{runError}</div>}
      <button
        className="db-btn solid"
        style={{ marginTop: 14 }}
        disabled={halted}
        onClick={() =>
          runCustom({
            ...base,
            id: "custom",
            label: "Custom dislocation",
            intent: "Judge-built scenario from sliders.",
            tokenPrice,
            notionalUsd,
            accountUsedMarginUsd: usedMargin,
            plainMeaning: `Custom rNVDA proposal at token ${tokenPrice.toFixed(2)} vs stock ${base.tradFiClosePrice.toFixed(2)}.`,
          })
        }
      >
        <LightningIcon className="h-3 w-3" /> Run custom scenario
      </button>
    </Card>
  );
}

/* ───────────────────────── receipt drawer ───────────────────────── */

export function ReceiptDrawer() {
  const { drawer, setDrawer } = useDesk();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!drawer) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer, setDrawer]);
  if (!drawer) return null;
  return (
    <div className="db-drawer-wrap" onClick={() => setDrawer(null)}>
      <aside className="db-drawer" role="dialog" aria-modal="true" aria-label="Receipt" onClick={(e) => e.stopPropagation()} data-testid="drawer">
        <header>
          <h2>{drawer.kind === "record" ? "Recorded decision" : "Sandbox receipt"}</h2>
          <button ref={closeRef} className="db-mini" onClick={() => setDrawer(null)} aria-label="Close">
            <CrossIcon className="h-3 w-3" />
          </button>
        </header>
        {drawer.kind === "record" ? (
          <div className="db-drawer-body">
            <div className="db-result-head">
              <div>
                <h3 style={{ color: colorOf(drawer.d.symbol) }}>{drawer.d.symbol}</h3>
                <p>{drawer.d.timestamp}</p>
              </div>
              <Pill tone={drawer.d.decision === "APPROVED" ? "ok" : "bad"}>{drawer.d.decision === "APPROVED" ? "Approved" : "Vetoed"}</Pill>
            </div>
            <p className="db-verdict-plain">{drawer.d.catalyst}</p>
            <dl className="db-nums">
              <div><dt>Council score</dt><dd>{drawer.d.score.toFixed(1)}</dd></div>
              <div><dt>Outcome</dt><dd>{drawer.d.status.replace("_", " ").toLowerCase()}</dd></div>
              <div><dt>Fill price</dt><dd>{drawer.d.decision === "APPROVED" ? usd(drawer.d.fillPrice) : "none"}</dd></div>
              <div><dt>Quantity</dt><dd>{drawer.d.decision === "APPROVED" ? drawer.d.quantity : "none"}</dd></div>
              <div><dt>Result</dt><dd>{usd(drawer.d.pnlUsd)}</dd></div>
              <div><dt>Order id</dt><dd>{drawer.d.orderId || "none"}</dd></div>
            </dl>
            <dl className="db-hashes">
              <div><dt>Receipt hash</dt><dd data-testid="record-receipt-hash">{drawer.d.receiptHash}</dd></div>
              <div><dt>Evidence hash</dt><dd>{drawer.d.evidenceHash}</dd></div>
            </dl>
            <p className="db-foot">
              This log keeps the hashes, not the receipt bodies, so it can't be re-verified here. Sandbox receipts can: run a
              scenario and try tampering.
            </p>
          </div>
        ) : (
          <div className="db-drawer-body">
            <ResultPanel run={drawer.run} />
          </div>
        )}
      </aside>
    </div>
  );
}
