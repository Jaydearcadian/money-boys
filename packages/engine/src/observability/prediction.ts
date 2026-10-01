/**
 * Forward-looking PREDICTION records for the observation layer.
 *
 * WHAT THIS IS
 *   A prediction is a statement made BEFORE a horizon elapses, derived
 *   deterministically from admitted inputs. It is written forward-looking so it
 *   can be evaluated later against what actually happened — which is what makes
 *   it evidence rather than narration.
 *
 * NO-LOOKAHEAD, STRUCTURALLY
 *   `ObservationRunner.runOnce()` receives no outcome data at all: the outcome
 *   arrives in a separate call, after the horizon, and is written to a separate
 *   record. There is no parameter through which future information could reach a
 *   prediction, so the guarantee is a property of the signature rather than a
 *   promise in a comment.
 *
 * THREE MODES, EXPLICIT
 *
 *   BASIS_PREDICTION       An independently timestamped benchmark was admitted
 *                          AND venue context existed. Basis, hurdle and net
 *                          edge are computed from the deterministic Quant path.
 *
 *   VENUE_CONTEXT_ONLY     Venue/context data exists but no valid independent
 *                          benchmark. No basis figures are emitted — a basis
 *                          against venue data is the thing this whole design
 *                          exists to prevent.
 *
 *   NO_PREDICTION          A required input was invalid, unavailable or stale.
 *                          This is a recorded, expected outcome, not an error.
 *
 * THE AUTHORITY BOUNDARY, IN THE TYPES
 *   `dispatchEligible: false`, `executionAuthority: "none"` and
 *   `wouldHaveExecuted: false` are literal types. A prediction cannot be
 *   constructed in a form that could be read as an authorization, and this
 *   module imports no dispatcher, no order route and no sealing helper.
 *
 * NO PERFORMANCE FIELDS
 *   There is no pnl, return, fill, win-rate or Sharpe field anywhere in these
 *   types. A prediction is a forecast; whether it was right is decided by the
 *   evaluation record, not asserted here.
 */
import {
  allowedDownstreamUsesFor,
  artifactKindFor,
  benchmarkEligibilityForRole,
  canonicalJson,
  sourceAdmissionFor,
  type AllowedDownstreamUse,
  type ArtifactKind,
  type BenchmarkEligibility,
  type SourceAdmission,
  type SourceObservation,
  type SourceRole,
} from "./source-model.js";
import { createHash } from "node:crypto";

/**
 * Prediction modes.
 *
 * Each non-BASIS mode exists to name WHAT was observed, so a record is never
 * reduced to "nothing happened":
 *
 *   BASIS_PREDICTION       An independent benchmark AND a venue price were
 *                          admitted. The deterministic Quant path may run.
 *   VENUE_CONTEXT_ONLY     Venue market data was admitted.
 *   RESEARCH_CONTEXT_ONLY  A research signal was admitted.
 *   ARTIFACT_CONTEXT_ONLY  One or more external artifacts were admitted.
 *   NO_PREDICTION          Nothing admissible, or the required combination is
 *                          incomplete.
 *
 * When several non-benchmark inputs are present the mode names the strongest,
 * and the full set is always visible in `sources[]` plus `blockedReason`. None
 * of these modes carries any execution authority.
 */
export type PredictionMode =
  | "BASIS_PREDICTION"
  | "VENUE_CONTEXT_ONLY"
  | "RESEARCH_CONTEXT_ONLY"
  | "ARTIFACT_CONTEXT_ONLY"
  | "NO_PREDICTION";

/** Directional forecast. Mirrors the deterministic Quant vocabulary. */
export type PredictionAction = "BUY_BASIS" | "SELL_BASIS" | "NEUTRAL" | "NONE";

export type BenchmarkStatus =
  | "ADMITTED_INDEPENDENT_BENCHMARK"
  | "REJECTED_NOT_BENCHMARK_ELIGIBLE"
  | "REJECTED_NO_SOURCE_TIMESTAMP"
  | "REJECTED_STALE"
  | "REJECTED_FAILED"
  | "REJECTED_NO_PRICE"
  | "ABSENT";

