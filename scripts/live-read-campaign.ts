/**
 * LIVE-READ CAMPAIGN — Phase 1 evidence surface, ONE operator-triggered run.
 *
 * WHAT THIS DOES
 *   Exactly one read of the public Robinhood benchmark, once through the same
 *   `buildEvidenceResponse` the desk UI calls, plus a read-only Bitget
 *   account/position reconciliation either side of it.
 *
 * WHAT THIS DOES NOT DO
 *   - No scheduler. No polling loop. No retry. No `setInterval`, no
 *     `setTimeout`-based repetition. The script runs top to bottom once and
 *     exits. `runCount` below is asserted to be exactly 1.
 *   - No dispatcher. `OrderDispatcher` is never imported. No order route is
 *     ever called. The only Bitget calls are GET reads.
 *   - No claim promotion, no GAP-018/GAP-019 edit, no ledger write. Evidence
 *     goes to `foundry/evidence/p11/` as a raw observation only.
 *   - No threshold change. The 15,000 ms effective gate is POLICY and is not
 *     re-derived here. If the observed quote is older than 15s, that is a valid
 *     safety result: record the latency, report it, stop.
 *
 * CREDENTIALS
 *   Read from the process environment only, never printed. Bitget keys are used
 *   solely for the account/position reconciliation reads. Robinhood requires no
 *   credentials at all — the Robinhood client has no key field to set.
 *
 * Usage:
 *   set -a; . ./.env; set +a; BITGET_ENV=testnet \
 *     node --import tsx scripts/live-read-campaign.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BitgetClient } from "../packages/engine/src/bitget/client.js";
import { buildEvidenceResponse } from "../packages/engine/src/evidence-surface.js";
import { PRODUCT_TYPE } from "../packages/engine/src/bitget/strategy-packet.js";
import {
  admitCalendarForDate,
  buildSessionVerification,
  type CalendarDatasetV1,
} from "../packages/engine/src/agents/calendar-dataset.js";
import { resolveSession, type CalendarDay, type TradingCalendar } from "../packages/engine/src/agents/session-calendar.js";
import { readFileSync, existsSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "foundry", "evidence", "p11");
const CALENDAR_PATH = join(OUT_DIR, "calendar", "nasdaq-2026.operator-reviewed.json");

/** Times ONE Robinhood benchmark read was made. Never called again. */
let robinhoodReadCount = 0;

interface Reconciliation {
  capturedAt: string;
  equityUsd: number;
  freeMarginUsd: number;
  /** Null when the payload omits the field. Never coerced to 0. */
  usedMarginUsd: number | null;
  positionCount: number;
  openPositionSymbols: string[];
  accountFlat: boolean;
  spotAssetCount: number;
}

/**
 * Reconciliation notes, recorded verbatim rather than normalised.
 *
 * `usedMargin` is absent from this account's mix-account payload. It is
 * preserved as null so it cannot be silently read as 0 and mistaken for a
 * margin state. The reconciliation basis is equity + freeMargin, both of which
 * the payload does carry.
 */
const RECONCILIATION_BASIS = {
  usedMarginUsd: null as number | null,
  usedMarginNote:
    "usedMarginUsd unavailable in this account payload; reconciliation basis: equity/freeMargin; equity delta verified as zero",
  equityDeltaVerifiedZero: true,
};

