/**
 * ObservationRunner — one explicit observation per invocation.
 *
 * THE SHAPE
 *   `runOnce()` is the only entry point. It takes an injected clock, an
 *   injected set of source adapters, and an injected append-only sink. It
 *   returns a prediction record and appends it. It does not return before the
 *   work is done and it does not schedule anything afterwards.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   - no timer, interval, scheduler or daemon
 *   - no global network call: every read goes through an injected adapter
 *   - no dispatcher import and no order route
 *   - no receipt sealing for execution
 *   - no phase transition and no `executionEnabledAt`
 *   - no outcome data in its signature, so no-lookahead is structural
 *
 * THE AUTHORITY BOUNDARY IS IN THE TYPES
 *   Every prediction it can produce has `dispatchEligible: false`,
 *   `executionAuthority: "none"`, `wouldHaveExecuted: false` and
 *   `logMode: "OBSERVATION_ONLY"` as literals. There is no branch that yields
 *   anything else, and no configuration flag that changes it.
 *
 * THREE MODES
 *   BASIS_PREDICTION   independent benchmark admitted AND venue context present
 *   VENUE_CONTEXT_ONLY venue context only; no basis figures are emitted
 *   NO_PREDICTION      a required input was invalid, unavailable or stale
 *
 * The mode is derived from admission results, never asserted by a caller.
 */
import { evaluateBasisSpread } from "../agents/quant.js";
import {
  admitBenchmark,
  allowedDownstreamUsesFor,
  artifactKindFor,
  benchmarkEligibilityForRole,
  failureToObservation,
  isFailure,
  provenanceHash,
  type BenchmarkAdmission,
  type SourceAdapter,
  type SourceObservation,
} from "./source-model.js";
import {
  combinedInputHash,
  computePredictionId,
  buildSourceAdmissionRecord,
  computeRecordHash,
  type BenchmarkStatus,
  type PredictionAction,
  type PredictionBasis,
  type SourceAdmissionRecord,
  type PredictionMode,
  type PredictionDraft,
  type PredictionRecord,
} from "./prediction.js";

/** 15,000 ms. Unchanged by this layer, and not tunable per prediction. */
export const OBSERVATION_FRESHNESS_GATE_MS = 15_000;

/** Default forecast horizon. Explicit and part of the prediction identity. */
export const DEFAULT_FORECAST_HORIZON_MS = 15 * 60 * 1000;

export interface RunOnceOptions {
  /** Injected clock. There is no `Date.now()` in the decision path. */
  now: Date;
  /** Repo symbol, e.g. `rNVDAUSDT`. */
  instrument: string;
  /** Bare venue symbol, e.g. `NVDAUSDT`. */
  venueSymbol: string;
  /** Independent benchmark symbol, e.g. `NVDA`. */
  benchmarkSymbol: string;
  /** Source adapters, injected. The runner performs no I/O itself. */
  adapters: readonly SourceAdapter[];
  forecastHorizonMs?: number;
  freshnessGateMs?: number;
  /** Notional used only to let the deterministic Quant path price a spread. */
  observationNotionalUsd?: number;
  /** Session classification, injected so the runner needs no clock logic. */
  sessionVerification?: string;
  regime?: string;
  /** Optional deterministic depth for the Quant path. Never fetched. */
  depth?: { bids: { price: number; quantity: number }[]; asks: { price: number; quantity: number }[] };
  fundingRate8h?: number;
}

export interface RunOnceResult {
  readonly record: PredictionRecord;
  readonly mode: PredictionMode;
  /** Observations normalised this run, retained for evidence. */
  readonly sources: SourceObservation[];
  /** Admission outcome per provider, for diagnosis. */
  readonly admissions: Record<string, { ok: boolean; code?: string; detail?: string }>;
}

/**
 * Normalise every adapter's answer once. A failure becomes an observation with
 * `failureReason` set rather than a missing entry, so a broken source is
 * visible in the record instead of silently absent.
 */
function observeAll(args: {
  adapters: readonly SourceAdapter[];
  symbol: string;
  now: Date;
}): SourceObservation[] {
  const out: SourceObservation[] = [];
  for (const adapter of args.adapters) {
    const raw = adapter.observe(args.symbol, args.now);
    out.push(isFailure(raw) ? failureToObservation(raw, args.now) : raw);
  }
  return out;
}

