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
    props.tone === "ok" ? "text-emerald-700" : props.tone === "warn" ? "text-amber-700" : props.tone === "bad" ? "text-rose-700" : "text-zinc-950";
  return (
    <div className="border-t border-zinc-100 py-1.5">
      <dt className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">{props.label}</dt>
      <dd data-testid={props.testId} className={`break-all text-xs ${props.mono === false ? "" : "font-mono"} ${tone}`}>
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
    <div className="min-h-screen" style={{ backgroundColor: "#FAF9F5" }}>
      <div className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-6 py-3">
          <a href="#/" className="font-mono text-xs text-zinc-500 hover:text-orange-600">← MONEY BOYS</a>
          <span className="font-mono text-xs text-zinc-500">
            <a href="#/evidence" className="text-orange-600">EVIDENCE</a>
            {" · "}
            <a href="#/desk" className="hover:text-orange-600">BITGET DEMO LIFECYCLE</a>
          </span>
        </div>
      </div>

      <div className="border-b border-zinc-200 bg-zinc-950">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-6 py-2.5">
          <span
            data-testid="authority-label"
            className="inline-flex items-center rounded-full border border-amber-300 bg-amber-400/10 px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-widest text-amber-200"
          >
            read-only · no execution authority
          </span>
          <span className="font-mono text-[11px] text-zinc-400">
            benchmark pre-flight only — not connected end-to-end to the venue lifecycle
          </span>
          <span className="flex-1" />
          <button
            data-testid="reload-evidence"
            onClick={() => void load()}
            disabled={loading}
            className="border border-zinc-700 px-3 py-1 font-mono text-[11px] text-zinc-200 hover:border-amber-400 disabled:opacity-40"
          >
            {loading ? "reading…" : "re-read benchmark"}
          </button>
        </div>
      </div>

      <main className="mx-auto max-w-6xl space-y-4 px-6 py-6">
        {transportError && (
          <section data-testid="evidence-transport-error" className="border border-rose-200 bg-rose-50 p-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-rose-700">Engine unreachable</h2>
            <p className="mt-1 font-mono text-xs text-rose-700">{transportError}</p>
            <p className="mt-2 text-xs text-zinc-600">No benchmark was read and no verdict was produced.</p>
          </section>
        )}

        {!transportError && !ev && <p data-testid="evidence-loading" className="font-mono text-xs text-zinc-500">reading benchmark…</p>}

        {ev && (
          <>
            <section
              data-testid="evidence-verdict"
              className={`border p-4 ${ev.status === "ok" ? "border-zinc-200 bg-white" : ev.status === "unusable" ? "border-amber-200 bg-amber-50" : "border-rose-200 bg-rose-50"}`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Benchmark pre-flight verdict</h1>
                <span
                  data-testid="evidence-status"
                  className={`inline-flex items-center rounded-full border px-3 py-1 font-mono text-[11px] font-bold uppercase ${
                    ev.status === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : ev.status === "unusable" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-rose-200 bg-rose-50 text-rose-700"
                  }`}
                >
                  {ev.status}
                </span>
                <span className="flex-1" />
                <span className="font-mono text-[11px] text-zinc-500">
                  quant evaluated: <span data-testid="quant-evaluated">{q !== null ? "yes" : "no"}</span>
                </span>
                <span
                  data-testid="executable-state"
                  className="inline-flex items-center rounded-full border border-zinc-300 bg-zinc-100 px-3 py-1 font-mono text-[11px] font-bold uppercase text-zinc-500"
                >
                  executable: {String(ev.executable)}
                </span>
              </div>
              <p data-testid="execution-authority" className="mt-2 font-mono text-[11px] text-zinc-500">
                execution authority: {ev.executionAuthority} · packet→dispatch bridge: {ev.bridge.packetToDispatch}
              </p>
              {ev.blockingReasons.length > 0 && (
                <ul data-testid="blocking-reasons" className="mt-2 space-y-1">
                  {ev.blockingReasons.map((r, i) => (
                    <li key={i} className="font-mono text-[11px] text-rose-700">• {r}</li>
                  ))}
                </ul>
              )}
            </section>

            {ev.error && (
              <section data-testid="evidence-error" className="border border-rose-200 bg-rose-50 p-4">
                <h2 className="text-xs font-bold uppercase tracking-widest text-rose-700">Benchmark read failed</h2>
                <p className="mt-1 font-mono text-xs text-rose-700">{ev.error.code}: {ev.error.message}</p>
              </section>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <section className="border border-zinc-200 bg-white p-4">
                <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Provenance</h2>
                <dl className="mt-1">
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

              <section className="border border-zinc-200 bg-white p-4">
                <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Quote &amp; freshness</h2>
                <dl className="mt-1">
                  <Field label="bid" value={fmt(b?.bid, 3)} testId="bid" />
                  <Field label="ask" value={fmt(b?.ask, 3)} testId="ask" />
                  <Field label="midpoint" value={fmt(b?.midpoint, 3)} testId="midpoint" />
                  <Field
                    label="age at request start (GATE BASIS)"
                    value={fmtAge(f?.ageAtRequestStartMs)}
                    testId="freshness-age"
                    tone={f?.status === "verified_fresh" ? "ok" : f?.status === "verified_stale" ? "warn" : "bad"}
                  />
                  <Field
                    label="age at receipt (reported, not gated)"
                    value={fmtAge(f?.ageAtReceiptMs)}
                    testId="freshness-age-at-receipt"
                    tone="warn"
                  />
                  <Field label="receipt latency (responseReceivedAt − requestedAt)" value={fmtAge(f?.receiptLatencyMs)} testId="receipt-latency" />
                  <Field label="freshness basis" value={f?.freshnessBasis ?? "—"} testId="freshness-basis" />
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

              <section className="border border-zinc-200 bg-white p-4">
                <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Symbol mapping</h2>
                <dl className="mt-1">
                  <Field label="repo symbol" value={ev.symbolMapping.repoSymbol} testId="map-repo" />
                  <Field label="venue symbol" value={ev.symbolMapping.venueSymbol} testId="map-venue" />
                  <Field label="reference symbol" value={ev.symbolMapping.referenceSymbol} testId="map-reference" />
                </dl>
              </section>

              <section className="border border-zinc-200 bg-white p-4">
                <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Regime &amp; carry</h2>
                <dl className="mt-1">
                  <Field label="regime" value={ev.regime.regime} testId="regime" />
                  <Field label="carry horizon (h to reopen)" value={String(ev.regime.hoursToNextReopen)} testId="carry-horizon" />
                  <Field label="next reopen (ET)" value={ev.regime.nextReopenAtIso ?? "—"} testId="next-reopen" />
                  <Field label="required benchmark source" value={ev.regime.requiredBenchmarkSource} testId="required-source" />
                  <Field label="holiday calendar" value={ev.regime.holidayCalendarSupported ? "supported" : "not modelled (GAP-017)"} testId="holiday-support" tone="warn" />
                </dl>
              </section>

              <section className="border border-zinc-200 bg-white p-4 md:col-span-2">
                <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Quant verdict</h2>
                {q === null ? (
                  <p data-testid="quant-null" className="mt-2 font-mono text-xs text-zinc-500">
                    Quant did not run. {ev.gate.blockedReason ?? "The benchmark gate blocked evaluation."}
                  </p>
                ) : (
                  <dl className="mt-1">
                    <Field label="verdict" value={q.action} testId="quant-action" tone={q.action === "NEUTRAL" ? "warn" : "ok"} />
                    <Field label="basis" value={fmtPct(q.rawBasisPct)} testId="basis" />
                    <Field label="hurdle" value={fmtPct(q.hurdleRatePct)} testId="hurdle" />
                    <Field label="net edge" value={fmtPct(q.netEdgePct)} testId="net-edge" tone={q.netEdge > 0 ? "ok" : "warn"} />
                    <Field label="token price" value={fmt(q.tokenPrice, 4)} testId="token-price" />
                    <Field label="benchmark price" value={fmt(q.benchmarkPrice, 4)} testId="benchmark-price" />
                    <Field label="quant score" value={fmt(q.quantScore, 2)} testId="quant-score" />
                  </dl>
                )}
                <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
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