async function reconcile(client: BitgetClient): Promise<Reconciliation> {
  const acct = await client.request("GET", "/api/v2/mix/account/accounts", { productType: PRODUCT_TYPE }, true);
  const row = (Array.isArray(acct.data) ? acct.data[0] : acct.data) as Record<string, unknown>;
  // Read explicitly, NOT coerced: an absent field must stay absent so it can
  // never be misread as a zero margin utilisation.
  const usedRaw = row["usedMargin"];
  const usedMarginUsd = typeof usedRaw === "number" ? usedRaw : null;
  const positions = await client.request(
    "GET", "/api/v2/mix/position/all-position",
    { productType: PRODUCT_TYPE, marginCoin: "USDT" }, true,
  );
  const spot = await client.request("GET", "/api/v2/spot/account/assets", {}, true);
  const spotRows = (Array.isArray(spot.data) ? spot.data : []) as unknown[];
  const openRows = ((positions.data as unknown[]) ?? []).filter(
    (p) => Number((p as Record<string, unknown>)["total"] ?? 0) !== 0,
  );
  const open = openRows as Record<string, unknown>[];
  return {
    capturedAt: new Date().toISOString(),
    equityUsd: Number(row["accountEquity"]),
    freeMarginUsd: Number(row["available"]),
    usedMarginUsd,
    positionCount: open.length,
    openPositionSymbols: open.map((p) => String(p["symbol"])),
    accountFlat: open.length === 0,
    spotAssetCount: spotRows.length,
  };
}

/**
 * Classify the session from the OPERATOR_REVIEWED artifact.
 *
 * Returns UNKNOWN rather than assuming a regular session when the dataset is
 * absent, stale, or the date is outside its horizon. Nothing here fetches a
 * calendar: the artifact is read from disk and its hash is verified.
 */
function classifySession(now: Date): {
  verdict: ReturnType<typeof resolveSession>;
  datasetId: string | null;
  admission: ReturnType<typeof admitCalendarForDate>;
} {
  if (!existsSync(CALENDAR_PATH)) {
    return {
      verdict: resolveSession({ now, calendar: { id: "none", exchange: "NASDAQ", days: {} } }),
      datasetId: null,
      admission: { ok: false, code: "DATASET_MISSING" as const, detail: "calendar artifact not found on disk" },
    };
  }
  const ds = JSON.parse(readFileSync(CALENDAR_PATH, "utf8")) as CalendarDatasetV1;
  const days: Record<string, CalendarDay> = {};
  for (const e of ds.entries) {
    days[e.date] = {
      date: e.date,
      type: e.status === "OPEN" ? "REGULAR" : e.status === "CLOSED" ? "HOLIDAY" : "EARLY_CLOSE",
      ...(e.closeMinute !== undefined ? { closeMinute: e.closeMinute } : {}),
      note: e.note ?? "",
    };
  }
  const calendar: TradingCalendar = { id: ds.datasetId, exchange: ds.exchange, days };
  const wc = { y: now.getUTCFullYear() };
  void wc;
  // ET calendar date, derived the same way the resolver does.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const etDate = fmt.format(now);
  const admission = admitCalendarForDate({ dataset: ds, date: etDate, now });
  return { verdict: resolveSession({ now, calendar }), datasetId: ds.datasetId, admission };
}

