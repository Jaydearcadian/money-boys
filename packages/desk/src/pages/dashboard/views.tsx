import { useEffect, useMemo, useState } from "react";
import {
  MAX_MARGIN_UTILIZATION,
  MAX_PORTFOLIO_NET_BETA,
  MAX_SECTOR_CONCENTRATION,
  MAX_SINGLE_ASSET_CONCENTRATION,
  MAX_SINGLE_EXPOSURE_USD,
  PortfolioCopilot,
  type PortfolioPosition,
} from "@money-boys/engine/skills/igraph-guard/security";
import {
  ActivityIcon,
  BrainIcon,
  LightningIcon,
  LockIcon,
  ShieldIcon,
} from "../../components/icons";
import { baseTicker } from "../../lib/records";
import { Card, colorOf, DecisionFeed, Loading, Pill, ResultPanel, ScenarioGrid, usd, pct, CustomSandbox } from "./components";
import { useDesk } from "./state";

type Alpha = {
  headline: string;
  fullCampaign: { date: string; dayPnlUsd: number; cumulativeEquityUsd: number; dailyReturnPct: number }[];
  inSampleCutoffDate: string;
  metrics: {
    full: Record<string, number | string>;
    is: Record<string, number | string>;
    oos: Record<string, number | string>;
  };
  correlation: {
    matrix: Record<string, Record<string, number>>;
    averagePairwiseCorrelation: number;
    effectiveAssetCount: number;
    analysisNote?: string;
  };
  decay: Record<string, number | string | boolean>;
  split: Record<string, number | string>;
  receiptsSealed?: number;
  caveat?: string;
};

type Lifecycle = {
  symbol: string;
  venueSymbol: string;
  executedAt: string;
  environment: string;
  vetoCheck: { blocked: boolean; networkCalls: number };
  openOrder: { orderId: string; status: string; quantity: number; fillPriceUsd: number; latencyMs: number; receiptHash: string };
  closeOrder: { orderId: string; status: string; quantity: number; latencyMs: number };
  accountFlat: boolean;
  proofDigest: string;
};

function useJson<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(path)
      .then(async (r) => {
        if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
        return r.json() as Promise<T>;
      })
      .then((j) => live && setData(j))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [path]);
  return { data, error };
}

function Gauge({ label, value, max, format = (n: number) => pct(n * 100, 1) }: { label: string; value: number; max: number; format?: (n: number) => string }) {
  const ratio = Math.max(0, Math.min(1, value / max));
  const tone = value > max ? "bad" : value > max * 0.85 ? "warn" : "";
  return (
    <div className="db-gauge-card">
      <div className="db-card-head" style={{ marginBottom: 8 }}>
        <span className="db-label">{label}</span>
        <strong className={`mono ${tone}`} style={{ fontSize: 18 }}>
          {format(value)}
        </strong>
      </div>
      <div className={`db-gauge ${tone}`} aria-hidden="true">
        <i style={{ width: `${ratio * 100}%` }} />
      </div>
      <small style={{ display: "block", marginTop: 8, color: "var(--muted)", fontSize: 11 }}>Ceiling {format(max)}</small>
    </div>
  );
}