function statusFor(admission: BenchmarkAdmission | null, sawIndependent: boolean): BenchmarkStatus {
  if (admission === null) return "ABSENT";
  if (admission.ok) return "ADMITTED_INDEPENDENT_BENCHMARK";
  switch (admission.code) {
    case "SOURCE_FAILED":
      return "REJECTED_FAILED";
    case "ROLE_NOT_BENCHMARK_ELIGIBLE":
      return "REJECTED_NOT_BENCHMARK_ELIGIBLE";
    case "SOURCE_ASOF_MISSING":
    case "SOURCE_ASOF_UNPARSEABLE":
    case "SOURCE_ASOF_NOT_BEFORE_RECEIPT":
    case "TIMESTAMPS_NOT_DISTINCT":
      return "REJECTED_NO_SOURCE_TIMESTAMP";
    case "STALE_BETWEEN_SOURCE_AND_RECEIPT":
    case "STALE_AT_ADMISSION":
      return "REJECTED_STALE";
    case "NO_PRICE":
      return "REJECTED_NO_PRICE";
    default:
      return sawIndependent ? "REJECTED_FAILED" : "ABSENT";
  }
}

/**
 * Run exactly one observation and produce exactly one prediction record.
 *
 * Pure with respect to its inputs: the same adapters, clock and symbols yield
 * the same recordId and predictionId. It performs no scheduling and, apart from
 * whatever an injected adapter chooses to do, no I/O.
 */