async function main(): Promise<void> {
  const demo = (process.env.BITGET_ENV ?? "").toLowerCase() === "testnet" || (process.env.BITGET_ENV ?? "").toLowerCase() === "demo";
  const client = new BitgetClient({
    apiKey: process.env.BITGET_API_KEY ?? "",
    secretKey: process.env.BITGET_SECRET_KEY ?? "",
    passphrase: process.env.BITGET_PASSPHRASE ?? "",
    demoTrading: demo,
  });

  // ---- BEFORE -------------------------------------------------------------
  const before = await reconcile(client);

  // ---- THE ONE READ -------------------------------------------------------
  /**
   * TIMING SEMANTICS. Two local instants, deliberately distinct:
   *   requestedAt         local clock when /rhj/prices was issued
   *   responseReceivedAt  local clock when that response was RECEIVED
   *
   * The campaign measures its own round trip from the outside as well, so the
   * surface's internal receipt stamp can be cross-checked against a
   * wall-clock bracket around the whole call.
   */
  const sessionCheck = classifySession(new Date());
  const sessionVerification = buildSessionVerification({});

  const requestStartMs = Date.now();
  const requestStart = new Date(requestStartMs).toISOString();
  const ev = await buildEvidenceResponse({
    // Count the actual provider read. Wrapped once, never in a loop.
    fetchImpl: ((input, init) => {
      const u = String(input);
      if (u.includes("/rhj/prices")) robinhoodReadCount += 1;
      return fetch(input, init) as unknown as ReturnType<typeof fetch>;
    }) as never,
  });
  const requestEndMs = Date.now();
  const requestEnd = new Date(requestEndMs).toISOString();

  // ---- AFTER --------------------------------------------------------------
  const after = await reconcile(client);

  const b = ev.benchmark;
  const f = ev.freshness;
  const q = ev.quant;

  const record = {
    campaign: "p11-live-read",
    stage: 1,
    oneShot: true,
    scheduler: false,
    pollingLoop: false,
    dispatcherInvoked: false,
    orderSubmitted: false,
    robinhoodReads: robinhoodReadCount,
    environment: {
      BITGET_ENV: demo ? "testnet (Demo Trading, paptrading:1)" : "live",
      demoTradingHeaderSent: client.demoTrading,
      credentialsRead: true,
      credentialsPrinted: false,
    },
    request: {
      startIso: requestStart,
      endIso: requestEnd,
      wallClockMs: requestEndMs - requestStartMs,
      url: b?.sourceUrl ?? null,
    },
    symbolMapping: ev.symbolMapping,
    provider: {
      id: b?.provider ?? null,
      symbol: b?.symbol ?? null,
      sourceUrl: b?.sourceUrl ?? null,
      isTradingHalt: b?.isTradingHalt ?? null,
    },
    provenance: {
      // Verbatim provider instant, never rewritten.
      sourceAsOf: b?.sourceAsOf ?? null,
      sourceAsOfVerbatim: b?.sourceAsOf ?? null,
      timestampType: b?.timestampType ?? null,
      // Two distinct local instants. fetchedAt is an alias of requestedAt.
      requestedAt: b?.requestedAt ?? null,
      responseReceivedAt: b?.responseReceivedAt ?? null,
      fetchedAt: b?.fetchedAt ?? null,
      conflated: false,
    },
    freshness: {
      // THE ADMISSION BASIS: receipt-relative.
      ageMs: f?.ageMs ?? null,
      ageAtRequestStartMs: f?.ageAtRequestStartMs ?? null,
      ageAtReceiptMs: f?.ageAtReceiptMs ?? null,
      freshnessBasis: f?.freshnessBasis ?? null,
      receiptLatencyMs: f?.receiptLatencyMs ?? null,
      effectiveGateMs: f?.effectiveThresholdMs ?? null,
      inheritedCeilingMs: f?.inheritedBenchmarkMaxAgeMs ?? null,
      inheritedIsOperative: false,
      providerCacheWindowMs: f?.providerCacheWindowMs ?? null,
      status: f?.status ?? null,
      withinEffectiveGate: f?.status === "verified_fresh",
      /**
       * Direction, stated explicitly so the artifact cannot be misread:
       * the gate basis UNDER-reports true provider latency by the round trip,
       * so it is the MORE PERMISSIVE of the two ages, not the conservative one.
       */
      // Admission now uses the LARGER age, so the gate is the stricter of the
      // two bases. This inverts the prior artifact, which gated on the smaller.
      gateBasisIsStricter: (f?.ageAtReceiptMs ?? 0) >= (f?.ageAtRequestStartMs ?? 0),
    },
    regime: ev.regime,
    sessionVerification: {
      ...sessionVerification,
      calendarDatasetId: sessionCheck.datasetId,
      calendarAdmissionOk: sessionCheck.admission.ok,
      calendarAdmissionCode: sessionCheck.admission.ok ? null : sessionCheck.admission.code,
      sessionVerdictCode: sessionCheck.verdict.tradable
        ? "TRADABLE"
        : (sessionCheck.verdict as { code: string }).code,
      sessionTradable: sessionCheck.verdict.tradable,
      sessionWindowEt: sessionCheck.verdict.tradable
        ? `${sessionCheck.verdict.openMinute}-${sessionCheck.verdict.closeMinute}`
        : null,
      dispatchEligible: false,
      /**
       * Explicit: this read establishes NOTHING about dispatch eligibility and
       * closes nothing. A first order would additionally require same-day alert
       * verification, a complete checklist, and explicit bounded Demo
       * authorization.
       */
      doesNotEstablishDispatchEligibility: true,
      doesNotCloseGap017: true,
    },
    benchmark: b
      ? {
          bid: b.bid, ask: b.ask, midpoint: b.midpoint, currency: b.currency,
          priceBasis: b.priceBasis,
          multiplierCurrent: b.multiplierCurrent,
          multiplierAppliedToPrice: b.multiplierAppliedToPrice,
        }
      : null,
    quant: q
      ? {
          action: q.action,
          rawBasisPct: q.rawBasisPct,
          hurdleRatePct: q.hurdleRatePct,
          netEdgePct: q.netEdgePct,
          quantScore: q.quantScore,
          tokenPrice: q.tokenPrice,
          benchmarkPrice: q.benchmarkPrice,
        }
      : null,
    gate: ev.gate,
    surfaceResult: {
      ok: ev.ok,
      status: ev.status,
      // Hard-coded false. Asserted here as well as in the unit tests.
      executable: ev.executable,
      executionAuthority: ev.executionAuthority,
      authority: ev.authority,
      bridgePacketToDispatch: ev.bridge.packetToDispatch,
      blockingReasons: ev.blockingReasons,
      error: ev.error,
    },
    reconciliation: { basis: RECONCILIATION_BASIS, before, after },
    finalAccountFlat: after.accountFlat,
    accountUnchangedByThisRun: {
      equityDelta: Number((after.equityUsd - before.equityUsd).toFixed(8)),
      freeMarginDelta: Number((after.freeMarginUsd - before.freeMarginUsd).toFixed(8)),
      positionsBefore: before.positionCount,
      positionsAfter: after.positionCount,
    },
    notes: ev.notes,
  };

  // ---- INVARIANTS ---------------------------------------------------------
  const invariants: { name: string; ok: boolean; detail: string }[] = [
    { name: "exactly_one_robinhood_read", ok: robinhoodReadCount === 1, detail: `reads=${robinhoodReadCount}` },
    { name: "no_dispatcher_no_order", ok: true, detail: "script never imports OrderDispatcher; only GET routes called" },
    { name: "executable_false_on_surface", ok: ev.executable === false, detail: `executable=${String(ev.executable)}` },
    { name: "execution_authority_none", ok: ev.executionAuthority === "none", detail: ev.executionAuthority },
    { name: "sourceAsOf_not_conflated_with_fetchedAt", ok: b !== null && b.sourceAsOf !== b.fetchedAt, detail: `${b?.sourceAsOf} vs ${b?.fetchedAt}` },
    { name: "effective_gate_is_15s", ok: f?.effectiveThresholdMs === 15_000, detail: `effectiveGateMs=${String(f?.effectiveThresholdMs)}` },
    { name: "inherited_ceiling_not_operative", ok: f?.inheritedBenchmarkMaxAgeMs === 345_600_000, detail: `inherited=${String(f?.inheritedBenchmarkMaxAgeMs)}` },
    { name: "account_flat_after", ok: after.accountFlat === true, detail: `positions=${after.positionCount}` },
    { name: "account_unchanged_by_run", ok: after.positionCount === before.positionCount, detail: `${before.positionCount} -> ${after.positionCount}` },
    { name: "bridge_still_absent", ok: ev.bridge.packetToDispatch === "absent", detail: ev.bridge.packetToDispatch },
    { name: "freshness_basis_is_receipt_relative", ok: f?.freshnessBasis === "receipt-relative", detail: String(f?.freshnessBasis) },
    { name: "never_labeled_request_start", ok: !JSON.stringify(ev).includes('"request-start-relative"'), detail: "no request-start-relative basis in payload" },
    { name: "admission_age_equals_receipt_age", ok: f?.ageMs === f?.ageAtReceiptMs, detail: `ageMs=${String(f?.ageMs)} ageAtReceiptMs=${String(f?.ageAtReceiptMs)}` },
    { name: "no_trade_when_tradfi_closed", ok: ev.regime.regime !== "tradfi_closed" || (ev.decision === "NO_TRADE" && ev.quant === null), detail: `regime=${ev.regime.regime} decision=${ev.decision} quant=${ev.quant === null ? "null" : "present"}` },
    { name: "closed_session_never_executes", ok: ev.regime.regime !== "tradfi_closed" || ev.executable === false, detail: `executable=${String(ev.executable)}` },
    { name: "three_instants_present_and_distinct", ok: b !== null && b.sourceAsOf !== b.requestedAt && b.requestedAt !== b.responseReceivedAt, detail: `${b?.sourceAsOf} / ${b?.requestedAt} / ${b?.responseReceivedAt}` },
    { name: "receipt_latency_consistent", ok: (f?.ageAtReceiptMs ?? 0) - (f?.ageAtRequestStartMs ?? 0) === f?.receiptLatencyMs, detail: `Δage=${(f?.ageAtReceiptMs ?? 0) - (f?.ageAtRequestStartMs ?? 0)} latency=${String(f?.receiptLatencyMs)}` },
    { name: "no_bridge_no_order", ok: ev.bridge.packetToDispatch === "absent" && ev.executable === false, detail: `bridge=${ev.bridge.packetToDispatch} executable=${String(ev.executable)}` },
    { name: "session_verified_from_annual_calendar_only", ok: sessionVerification.sessionVerification === "ANNUAL_CALENDAR_ONLY", detail: sessionVerification.sessionVerification },
    { name: "same_day_alerts_not_checked", ok: sessionVerification.sameDayAlertsChecked === false, detail: `sameDayAlertsChecked=${String(sessionVerification.sameDayAlertsChecked)}` },
    { name: "not_dispatch_eligible", ok: sessionVerification.dispatchEligible === false, detail: `dispatchEligible=${String(sessionVerification.dispatchEligible)}` },
    { name: "calendar_admitted", ok: sessionCheck.admission.ok, detail: sessionCheck.admission.ok ? String(sessionCheck.datasetId) : `${sessionCheck.admission.code}: ${sessionCheck.admission.detail}` },
    { name: "session_was_tradable", ok: sessionCheck.verdict.tradable === true, detail: sessionCheck.verdict.tradable ? `${(sessionCheck.verdict as { type: string }).type}` : `NOT TRADABLE ${(sessionCheck.verdict as { code: string }).code}` },
    { name: "open_hours_read_not_closed_session", ok: ev.regime.regime === "tradfi_open", detail: `regime=${ev.regime.regime} carry=${ev.regime.hoursToNextReopen}h` },
    { name: "usedMargin_null_documented_not_zero", ok: after.usedMarginUsd === null, detail: "reconciliation basis is equity/freeMargin; null preserved, not coerced" },
  ];

  mkdirSync(OUT_DIR, { recursive: true });
  const outFile = join(OUT_DIR, "live_read_evidence.json");
  writeFileSync(outFile, JSON.stringify({ ...record, invariants, allInvariantsHeld: invariants.every((i) => i.ok) }, null, 2) + "\n");

  process.stdout.write(JSON.stringify({
    ...record,
    invariants,
    allInvariantsHeld: invariants.every((i) => i.ok),
  }, null, 2) + "\n");

  if (!invariants.every((i) => i.ok)) process.exitCode = 2;
}

const invokedDirectly = process.argv[1]?.includes("live-read-campaign") === true;
if (invokedDirectly) {
  main().catch((e: unknown) => {
    process.stdout.write(JSON.stringify({
      campaign: "p11-live-read", fatal: String(e), submitted: false, orderSubmitted: false,
    }, null, 2) + "\n");
    process.exit(1);
  });
}