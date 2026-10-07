/**
 * Phase 1 — read-only benchmark evidence page.
 *
 * Makes the evidence visible: provenance, freshness, symbol mapping,
 * regime-aware carry, and the Quant verdict. Deliberately NOT a strategy
 * console — there are no order, size, dispatch or authorization controls on
 * this page, and the backend response types `executable` as the literal
 * `false` so it cannot be rendered as a green light.
 *
 * SEPARATION FROM THE VENUE LIFECYCLE
 *   The Bitget Demo dispatcher lifecycle lives at #/desk. This page is the
 *   benchmark pre-flight only. The two are proven separately and are NOT
 *   end-to-end connected; `bridge.packetToDispatch` reports that gap and is
 *   rendered verbatim below.
 */
import { useCallback, useEffect, useState } from "react";
import { fetchEvidence, type EvidenceResponse } from "../lib/api";

function fmt(n: number | null | undefined, dp = 6): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(dp) : "—";
}

function fmtPct(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(4) + "%" : "—";
}

function fmtAge(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(2)}m`;
  return `${(ms / 3_600_000).toFixed(2)}h`;
}

function Field(props: { label: string; value: string; mono?: boolean; testId?: string; tone?: "ok" | "warn" | "bad" }) {
  const tone =
    props.tone === "ok"
      ? "text-[var(--accent)]"
      : props.tone === "warn"
        ? "text-amber-400 text-amber-700"
        : props.tone === "bad"
          ? "text-[var(--danger)]"
          : "text-zinc-100";
  return (
    <div className="border-t border-[var(--line)] py-2">
      <dt className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">{props.label}</dt>
      <dd data-testid={props.testId} className={`break-all text-xs ${props.mono === false ? "" : "mono"} ${tone}`}>
        {props.value}
      </dd>
    </div>
  );
}

export function EvidencePage() {
  const [ev, setEv] = useState<EvidenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [transportError, setTransportError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setTransportError(null);
    try {
      setEv(await fetchEvidence());
    } catch (e) {
      setTransportError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const b = ev?.benchmark ?? null;
  const f = ev?.freshness ?? null;
  const q = ev?.quant ?? null;

  return (
    <div className="lv2 min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <div className="border-b border-[var(--line)] bg-[oklch(0.15_0.012_265_/_0.88)] backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-6 py-3">
          <a href="#/" className="mono text-xs text-[var(--text-muted)] hover:text-white transition-colors">← MONEY BOYS</a>
          <span className="mono text-xs text-[var(--text-muted)]">
            <a href="#/evidence" className="text-[var(--accent)] font-bold">MARKET AUDIT</a>
            {" · "}
            <a href="#/desk" className="hover:text-white transition-colors">BITGET DEMO LIFECYCLE</a>
          </span>
        </div>
      </div>

      <div className="border-b border-[var(--line)] bg-[oklch(0.12_0.012_265)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-6 py-2.5">
          <span
            data-testid="authority-label"
            className="inline-flex items-center rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 mono text-[11px] font-bold uppercase tracking-widest text-amber-300"
          >
            read-only · no execution authority
          </span>
          <span className="mono text-[11px] text-[var(--text-muted)]">
            benchmark pre-flight only — not connected end-to-end to the venue lifecycle
          </span>
          <span className="flex-1" />
          <button
            data-testid="reload-evidence"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg border border-[var(--line)] bg-[oklch(0.20_0.015_265)] px-3 py-1 mono text-[11px] text-zinc-200 hover:border-[var(--accent)] hover:text-white disabled:opacity-40 transition-colors cursor-pointer"
          >
            {loading ? "reading…" : "re-read benchmark"}
          </button>
        </div>
      </div>

      <main className="mx-auto max-w-6xl space-y-5 px-6 py-8">
        {transportError && (
          <section data-testid="evidence-transport-error" className="rounded-2xl border border-rose-500/40 bg-rose-950/20 p-5 backdrop-blur-md">
            <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--danger)]">Engine unreachable</h2>
            <p className="mt-1 mono text-xs text-[var(--danger)]">{transportError}</p>
            <p className="mt-2 text-xs text-[var(--text-muted)]">No benchmark was read and no verdict was produced.</p>
          </section>
        )}

        {!transportError && !ev && <p data-testid="evidence-loading" className="mono text-xs text-[var(--text-muted)]">reading benchmark…</p>}

        {ev && (
          <>
            <section
              data-testid="evidence-verdict"
              className={`rounded-2xl border p-5 backdrop-blur-md ${
                ev.status === "ok"
                  ? "border-[var(--line)] bg-[oklch(0.18_0.014_265_/_0.7)]"
                  : ev.status === "unusable"
                    ? "border-amber-500/30 bg-amber-950/20"
                    : "border-rose-500/30 bg-rose-950/20"
              }`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Benchmark pre-flight verdict</h1>
                <span
                  data-testid="evidence-status"
                  className={`inline-flex items-center rounded-full border px-3 py-1 mono text-[11px] font-bold uppercase ${
                    ev.status === "ok"
                      ? "border-emerald-500/30 bg-emerald-950/40 text-emerald-400"
                      : ev.status === "unusable"
                        ? "border-amber-500/30 bg-amber-950/40 text-amber-400"
                        : "border-rose-500/30 bg-rose-950/40 text-rose-400"
                  }`}
                >
                  {ev.status}
                </span>
                <span className="flex-1" />
                <span className="mono text-[11px] text-[var(--text-muted)]">
                  quant evaluated: <span data-testid="quant-evaluated">{q !== null ? "yes" : "no"}</span>
                </span>
                <span
                  data-testid="executable-state"
                  className="inline-flex items-center rounded-full border border-[var(--line)] bg-[oklch(0.14_0.012_265)] px-3 py-1 mono text-[11px] font-bold uppercase text-[var(--text-muted)]"
                >
                  executable: {String(ev.executable)}
                </span>
              </div>
              <p data-testid="execution-authority" className="mt-2 mono text-[11px] text-[var(--text-muted)]">
                execution authority: {ev.executionAuthority} · packet→dispatch bridge: {ev.bridge.packetToDispatch}
              </p>
              {ev.blockingReasons.length > 0 && (
                <ul data-testid="blocking-reasons" className="mt-2 space-y-1">
                  {ev.blockingReasons.map((r, i) => (
                    <li key={i} className="mono text-[11px] text-rose-400">• {r}</li>
                  ))}
                </ul>
              )}
            </section>

            {ev.error && (
              <section data-testid="evidence-error" className="rounded-2xl border border-rose-500/30 bg-rose-950/20 p-5 backdrop-blur-md">
                <h2 className="text-xs font-bold uppercase tracking-widest text-rose-400">Benchmark read failed</h2>
                <p className="mt-1 mono text-xs text-rose-300">{ev.error.code}: {ev.error.message}</p>
              </section>
            )}

            <div className="grid gap-5 md:grid-cols-2">
              <section className="rounded-2xl border border-[var(--line)] bg-[oklch(0.18_0.014_265_/_0.65)] p-5 backdrop-blur-md">
                <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Provenance</h2>
                <dl className="mt-2">
                  <Field label="provider" value={b?.provider ?? "—"} testId="provider" />
                  <Field label="symbol (provider)" value={b?.symbol ?? "—"} testId="provider-symbol" />
                  <Field
                    label="sourceAsOf (provider published)"
                    value={b?.sourceAsOf ?? "—"}
                    testId="source-asof"
                    tone={b ? "ok" : "bad"}
                  />
                  <Field label="requestedAt (local request start)" value={b?.requestedAt ?? "—"} testId="requested-at" />
                  <Field label="responseReceivedAt (local receipt)" value={b?.responseReceivedAt ?? "—"} testId="response-received-at" />
                  <Field label="fetchedAt (= requestedAt)" value={b?.fetchedAt ?? "—"} testId="fetched-at" />
                  <Field label="timestampType" value={b?.timestampType ?? "—"} testId="timestamp-type" />
                  <Field label="trading halt" value={b ? (b.isTradingHalt ? "HALTED" : "no") : "—"} testId="halt-status" tone={b?.isTradingHalt ? "bad" : "ok"} />
                  <Field label="price basis" value={b?.priceBasis ?? "—"} testId="price-basis" mono={false} />
                  <Field label="multiplier applied to price" value={b ? String(b.multiplierAppliedToPrice) : "—"} testId="multiplier-applied" />
                </dl>
              </section>

              <section className="rounded-2xl border border-[var(--line)] bg-[oklch(0.18_0.014_265_/_0.65)] p-5 backdrop-blur-md">
                <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Quote &amp; freshness</h2>
                <dl className="mt-2">
                  <Field label="bid" value={fmt(b?.bid, 3)} testId="bid" />
                  <Field label="ask" value={fmt(b?.ask, 3)} testId="ask" />
                  <Field label="midpoint" value={fmt(b?.midpoint, 3)} testId="midpoint" />
                  <Field
                    label="age at receipt (ADMISSION BASIS)"
                    value={fmtAge(f?.ageAtReceiptMs)}
                    testId="freshness-age"
                    tone={f?.status === "verified_fresh" ? "ok" : f?.status === "verified_stale" ? "warn" : "bad"}
                  />
                  <Field
                    label="age at request start (diagnostics only)"
                    value={fmtAge(f?.ageAtRequestStartMs)}
                    testId="freshness-age-at-request-start"
                    tone="warn"
                  />
                  <Field label="receipt latency (responseReceivedAt − requestedAt)" value={fmtAge(f?.receiptLatencyMs)} testId="receipt-latency" />
                  <Field label="freshness basis" value={f?.freshnessBasis ?? "—"} testId="freshness-basis" />
                  <Field
                    label="decision"
                    value={ev.decision}
                    testId="decision"
                    tone={ev.decision === "NO_TRADE" ? "warn" : "ok"}
                  />
                  <Field
                    label="closed-session policy"
                    value={ev.gate.policy}
                    testId="closed-session-policy"
                  />
                  <Field
                    label="closed-session veto"
                    value={ev.gate.closedSessionVeto ?? "none — TradFi open"}
                    testId="closed-session-veto"
                    tone={ev.gate.closedSessionVeto ? "warn" : "ok"}
                    mono={false}
                  />
                  <Field label="effective freshness gate (provider cache limit)" value={fmtAge(f?.effectiveThresholdMs)} testId="freshness-effective-threshold" />
                  <Field
                    label="inherited benchmark max age (NOT the gate)"
                    value={fmtAge(f?.inheritedBenchmarkMaxAgeMs)}
                    testId="freshness-inherited-threshold"
                    tone="warn"
                  />
                  <Field
                    label="freshness status"
                    value={f?.status ?? "—"}
                    testId="freshness-status"
                    tone={f?.status === "verified_fresh" ? "ok" : f?.status === "verified_stale" ? "warn" : "bad"}
                  />
                </dl>
              </section>

              <section className="rounded-2xl border border-[var(--line)] bg-[oklch(0.18_0.014_265_/_0.65)] p-5 backdrop-blur-md">
                <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Symbol mapping</h2>
                <dl className="mt-2">
                  <Field label="repo symbol" value={ev.symbolMapping.repoSymbol} testId="map-repo" />
                  <Field label="venue symbol" value={ev.symbolMapping.venueSymbol} testId="map-venue" />
                  <Field label="reference symbol" value={ev.symbolMapping.referenceSymbol} testId="map-reference" />
                </dl>
              </section>

              <section className="rounded-2xl border border-[var(--line)] bg-[oklch(0.18_0.014_265_/_0.65)] p-5 backdrop-blur-md">
                <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Regime &amp; carry</h2>
                <dl className="mt-2">
                  <Field label="regime" value={ev.regime.regime} testId="regime" />
                  <Field label="carry horizon (h to reopen)" value={String(ev.regime.hoursToNextReopen)} testId="carry-horizon" />
                  <Field label="next reopen (ET)" value={ev.regime.nextReopenAtIso ?? "—"} testId="next-reopen" />
                  <Field label="required benchmark source" value={ev.regime.requiredBenchmarkSource} testId="required-source" />
                  <Field label="holiday calendar" value={ev.regime.holidayCalendarSupported ? "supported" : "not modelled (GAP-017)"} testId="holiday-support" tone="warn" />
                </dl>
              </section>

              <section className="rounded-2xl border border-[var(--line)] bg-[oklch(0.18_0.014_265_/_0.65)] p-5 backdrop-blur-md md:col-span-2">
                <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Quant verdict</h2>
                {q === null ? (
                  <p data-testid="quant-null" className="mt-2 mono text-xs text-[var(--text-muted)]">
                    Quant did not run. {ev.gate.blockedReason ?? "The benchmark gate blocked evaluation."}
                  </p>
                ) : (
                  <dl className="mt-2">
                    <Field label="verdict" value={q.action} testId="quant-action" tone={q.action === "NEUTRAL" ? "warn" : "ok"} />
                    <Field label="basis" value={fmtPct(q.rawBasisPct)} testId="basis" />
                    <Field label="hurdle" value={fmtPct(q.hurdleRatePct)} testId="hurdle" />
                    <Field label="net edge" value={fmtPct(q.netEdgePct)} testId="net-edge" tone={q.netEdge > 0 ? "ok" : "warn"} />
                    <Field label="token price" value={fmt(q.tokenPrice, 4)} testId="token-price" />
                    <Field label="benchmark price" value={fmt(q.benchmarkPrice, 4)} testId="benchmark-price" />
                    <Field label="quant score" value={fmt(q.quantScore, 2)} testId="quant-score" />
                  </dl>
                )}
                <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
                  A verdict on this page is an observation, not an instruction. It cannot be acted on from here.
                </p>
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