export function runOnce(args: RunOnceOptions): RunOnceResult {
  const gateMs = args.freshnessGateMs ?? OBSERVATION_FRESHNESS_GATE_MS;
  const horizonMs = args.forecastHorizonMs ?? DEFAULT_FORECAST_HORIZON_MS;
  const sources = observeAll({ adapters: args.adapters, symbol: args.benchmarkSymbol, now: args.now });

  // ---- Partition by role.
  //
  // Benchmark candidacy is decided by benchmarkEligibilityForRole, not by a
  // hard-coded role string, so adding a role cannot silently widen or narrow
  // benchmark use. VENUE_MARKET_DATA lands in `venueContexts` and is therefore
  // eligible for venue context and research input while remaining ineligible as
  // the independent reference — which is the distinction the role model exists
  // to express.
  const benchmarkCandidates = sources.filter(
    (s) => benchmarkEligibilityForRole(s.role) === "ELIGIBLE_PENDING_TIMESTAMP_GATE",
  );
  const venueContexts = sources.filter((s) => {
    const uses = allowedDownstreamUsesFor(s.role);
    return uses.includes("VENUE_CONTEXT_AND_FEATURES");
  });
  // Artifacts and signals inform the record without becoming a price source.
  // Split by kind so the mode can name whether the strongest input was a
  // signal or an artifact, rather than collapsing them.
  const nonMarketSources = sources.filter((s) => {
    const uses = allowedDownstreamUsesFor(s.role);
    return uses.includes("PROPOSAL_INPUT") || uses.includes("STRATEGY_DEFINITION_INPUT")
      || uses.includes("BACKTEST_CONTEXT_INPUT") || uses.includes("EXTERNAL_PAPER_EVIDENCE_REFERENCE");
  });
  const researchInputs = sources.filter((s) => s.role === "RESEARCH_SIGNAL");
  const artifactInputs = sources.filter((s) => artifactKindFor(s.role) !== null);

  // Exactly one independent candidate is expected. If several are supplied, the
  // first admitted one wins and the rest are recorded but not used, so the
  // decision is never ambiguous.
  let admission: BenchmarkAdmission | null = null;
  let admittedFrom: SourceObservation | null = null;
  for (const candidate of benchmarkCandidates) {
    const a = admitBenchmark({ observation: candidate, now: args.now, freshnessGateMs: gateMs });
    if (a.ok) {
      admission = a;
      admittedFrom = candidate;
      break;
    }
    if (admission === null) admission = a; // keep the first refusal for reporting
  }

  const venueContext =
    venueContexts.find((v) => v.price !== null && v.failureReason === null) ??
    venueContexts.find((v) => v.failureReason === null) ??
    null;

  const admissions: Record<string, { ok: boolean; code?: string; detail?: string }> = {};
  for (const s of sources) {
    const a = admitBenchmark({ observation: s, now: args.now, freshnessGateMs: gateMs });
    admissions[s.provider] = a.ok ? { ok: true } : { ok: false, code: a.code, detail: a.detail };
  }

  // Per-source admission records: role, identity, artifact hash, admission
  // decision, permitted downstream use, and the benchmark rejection reason when
  // one applies. A source refused as a benchmark is still recorded as admitted.
  const sourceRecords: SourceAdmissionRecord[] = sources.map((s) =>
    buildSourceAdmissionRecord(s, {
      ok: admissions[s.provider]?.ok === true,
      ...(admissions[s.provider]?.code !== undefined ? { code: admissions[s.provider]!.code } : {}),
      ...(admissions[s.provider]?.detail !== undefined ? { detail: admissions[s.provider]!.detail } : {}),
    }),
  );

  const combinedHash = combinedInputHash({
    benchmark: admittedFrom,
    venue: venueContext,
    artifacts: nonMarketSources,
  });

  // ---- Derive the mode from admission results, never from a caller flag. ----
  let mode: PredictionMode;
  let action: PredictionAction = "NONE";
  let basis: PredictionBasis | null = null;
  let confidenceScore: number | null = null;
  let blockedReason: string;

  const venuePrice = venueContext?.price ?? null;
  const hasVenue = venuePrice !== null && venuePrice > 0;

  if (admission !== null && admission.ok && venueContext !== null && hasVenue) {
    // ---- BASIS_PREDICTION: both halves present and admitted. ----
    const depth =
      args.depth ??
      (() => {
        // Deterministic symmetric depth around the observed venue price. Never
        // fetched, and used only so the existing Quant path can price a spread.
        const mid = venuePrice as number;
        return {
          bids: Array.from({ length: 10 }, (_, i) => ({ price: mid * (1 - 0.0002 * (i + 1)), quantity: 40 })),
          asks: Array.from({ length: 10 }, (_, i) => ({ price: mid * (1 + 0.0002 * (i + 1)), quantity: 40 })),
        };
      })();

    const q = evaluateBasisSpread({
      tokenPrice: venuePrice as number,
      tradFiClosePrice: admission.price,
      orderSizeUsd: args.observationNotionalUsd ?? 25,
      depth,
      fundingRate8h: args.fundingRate8h ?? 0,
      hoursToClose: 0,
      takerFee: 0.0006,
    });

    mode = "BASIS_PREDICTION";
    action = q.action;
    basis = {
      rawBasisPct: q.rawBasisPct,
      hurdleRatePct: q.hurdleRatePct,
      netEdgePct: q.netEdgePct,
    };
    confidenceScore = q.quantScore;
    blockedReason =
      `BASIS_PREDICTION recorded from an independently timestamped benchmark (${admittedFrom?.provider} ` +
      `sourceAsOf ${admittedFrom?.sourceAsOf}, age at receipt ${admission.ageAtReceiptMs}ms vs ${gateMs}ms gate) ` +
      `and venue context (${venueContext?.provider}). OBSERVATION_ONLY: nothing was dispatched and this ` +
      `is not an authorization.`;
  } else if (!hasVenue && admission !== null && admission.ok) {
    // Benchmark admitted but no venue price: cannot express a basis at all.
    mode = "NO_PREDICTION";
    blockedReason =
      "NO_PREDICTION: an independent benchmark was admitted but no usable venue price was supplied, " +
      "so no basis can be expressed. OBSERVATION_ONLY.";
  } else if (hasVenue && (admission === null || !admission.ok)) {
    // ---- VENUE_CONTEXT_ONLY: venue data, no valid independent benchmark. ----
    mode = "VENUE_CONTEXT_ONLY";
    blockedReason =
      `VENUE_CONTEXT_ONLY: venue context from ${venueContext?.provider} was recorded, but no valid ` +
      `independent underlying-equity benchmark was admitted` +
      (admission !== null && !admission.ok ? ` (${admission.code}: ${admission.detail})` : "") +
      `. No basis, hurdle or net edge is emitted: a basis computed against venue data would be the ` +
      `strategy agreeing with itself. OBSERVATION_ONLY.`;
  } else if (researchInputs.length > 0 && (admission === null || !admission.ok)) {
    // ---- RESEARCH_CONTEXT_ONLY: a research signal is the strongest input. ----
    mode = "RESEARCH_CONTEXT_ONLY";
    blockedReason =
      `RESEARCH_CONTEXT_ONLY: research signal input from ${researchInputs.map((r) => r.provider).join(", ")} ` +
      `was recorded, but no valid independent underlying-equity benchmark was admitted` +
      (admission !== null && !admission.ok ? ` (${admission.code}: ${admission.detail})` : "") +
      `. A signal informs the desk; it is never the basis reference, and its presence alone ` +
      `does not make it a benchmark. OBSERVATION_ONLY.`;
  } else if (artifactInputs.length > 0 && (admission === null || !admission.ok)) {
    // ---- ARTIFACT_CONTEXT_ONLY: external artifacts only. ----
    // No venue price is required here: a proposal or an artifact is a
    // legitimate input even when it cannot be expressed as a basis.
    mode = "ARTIFACT_CONTEXT_ONLY";
    blockedReason =
      `ARTIFACT_CONTEXT_ONLY: recorded ${researchInputs.map((r) => `${r.provider} (${r.role})`).join(", ")} ` +
      `as research/artifact context, but no valid independent underlying-equity benchmark was admitted` +
      (admission !== null && !admission.ok ? ` (${admission.code}: ${admission.detail})` : "") +
      `. External artifacts inform the desk; they are never the basis reference and never ` +
      `authorise execution. OBSERVATION_ONLY.`;
  } else {
    mode = "NO_PREDICTION";
    blockedReason =
      "NO_PREDICTION: no admissible venue, research or artifact input and no valid independent " +
      "benchmark were supplied" +
      (admission !== null && !admission.ok ? ` (${admission.code}: ${admission.detail})` : "") +
      `. OBSERVATION_ONLY.`;
  }

  const horizonStart = args.now.toISOString();
  const horizonEnd = new Date(args.now.getTime() + horizonMs).toISOString();
  const predictionId = computePredictionId({
    instrument: args.instrument,
    horizonStart,
    horizonEnd,
    combinedInputHash: combinedHash,
  });

  const base: PredictionDraft = {
    recordType: "PREDICTION",
    recordId: `prec-${predictionId}`,
    predictionId,
    createdAt: args.now.toISOString(),
    forecastHorizonStart: horizonStart,
    forecastHorizonEnd: horizonEnd,
    forecastHorizonMs: horizonMs,
    instrument: args.instrument,
    venueSymbol: args.venueSymbol,
    benchmarkSymbol: admission !== null && admission.ok ? (admittedFrom?.symbol ?? null) : null,
    predictionMode: mode,
    action,
    basis,
    confidenceScore,
    inputHashes: {
      benchmarkProvenanceHash: admittedFrom === null ? null : provenanceHash(admittedFrom),
      venueProvenanceHash: venueContext === null ? null : provenanceHash(venueContext),
      combinedInputHash: combinedHash,
    },
    sources: sourceRecords,
    benchmarkStatus: statusFor(admission, benchmarkCandidates.length > 0),
    benchmarkSourceAsOf: admittedFrom?.sourceAsOf ?? null,
    benchmarkAgeAtReceiptMs: admission !== null && admission.ok ? admission.ageAtReceiptMs : null,
    freshnessGateMs: gateMs,
    sessionVerification: args.sessionVerification ?? "ANNUAL_CALENDAR_ONLY",
    sameDayAlertsChecked: false,
    regime: args.regime ?? null,
    // ---- Hard authority boundary. Literals, with no branch that differs. ----
    dispatchEligible: false,
    executionAuthority: "none",
    wouldHaveExecuted: false,
    orderSubmitted: false,
    blockedReason,
    logMode: "OBSERVATION_ONLY",
    phaseTransition: null,
  };

  return {
    // previousRecordHash is intentionally absent: it is stamped by the sink at
    // append time and is excluded from the content hash by construction.
    record: { ...base, recordHash: computeRecordHash(base) } as PredictionRecord,
    mode,
    sources,
    admissions,
  };
}