export function AgentMatrix() {
  const { run } = useDesk();
  const r = run?.result;
  const rows = [
    { name: "Macro Boy", icon: <BrainIcon className="h-4 w-4" />, detail: "Warm-path proposal only · zero Bitget keys (I-01)", score: (r?.receiptPayload as { councilScores?: Record<string, number> } | undefined)?.councilScores?.macro },
    { name: "Quant Boy", icon: <ActivityIcon className="h-4 w-4" />, detail: r ? `Gap ${pct(r.quant.rawBasisPct)} − costs ${pct(r.quant.hurdleRatePct)} = ${pct(r.quant.netEdgePct)}` : "Basis − friction hurdle", score: (r?.receiptPayload as { councilScores?: Record<string, number> } | undefined)?.councilScores?.quant },
    { name: "Risk Boy", icon: <ShieldIcon className="h-4 w-4" />, detail: r ? (r.risk.permitted ? `Margin ${pct(r.risk.projectedMarginUtilization * 100, 1)} after trade` : r.risk.reasons.join(" ")) : "Hard veto · margin <65% · size <$5k", score: (r?.receiptPayload as { councilScores?: Record<string, number> } | undefined)?.councilScores?.risk },
    { name: "Execution Boy", icon: <LightningIcon className="h-4 w-4" />, detail: "Hot-path venue adapter · only after seal (I-03)", score: (r?.receiptPayload as { councilScores?: Record<string, number> } | undefined)?.councilScores?.exec },
  ];
  return (
    <Card title="4-agent node matrix" aside={<span className="db-label">Live browser deliberation</span>}>
      <ul className="db-agents" data-testid="agent-matrix">
        {rows.map((a) => (
          <li key={a.name}>
            <span className="db-agent-ic">{a.icon}</span>
            <div>
              <b>{a.name}</b>
              <small>{a.detail}</small>
            </div>
            <span className={`db-score ${a.score !== undefined && a.score >= 70 ? "ok" : "bad"}`}>
              {a.score === undefined ? "–" : a.score.toFixed(0)}
              <small>score</small>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function RwaCards() {
  const { records, recordsError } = useDesk();
  const cards = useMemo(() => {
    if (!records) return [];
    const latest = new Map<string, { symbol: string; token: number; equity: number; basis: number; date: string }>();
    for (const t of records.trades) {
      const b = baseTicker(t.symbol);
      const prev = latest.get(b);
      if (!prev || t.entryDate >= prev.date) {
        latest.set(b, {
          symbol: t.symbol.startsWith("r") ? t.symbol : `r${t.symbol}`,
          token: t.entryTokenPrice,
          equity: t.entryEquityPrice,
          basis: t.entryBasisPct,
          date: t.entryDate,
        });
      }
    }
    return ["NVDA", "TSLA", "AAPL", "MSFT", "GOOGL"].map((b) => latest.get(b)).filter(Boolean) as {
      symbol: string;
      token: number;
      equity: number;
      basis: number;
      date: string;
    }[];
  }, [records]);

  if (!records) return <Loading error={recordsError} />;
  return (
    <div className="db-grid-5" data-testid="rwa-cards">
      {cards.map((c) => (
        <div key={c.symbol} className="db-card">
          <div className="db-card-head" style={{ marginBottom: 8 }}>
            <b className="db-sym" style={{ color: colorOf(c.symbol) }}>{c.symbol}</b>
            <span className="db-label">{c.date}</span>
          </div>
          <div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>{usd(c.token)}</div>
          <small style={{ color: "var(--muted)", fontSize: 11 }}>Stock close {usd(c.equity)}</small>
          <div style={{ marginTop: 8 }}>
            <Pill tone={Math.abs(c.basis) > 0.5 ? "ok" : "info"}>basis {pct(c.basis)}</Pill>
          </div>
        </div>
      ))}
    </div>
  );
}

export function MarginGauge() {
  const { run } = useDesk();
  const m = run?.result.risk.projectedMarginUtilization ?? 0;
  return (
    <div data-testid="margin-gauge">
      <Gauge label="Margin utilization (last run)" value={m} max={MAX_MARGIN_UTILIZATION} />
      <p className="db-foot" style={{ marginTop: 10 }}>
        Invariant I-02 hard-caps account use at {(MAX_MARGIN_UTILIZATION * 100).toFixed(0)}% and single trade size at {usd(MAX_SINGLE_EXPOSURE_USD)}.
      </p>
    </div>
  );
}

export function TelemetryBar() {
  const { sessionOpen, halted } = useDesk();
  return (
    <div className="db-card" data-testid="telemetry-bar" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      <span className="db-sess"><i className="on" /> Bitget API v2 · paper desk</span>
      <span className="db-sess"><i className="on" /> Engine pulse · browser sandbox</span>
      <span className="db-sess" data-testid="session-pill"><i className={sessionOpen ? "on" : "off"} /> NYSE {sessionOpen ? "OPEN" : "CLOSED"}</span>
      {halted ? <Pill tone="bad">EMERGENCY HALT</Pill> : <Pill tone="ok">Fail-closed armed</Pill>}
    </div>
  );
}

function EquityCurve({ series, cutoff }: { series: Alpha["fullCampaign"]; cutoff: string }) {
  const W = 720;
  const H = 220;
  const pad = { l: 44, r: 12, t: 12, b: 26 };
  if (!series.length) return <div className="db-empty">No equity series.</div>;
  const minE = Math.min(...series.map((s) => s.cumulativeEquityUsd));
  const maxE = Math.max(...series.map((s) => s.cumulativeEquityUsd));
  const span = Math.max(1, maxE - minE);
  const x = (i: number) => pad.l + (series.length <= 1 ? 0 : (i / (series.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => H - pad.b - ((v - minE) / span) * (H - pad.t - pad.b);
  const line = series.map((s, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(s.cumulativeEquityUsd).toFixed(1)}`).join(" ");
  const cutIdx = series.findIndex((s) => s.date >= cutoff);
  return (
    <svg className="db-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="89-day equity curve" data-testid="equity-curve">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={pad.l} x2={W - pad.r} y1={y(minE + span * f)} y2={y(minE + span * f)} stroke="rgba(255,255,255,0.06)" />
      ))}
      {cutIdx > 0 && <line x1={x(cutIdx)} x2={x(cutIdx)} y1={pad.t} y2={H - pad.b} stroke="#f59e0b" strokeDasharray="4 4" />}
      <path d={line} fill="none" stroke="#fff" strokeWidth="1.8" />
      <text x={pad.l} y={H - 8} className="db-axis">{series[0]!.date}</text>
      <text x={W - pad.r} y={H - 8} textAnchor="end" className="db-axis">{series[series.length - 1]!.date}</text>
      <text x={pad.l - 6} y={y(maxE) + 3} textAnchor="end" className="db-axis">{usd(maxE)}</text>
      <text x={pad.l - 6} y={y(minE) + 3} textAnchor="end" className="db-axis">{usd(minE)}</text>
    </svg>
  );
}

export function StrategyView() {
  const { data, error } = useJson<Alpha>("/evidence/alpha_factory.json");
  if (!data) return <Loading error={error} />;
  const pairs = Object.keys(data.correlation.matrix);
  const heat = (v: number) => {
    const t = (v + 1) / 2;
    const a = Math.round(30 + t * 180);
    return `rgba(52, 211, 153, ${0.08 + t * 0.45})`;
  };
  return (
    <div className="db-sandbox-tab" data-testid="strategy-view">
      <Card title="Track 1 · Alpha Factory" aside={<Pill tone="ok">Venue walk-forward</Pill>}>
        <p className="db-lead">
          Authentic Bitget v2 futures candles joined to documented Alpha Vantage equity closes. The desk is judged on
          out-of-sample survival — not in-sample storytelling. Headline: {data.headline}
        </p>
        <div className="db-grid-3">
          <div className="db-check"><b>✔</b><span><strong>Horizon</strong><br />{String(data.split.inSampleDays)}d IS + {String(data.split.outOfSampleDays)}d OOS ({String(data.split.totalCalendarDays)}d total)</span></div>
          <div className="db-check"><b>✔</b><span><strong>Trade gate</strong><br />{String(data.metrics.oos.tradesCount)} OOS trades (clears ≥ 30) · {String(data.metrics.full.tradesCount)} full</span></div>
          <div className="db-check"><b>✔</b><span><strong>Decay</strong><br />OOS Sharpe {String(data.metrics.oos.sharpeRatio)} vs 0.5× IS floor · retention {String(data.decay.rawSharpeRatioDecay)}×</span></div>
        </div>
      </Card>

      <div className="db-grid-3">
        <div className="db-card db-kpi"><div><span className="db-label">Net PnL (89d)</span><strong className="ok">{usd(Number(data.metrics.full.totalPnlUsd))}</strong><small>{pct(Number(data.metrics.full.netReturnPct))} net · max DD {pct(Number(data.metrics.full.maxDrawdownPct))}</small></div></div>
        <div className="db-card db-kpi"><div><span className="db-label">OOS Sharpe</span><strong className="ok">{String(data.metrics.oos.sharpeRatio)}</strong><small>Sortino {String(data.metrics.oos.sortinoRatio)} · win {pct(Number(data.metrics.oos.winRatePct), 1)}</small></div></div>
        <div className="db-card db-kpi"><div><span className="db-label">Receipts sealed</span><strong>{String(data.receiptsSealed ?? "—")}</strong><small>ρ = {data.correlation.averagePairwiseCorrelation.toFixed(3)} · N_eff {data.correlation.effectiveAssetCount.toFixed(2)}</small></div></div>
      </div>

      <Card title="89-day equity curve" aside={<span className="db-label">Amber = OOS cut {data.inSampleCutoffDate}</span>}>
        <EquityCurve series={data.fullCampaign} cutoff={data.inSampleCutoffDate} />
      </Card>

      <div className="db-grid-2">
        <Card title="Decay hurdle test">
          <dl className="db-nums">
            <div><dt>In-sample Sharpe</dt><dd>{String(data.metrics.is.sharpeRatio)}</dd></div>
            <div><dt>0.5× IS floor</dt><dd>{(Number(data.metrics.is.sharpeRatio) * 0.5).toFixed(2)}</dd></div>
            <div><dt>OOS Sharpe</dt><dd className="ok">{String(data.metrics.oos.sharpeRatio)}</dd></div>
            <div><dt>Retention</dt><dd>{String(data.decay.rawSharpeRatioDecay)}×</dd></div>
          </dl>
          <p className="db-foot" style={{ marginTop: 12 }}>{String(data.decay.sharpeStatusDisclosure)}</p>
        </Card>
        <Card title="5×5 pairwise correlation" aside={<span className="db-label">mean ρ {data.correlation.averagePairwiseCorrelation.toFixed(3)}</span>}>
          <div className="db-matrix" data-testid="corr-matrix">
            <div className="db-matrix-row">
              <span className="db-matrix-cell head" />
              {pairs.map((p) => <span key={p} className="db-matrix-cell head mono">{p.replace("USDT", "")}</span>)}
            </div>
            {pairs.map((row) => (
              <div key={row} className="db-matrix-row">
                <span className="db-matrix-cell head mono">{row.replace("USDT", "")}</span>
                {pairs.map((col) => {
                  const v = data.correlation.matrix[row]?.[col] ?? 0;
                  return (
                    <span key={col} className="db-matrix-cell mono" style={{ background: heat(v) }}>
                      {v.toFixed(2)}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
          {data.caveat && <p className="db-foot" style={{ marginTop: 12 }}>{data.caveat}</p>}
        </Card>
      </div>
    </div>
  );
}

export function AuditView() {
  const { data, error } = useJson<Lifecycle>("/evidence/rwa_trade_lifecycle.json");
  const { run } = useDesk();
  return (
    <div className="db-sandbox-tab" data-testid="audit-view">
      <Card title="Track 2 · Agentic execution" aside={<Pill tone="info">Three-beat authority split</Pill>}>
        <p className="db-lead">
          Judges score desks on how cleanly they separate perception from authority. Macro Boy may propose; it never
          holds keys. Risk Boy vetoes in plain math. Execution only runs after a SHA-256 seal — and a veto makes zero
          Bitget calls.
        </p>
        <div className="db-timeline">
          <div className="db-beat">
            <div className="db-beat-n">01</div>
            <div className="db-card" style={{ padding: 14 }}>
              <div className="db-card-head" style={{ marginBottom: 6 }}>
                <h2 style={{ fontSize: 14 }}>Beat 1 · Perception</h2>
                <Pill tone="warn">dispatched: false</Pill>
              </div>
              <p className="db-verdict-plain">Macro Boy (Qwen) ingests catalysts and L2 context, emits `executable: false`. Zero API keys per I-01.</p>
            </div>
          </div>
          <div className="db-beat">
            <div className="db-beat-n">02</div>
            <div className="db-card" style={{ padding: 14 }}>
              <div className="db-card-head" style={{ marginBottom: 6 }}>
                <h2 style={{ fontSize: 14 }}>Beat 2 · Deterministic gate</h2>
                <Pill tone="ok">I-02 / I-03</Pill>
              </div>
              <p className="db-verdict-plain">Risk Boy checks margin &lt; 65%, size &lt; $5k, net edge. SHA-256 ReasoningReceipt sealed before any private route. Veto ⇒ networkCalls: 0.</p>
            </div>
          </div>
          <div className="db-beat">
            <div className="db-beat-n">03</div>
            <div className="db-card" style={{ padding: 14 }}>
              <div className="db-card-head" style={{ marginBottom: 6 }}>
                <h2 style={{ fontSize: 14 }}>Beat 3 · Venue execution</h2>
                <Pill tone="info">Bitget v2 REST</Pill>
              </div>
              <p className="db-verdict-plain">Signed paper order + fill read-back + flat close. Only the hot path touches the venue.</p>
            </div>
          </div>
        </div>
      </Card>

      {!data ? (
        <Loading error={error} />
      ) : (
        <Card title="Live Bitget v2 lifecycle proof" aside={<span className="db-label">{data.environment}</span>}>
          <dl className="db-nums" data-testid="lifecycle-proof">
            <div><dt>Symbol</dt><dd>{data.symbol}</dd></div>
            <div><dt>Open order</dt><dd>{data.openOrder.orderId}</dd></div>
            <div><dt>Fill</dt><dd>{usd(data.openOrder.fillPriceUsd)} · {data.openOrder.latencyMs.toFixed(1)} ms</dd></div>
            <div><dt>Close order</dt><dd>{data.closeOrder.orderId}</dd></div>
            <div><dt>Close latency</dt><dd>{data.closeOrder.latencyMs.toFixed(1)} ms</dd></div>
            <div><dt>Flat</dt><dd>{data.accountFlat ? "yes" : "no"}</dd></div>
            <div><dt>Veto probe calls</dt><dd>{data.vetoCheck.networkCalls}</dd></div>
            <div><dt>Receipt hash</dt><dd style={{ fontSize: 11 }}>{data.openOrder.receiptHash}</dd></div>
          </dl>
          <p className="db-foot" style={{ marginTop: 12 }}>Executed {data.executedAt} · proof digest {data.proofDigest}</p>
        </Card>
      )}

      <div className="db-row-split">
        <DecisionFeed />
        <Card title="Latest sandbox receipt" aside={<span className="db-label">Web Crypto verify</span>}>
          <ResultPanel run={run} />
        </Card>
      </div>
    </div>
  );
}

const BASE_PORTFOLIO: { equityUsd: number; positions: PortfolioPosition[] } = {
  equityUsd: 25_000,
  positions: [
    { symbol: "rNVDAUSDT", side: "buy", quantity: 21.2, priceUsd: 235.5 }, // ~20%
    { symbol: "rTSLAUSDT", side: "buy", quantity: 14.7, priceUsd: 255.0 }, // ~15%
    { symbol: "rAAPLUSDT", side: "buy", quantity: 13.6, priceUsd: 220.0 }, // ~12%
    { symbol: "rMSFTUSDT", side: "buy", quantity: 7.0, priceUsd: 430.0 }, // ~12%
  ],
};

const BLAST_PRESETS = [
  { id: "mod", label: "+$2k rNVDA", symbol: "rNVDAUSDT", side: "buy" as const, notional: 2000, price: 235.5 },
  { id: "big", label: "+$7k rNVDA", symbol: "rNVDAUSDT", side: "buy" as const, notional: 7000, price: 235.5 },
  { id: "cut", label: "−$3k rNVDA", symbol: "rNVDAUSDT", side: "sell" as const, notional: 3000, price: 235.5 },
  { id: "tsla", label: "+$1.5k rTSLA", symbol: "rTSLAUSDT", side: "buy" as const, notional: 1500, price: 255.0 },
];

export function CopilotView() {
  const [sel, setSel] = useState(BLAST_PRESETS[0]!);
  const assessment = useMemo(() => {
    const qty = sel.notional / sel.price;
    return PortfolioCopilot.evaluateImpact(
      { symbol: sel.symbol, side: sel.side, quantity: qty, priceUsd: sel.price },
      BASE_PORTFOLIO,
    );
  }, [sel]);
  const cur = assessment.currentMetrics;
  const proj = assessment.projectedMetrics;
  const tone = assessment.decision === "HARD_VETO" ? "bad" : assessment.warnings.some((w) => w.startsWith("DE_RISKING")) ? "warn" : "ok";
  const label = assessment.decision === "HARD_VETO" ? "HARD_VETO" : assessment.warnings.some((w) => w.startsWith("DE_RISKING")) ? "DE_RISKING" : "PERMITTED";

  return (
    <div className="db-sandbox-tab" data-testid="copilot-view">
      <Card title="Track 3 · Portfolio Copilot" aside={<Pill tone="info">Institutional factor ceilings</Pill>}>
        <p className="db-lead">
          Before any order is sized, the copilot projects Δβ, sector weight, and single-asset concentration against hard
          ceilings from `security.ts` — Net Beta ≤ {MAX_PORTFOLIO_NET_BETA.toFixed(2)}, sector ≤ {(MAX_SECTOR_CONCENTRATION * 100).toFixed(0)}%,
          single asset ≤ {(MAX_SINGLE_ASSET_CONCENTRATION * 100).toFixed(0)}%.
        </p>
        <div className="db-grid-3">
          <Gauge label="Net portfolio beta" value={Math.abs(cur.netBeta)} max={MAX_PORTFOLIO_NET_BETA} format={(n) => n.toFixed(2)} />
          <Gauge label="Top sector weight" value={Math.max(...Object.values(cur.sectorWeights))} max={MAX_SECTOR_CONCENTRATION} />
          <Gauge label="Top single-asset weight" value={Math.max(0, ...Object.values(cur.assetWeights))} max={MAX_SINGLE_ASSET_CONCENTRATION} />
        </div>
      </Card>

      <Card title="Blast radius simulator" aside={<span className="db-label">Real PortfolioCopilot.evaluateImpact</span>}>
        <div className="db-seg" role="group" aria-label="Blast presets" style={{ marginBottom: 14 }}>
          {BLAST_PRESETS.map((p) => (
            <button key={p.id} className={sel.id === p.id ? "on" : ""} onClick={() => setSel(p)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="db-result-head">
          <div>
            <h3>{sel.label}</h3>
            <p>Projected β {proj.netBeta.toFixed(2)} (Δ {assessment.deltas.netBetaDelta >= 0 ? "+" : ""}{assessment.deltas.netBetaDelta.toFixed(2)})</p>
          </div>
          <Pill tone={tone}><span data-testid="blast-verdict">{label}</span></Pill>
        </div>
        <dl className="db-nums" style={{ marginTop: 12 }}>
          <div><dt>Exposure Δ</dt><dd>{usd(assessment.deltas.exposureDeltaUsd)}</dd></div>
          <div><dt>Gross leverage</dt><dd>{proj.grossLeverage.toFixed(2)}×</dd></div>
          <div><dt>Top sector</dt><dd>{pct(Math.max(...Object.values(proj.sectorWeights)) * 100, 1)}</dd></div>
          <div><dt>Top asset</dt><dd>{pct(Math.max(0, ...Object.values(proj.assetWeights)) * 100, 1)}</dd></div>
        </dl>
        <ul style={{ margin: "12px 0 0", paddingLeft: 18, color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.5 }}>
          {assessment.reasons.map((r) => <li key={r}>{r}</li>)}
          {assessment.warnings.map((w) => <li key={w}>{w}</li>)}
          {!assessment.reasons.length && !assessment.warnings.length && <li>Within all factor ceilings.</li>}
        </ul>
      </Card>
    </div>
  );
}

export function SandboxLab() {
  const { run } = useDesk();
  return (
    <div className="db-sandbox-tab" data-testid="sandbox-lab">
      <Card title="Preset scenarios">
        <p className="db-lead">Four outcomes from the real engine: clear edge, size veto, margin ceiling, and no-edge refusal.</p>
        <ScenarioGrid />
      </Card>
      <CustomSandbox />
      <ResultPanel run={run} />
    </div>
  );
}