/**
 * Basis figures. Present ONLY on a BASIS_PREDICTION, because they are only
 * meaningful against an admitted independent benchmark.
 */
export interface PredictionBasis {
  readonly rawBasisPct: number;
  readonly hurdleRatePct: number;
  readonly netEdgePct: number;
}

/** Hashes of every input that determined this prediction. */
export interface PredictionInputHashes {
  readonly benchmarkProvenanceHash: string | null;
  readonly venueProvenanceHash: string | null;
  /** Hash over all admitted inputs, so the prediction is reproducible. */
  readonly combinedInputHash: string;
}

/**
 * Per-source record of what was admitted, what it may be used for, and — when
 * it is not benchmark-eligible — exactly why.
 *
 * The point of separating ADMISSION from BENCHMARK ELIGIBILITY is that a source
 * rejected as a benchmark is still a legitimate input. Bitget market data is
 * admitted as venue context and refused as the basis reference; both facts are
 * recorded here rather than collapsed into a single "rejected" verdict.
 */
export interface SourceAdmissionRecord {
  readonly provider: string;
  readonly role: SourceRole;
  readonly symbol: string;
  /** Whether this source is a legitimate input at all. */
  readonly sourceAdmission: SourceAdmission;
  /** Whether it may serve as the independent basis benchmark. */
  readonly benchmarkEligibility: BenchmarkEligibility;
  /** ADMITTED_BENCHMARK | ADMITTED_NON_BENCHMARK | REJECTED */
  readonly admissionDecision: "ADMITTED_BENCHMARK" | "ADMITTED_NON_BENCHMARK" | "REJECTED";
  /** What this source is permitted to influence downstream. */
  readonly allowedDownstreamUse: readonly AllowedDownstreamUse[];
  /** Artifact identity, for the three artifact roles. Null otherwise. */
  readonly artifactKind: ArtifactKind | null;
  readonly artifactHash: string | null;
  readonly strategyVersion: string | null;
  /** Populated only when this source was refused for benchmark use. */
  readonly benchmarkRejectionReason: string | null;
  /** Hash binding this record to the exact source content reviewed. */
  readonly provenanceHash: string;
}

/** Build the admission record for one normalized source. */
export function buildSourceAdmissionRecord(
  o: SourceObservation,
  benchmark: { ok: boolean; code?: string; detail?: string },
): SourceAdmissionRecord {
  const admission = sourceAdmissionFor(o);
  const eligibility = benchmarkEligibilityForRole(o.role);
  const decision: SourceAdmissionRecord["admissionDecision"] =
    admission !== "ADMITTED"
      ? "REJECTED"
      : benchmark.ok
        ? "ADMITTED_BENCHMARK"
        : "ADMITTED_NON_BENCHMARK";
  return {
    provider: o.provider,
    role: o.role,
    symbol: o.symbol,
    sourceAdmission: admission,
    benchmarkEligibility: eligibility,
    admissionDecision: decision,
    allowedDownstreamUse: allowedDownstreamUsesFor(o.role),
    artifactKind: artifactKindFor(o.role),
    artifactHash: o.artifactHash,
    strategyVersion: o.strategyVersion,
    // The independence refusal is reported verbatim as INDEPENDENCE_FAILURE
    // rather than the composite `code: detail` form, so a consumer can match on
    // it without parsing prose.
    benchmarkRejectionReason:
      benchmark.ok || benchmark.detail === undefined
        ? null
        : o.role === "VENUE_MARKET_DATA"
          ? "INDEPENDENCE_FAILURE"
          : `${benchmark.code}: ${benchmark.detail}`,
    provenanceHash: sha256(canonicalJson(o)),
  };
}

export interface PredictionRecord {
  readonly recordType: "PREDICTION";
  readonly recordId: string;
  readonly predictionId: string;
  readonly createdAt: string;