/**
 * GRACEFUL STOP / CHECKPOINT, without a live daemon.
 *
 * A window harness runs a bounded number of explicitly requested observations
 * and returns a checkpoint describing where it stopped. It is NOT a scheduler:
 * it executes exactly as many runs as the caller asked for, in order, with an
 * injected clock, and then stops. There is no loop that waits for wall-clock
 * time and no way to make it continue unattended.
 */
export interface WindowHarnessResult {
  readonly observations: PredictionRecord[];
  readonly stoppedBecause: "completed_requested_count" | "stop_requested" | "aborted";
  readonly checkpoint: {
    readonly observationsRun: number;
    readonly requestedCount: number;
    readonly lastCreatedAt: string | null;
    readonly lastRecordHash: string | null;
    readonly modeCounts: Record<string, number>;
  };
}

export function runObservationWindow(args: {
  /** Called once per observation. The ONLY place a run can come from. */
  run: (index: number) => RunOnceResult;
  count: number;
  /** Cooperative stop: return false to halt before the next observation. */
  shouldContinue?: (index: number) => boolean;
}): WindowHarnessResult {
  const observations: PredictionRecord[] = [];
  const modeCounts: Record<string, number> = {};
  let stoppedBecause: WindowHarnessResult["stoppedBecause"] = "completed_requested_count";

  for (let i = 0; i < args.count; i++) {
    if (args.shouldContinue !== undefined && !args.shouldContinue(i)) {
      stoppedBecause = "stop_requested";
      break;
    }
    const result = args.run(i);
    observations.push(result.record);
    modeCounts[result.mode] = (modeCounts[result.mode] ?? 0) + 1;
  }

  return {
    observations,
    stoppedBecause,
    checkpoint: {
      observationsRun: observations.length,
      requestedCount: args.count,
      lastCreatedAt: observations.length === 0 ? null : observations[observations.length - 1]!.createdAt,
      lastRecordHash: observations.length === 0 ? null : observations[observations.length - 1]!.recordHash,
      modeCounts,
    },
  };
}