  /** Explicit, forward-looking horizon. Never implied by `createdAt` alone. */
  readonly forecastHorizonStart: string;
  readonly forecastHorizonEnd: string;
  readonly forecastHorizonMs: number;

  /** Repo symbol, e.g. `rNVDAUSDT`. */
  readonly instrument: string;
  /** Venue symbol, e.g. `NVDAUSDT`. */
  readonly venueSymbol: string;
  /** Independent benchmark symbol, e.g. `NVDA`. Null when none was admitted. */
  readonly benchmarkSymbol: string | null;

  readonly predictionMode: PredictionMode;
  readonly action: PredictionAction;
  /** Null unless predictionMode is BASIS_PREDICTION. */
  readonly basis: PredictionBasis | null;
  /** Deterministic score, when the Quant path produced one. */
  readonly confidenceScore: number | null;

  readonly inputHashes: PredictionInputHashes;
  /**
   * Per-source role, identity, artifact hash, admission decision, permitted
   * downstream use and benchmark rejection reason.
   */
  readonly sources: readonly SourceAdmissionRecord[];

  readonly benchmarkStatus: BenchmarkStatus;
  readonly benchmarkSourceAsOf: string | null;
  readonly benchmarkAgeAtReceiptMs: number | null;
  readonly freshnessGateMs: number;
  readonly sessionVerification: string;
  readonly sameDayAlertsChecked: false;
  readonly regime: string | null;

  // ---- Hard authority boundary. Literal types, always false / none. ----
  readonly dispatchEligible: false;
  readonly executionAuthority: "none";
  readonly wouldHaveExecuted: false;
  readonly orderSubmitted: false;
  readonly blockedReason: string;
  readonly logMode: "OBSERVATION_ONLY";
  readonly phaseTransition: null;

  /**
   * Hash of the preceding line in the stream, for tamper detection. Stamped by
   * the sink at append time, therefore EXCLUDED from `recordHash`: the content
   * hash must depend only on content, not on where the record landed.
   */
  readonly previousRecordHash: string | null | undefined;
  /** Hash of this record's canonical content, excluding this field. */
  readonly recordHash: string;
}

/** The shape the runner constructs: no linkage yet. */
export type PredictionDraft = Omit<PredictionRecord, "recordHash" | "previousRecordHash">;

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Deterministic content hash. Excludes `recordHash` itself. */
export function computeRecordHash(record: PredictionDraft): string {
  return sha256(canonicalJson(record));
}

/** Deterministic prediction identity: same inputs and horizon, same id. */
export function computePredictionId(args: {
  instrument: string;
  horizonStart: string;
  horizonEnd: string;
  combinedInputHash: string;
}): string {
  return `pred-${sha256(canonicalJson(args)).slice(0, 16)}`;
}

/** Build the combined input hash from the admitted sources. */
export function combinedInputHash(args: {
  benchmark: SourceObservation | null;
  venue: SourceObservation | null;
  /** Non-market sources that informed the prediction, e.g. artifacts. */
  artifacts?: readonly SourceObservation[];
}): string {
  return sha256(
    canonicalJson({
      benchmark: args.benchmark === null ? null : {
        provider: args.benchmark.provider,
        symbol: args.benchmark.symbol,
        sourceAsOf: args.benchmark.sourceAsOf,
        responseReceivedAt: args.benchmark.responseReceivedAt,
      },
      venue: args.venue === null ? null : {
        provider: args.venue.provider,
        symbol: args.venue.symbol,
        price: args.venue.price,
        bid: args.venue.bid,
        ask: args.venue.ask,
      },
      // Artifact hashes and roles participate, so recording a different
      // artifact or reclassifying a source changes the prediction identity.
      artifacts: (args.artifacts ?? [])
        .map((a) => ({ provider: a.provider, role: a.role, artifactHash: a.artifactHash }))
        .sort((x, y) => (x.provider < y.provider ? -1 : 1)),
    }),
  );
}