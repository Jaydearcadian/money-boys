/**
 * Normalized source-observation model for the Money Boys observation runner.
 *
 * WHAT THIS IS
 *   The single shape every source adapter must produce, so downstream admission
 *   logic never has to know which vendor a number came from. A source declares
 *   its ROLE explicitly, and the role determines what the source may be used
 *   FOR — never what it is.
 *
 * ROLE CORRECTION
 *   An earlier revision collapsed venue data and third-party artifacts into one
 *   "generic research" bucket and rejected both. That was wrong in both
 *   directions: Bitget market data is legitimate venue context, and a validated
 *   GetAgent/Playbook artifact is a real strategy input. Rejecting them as
 *   generic noise discarded information instead of classifying it. Roles are
 *   now explicit and each carries its own permitted downstream uses.
 *
 * THE SIX ROLES
 *
 *   VENUE_MARKET_DATA           Bitget MCP. Venue context and research input.
 *       May inform a prediction and contribute features. NOT an independent
 *       benchmark: it describes the instrument being traded, so treating it as
 *       the reference would make the strategy agree with itself.
 *
 *   REFERENCE_BENCHMARK         An independent underlying-equity reference
 *       (currently Robinhood, manually injected). The only role that admits a
 *       basis benchmark. Admission additionally requires a valid provider-issued
 *       `sourceAsOf` — a role does not bypass the timestamp gate.
 *
 *   RESEARCH_SIGNAL             bitget-signal. A proposal or feature input with
 *       its own identity, fetch time, content hash and expiry. May contribute
 *       to Quant input. Never carries execution authority.
 *
 *   STRATEGY_ARTIFACT           GetAgent/Playbook strategy definition.
 *   BACKTEST_ARTIFACT           Historical replay or parameter study.
 *   PAPER_TRADING_ARTIFACT      External paper-execution record.
 *       All three are recordable with hash, version, metrics and provenance.
 *       All three are kept DISTINCT from Money Boys-controlled execution, so an
 *       external paper artifact can never be read as our own fill history.
 *
 * THE TWO AXES
 *   `sourceAdmission` answers "is this a legitimate input at all?" — every role
 *   passes; rejection here is for malformed or failed reads only.
 *
 *   `benchmarkEligibility` answers "may this be the independent basis
 *   reference?" — a far narrower question, answered by role AND by the
 *   timestamp gate. A source can be fully admitted and still be ineligible as a
 *   benchmark. That is the normal case for venue data, not a rejection of it.
 *
 * TIMESTAMP DISCIPLINE
 *   `sourceAsOf`, `fetchedAt` and `responseReceivedAt` are three distinct
 *   fields and never aliases. A null `sourceAsOf` is never admissible as a
 *   benchmark and is never substituted from a local time.
 *
 * EXECUTION AUTHORITY
 *   Nothing in this model grants any. Roles determine permitted *reads*; no
 *   role may dispatch, sign, or mutate portfolio state, and no role is an
 *   execution path. See `ALLOWED_DOWNSTREAM_USES`.
 *
 * NO NETWORK HERE
 *   Defines shapes and pure admission. No fetch, no timer, no dispatcher.
 */
import { createHash } from "node:crypto";

export type SourceRole =
  | "VENUE_MARKET_DATA"
  | "REFERENCE_BENCHMARK"
  | "RESEARCH_SIGNAL"
  | "STRATEGY_ARTIFACT"
  | "BACKTEST_ARTIFACT"
  | "PAPER_TRADING_ARTIFACT";

/**
 * What a source may be used for downstream.
 *
 * NOTE WHAT IS ABSENT: no entry permits dispatch, order placement, signing, or
 * portfolio mutation. There is deliberately no `EXECUTE` capability in this
 * type, so no role — including an artifact describing paper trades performed
 * elsewhere — can be granted execution authority by configuration.
 */
export type AllowedDownstreamUse =
  | "BENCHMARK_BASIS_REFERENCE"
  | "VENUE_CONTEXT_AND_FEATURES"
  | "PROPOSAL_INPUT"
  | "STRATEGY_DEFINITION_INPUT"
  | "BACKTEST_CONTEXT_INPUT"
  | "EXTERNAL_PAPER_EVIDENCE_REFERENCE";

/** Whether a source is a legitimate input at all. Distinct from benchmark use. */
export type SourceAdmission =
  | "ADMITTED"
  | "REJECTED_MALFORMED"
  | "REJECTED_SOURCE_FAILED";

/**
 * Whether a source may serve as the independent basis benchmark.
 *
 * `ELIGIBLE` requires BOTH the right role AND a valid provider-issued
 * `sourceAsOf`. A role alone never confers eligibility.
 */
export type BenchmarkEligibility =
  | "ELIGIBLE_PENDING_TIMESTAMP_GATE"
  | "NOT_ELIGIBLE_ROLE"
  | "NOT_ELIGIBLE_INDEPENDENCE"
  | "NOT_ELIGIBLE_ARTIFACT_SOURCE";

/** A source that supplied its own provider-issued instant. */
export type SourceTimestampType =
  | "PROVIDER_GENERATED_QUOTE"
  | "PROVIDER_SESSION_CLOSE"
  | "VENUE_MATCH_ENGINE_EVENT"
  | "ARTIFACT_ISSUED_AT"
  | "NONE_SUPPLIED";

/** Roles that describe an externally produced artifact rather than a live feed. */
export type ArtifactKind = "STRATEGY" | "BACKTEST" | "PAPER_TRADING";

export interface SourceObservation {
  readonly provider: string;
  readonly role: SourceRole;
  /** Instrument symbol as the source publishes it. */
  readonly symbol: string;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly price: number | null;
  /** Provider-published instant. NULL when the source supplied none. */
  readonly sourceAsOf: string | null;
  /** When this process requested the data. */
  readonly fetchedAt: string;
  /** When the source's response was received. */
  readonly responseReceivedAt: string;
  readonly timestampType: SourceTimestampType;
  /** Verbatim note about timestamp semantics. */
  readonly timestampNote: string;
  /** Typed failure reason when the source could not be read. */
  readonly failureReason: string | null;
  /** Free-form provenance retained into the record. */
  readonly provenance: Readonly<Record<string, unknown>>;

  // ---- Artifact fields. Present only for *_ARTIFACT roles. ----
  /** SHA-256 over the artifact's content. Binds the record to the artifact. */
  readonly artifactHash: string | null;
  /** Version string for a strategy artifact. */
  readonly strategyVersion: string | null;
  /** Declared metrics for a backtest or external paper artifact. */
  readonly metrics: Readonly<Record<string, unknown>> | null;
  /** When a research signal or artifact stops being usable. */
  readonly expiresAt: string | null;
  /**
   * Set when this source describes trades executed OUTSIDE Money Boys control.
   * Retained so external paper evidence is never conflated with our own.
   */
  readonly externalExecution: boolean;
}

// ---------------------------------------------------------------------------
// Role classification
// ---------------------------------------------------------------------------

/**
 * Permitted downstream uses per role.
 *
 * There is no execution capability in this table, by design.
 */
export function allowedDownstreamUsesFor(role: SourceRole): readonly AllowedDownstreamUse[] {
  switch (role) {
    case "REFERENCE_BENCHMARK":
      return ["BENCHMARK_BASIS_REFERENCE", "VENUE_CONTEXT_AND_FEATURES"];
    case "VENUE_MARKET_DATA":
      return ["VENUE_CONTEXT_AND_FEATURES"];
    case "RESEARCH_SIGNAL":
      return ["PROPOSAL_INPUT", "VENUE_CONTEXT_AND_FEATURES"];
    case "STRATEGY_ARTIFACT":
      return ["STRATEGY_DEFINITION_INPUT"];
    case "BACKTEST_ARTIFACT":
      return ["BACKTEST_CONTEXT_INPUT"];
    case "PAPER_TRADING_ARTIFACT":
      return ["EXTERNAL_PAPER_EVIDENCE_REFERENCE"];
  }
}

/**
 * Benchmark eligibility by role.
 *
 * `ELIGIBLE_PENDING_TIMESTAMP_GATE` means the role is right but a valid
 * provider-issued `sourceAsOf` is still required. The distinction matters: a
 * REFERENCE_BENCHMARK that supplies no timestamp fails on TIMESTAMP grounds,
 * while venue data is ineligible on INDEPENDENCE grounds regardless of how good
 * its timestamp is.
 */
export function benchmarkEligibilityForRole(role: SourceRole): BenchmarkEligibility {
  switch (role) {
    case "REFERENCE_BENCHMARK":
      return "ELIGIBLE_PENDING_TIMESTAMP_GATE";
    case "VENUE_MARKET_DATA":
      // Not because its timestamp may be poor, but because it is not an
      // independent reference: it prices the very instrument being traded.
      return "NOT_ELIGIBLE_INDEPENDENCE";
    case "RESEARCH_SIGNAL":
      return "NOT_ELIGIBLE_ROLE";
    case "STRATEGY_ARTIFACT":
    case "BACKTEST_ARTIFACT":
    case "PAPER_TRADING_ARTIFACT":
      return "NOT_ELIGIBLE_ARTIFACT_SOURCE";
  }
}

/** True when the role describes an externally produced artifact. */
export function artifactKindFor(role: SourceRole): ArtifactKind | null {
  switch (role) {
    case "STRATEGY_ARTIFACT":
      return "STRATEGY";
    case "BACKTEST_ARTIFACT":
      return "BACKTEST";
    case "PAPER_TRADING_ARTIFACT":
      return "PAPER_TRADING";
    default:
      return null;
  }
}

/**
 * Is this source a legitimate input at all?
 *
 * Every role ADMISSES. Only a malformed read or a failed source rejects, and
 * that rejection is about the READ, not the role.
 */
export function sourceAdmissionFor(o: SourceObservation): SourceAdmission {
  if (o.failureReason !== null) return "REJECTED_SOURCE_FAILED";
  if (o.provider.length === 0 || o.symbol.length === 0) return "REJECTED_MALFORMED";
  return "ADMITTED";
}

// ---------------------------------------------------------------------------
// Canonicalisation + hashing
// ---------------------------------------------------------------------------

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>).sort()) {
    const v = (value as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = canonicalize(v);
  }
  return out;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Deterministic provenance hash over the observation's meaning.
 *
 * Covers the fields that determine the decision. For artifacts this includes
 * the artifact hash, version and metrics, so a recorded artifact is bound to
 * exactly what was reviewed.
 */
export function provenanceHash(o: SourceObservation): string {
  return sha256(
    canonicalJson({
      provider: o.provider,
      role: o.role,
      symbol: o.symbol,
      bid: o.bid,
      ask: o.ask,
      price: o.price,
      sourceAsOf: o.sourceAsOf,
      fetchedAt: o.fetchedAt,
      responseReceivedAt: o.responseReceivedAt,
      timestampType: o.timestampType,
      artifactHash: o.artifactHash,
      strategyVersion: o.strategyVersion,
      metrics: o.metrics,
      expiresAt: o.expiresAt,
      externalExecution: o.externalExecution,
      failureReason: o.failureReason,
    }),
  );
}

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export interface SourceAdapter {
  readonly provider: string;
  readonly role: SourceRole;
  /** When true, this adapter must not perform network access. */
  readonly offline: boolean;
  observe(symbol: string, now: Date): SourceObservation | SourceObservationFailure;
}

export interface SourceObservationFailure {
  readonly provider: string;
  readonly role: SourceRole;
  readonly symbol: string;
  readonly code: string;
  readonly message: string;
}

export function isFailure(
  v: SourceObservation | SourceObservationFailure,
): v is SourceObservationFailure {
  return typeof (v as SourceObservationFailure).code === "string";
}

/** Convert an adapter failure into a normalized observation carrying no data. */
export function failureToObservation(f: SourceObservationFailure, now: Date): SourceObservation {
  return {
    provider: f.provider,
    role: f.role,
    symbol: f.symbol,
    bid: null,
    ask: null,
    price: null,
    sourceAsOf: null,
    fetchedAt: now.toISOString(),
    responseReceivedAt: now.toISOString(),
    timestampType: "NONE_SUPPLIED",
    timestampNote: "no data was supplied",
    failureReason: `${f.code}: ${f.message}`,
    provenance: {},
    artifactHash: null,
    strategyVersion: null,
    metrics: null,
    expiresAt: null,
    externalExecution: false,
  };
}

// ---------------------------------------------------------------------------
// Benchmark admission — UNCHANGED IN SUBSTANCE
// ---------------------------------------------------------------------------

export type BenchmarkRejectionCode =
  | "SOURCE_FAILED"
  | "SOURCE_MALFORMED"
  | "ROLE_NOT_BENCHMARK_ELIGIBLE"
  | "SOURCE_ASOF_MISSING"
  | "SOURCE_ASOF_UNPARSEABLE"
  | "SOURCE_ASOF_NOT_BEFORE_RECEIPT"
  | "TIMESTAMPS_NOT_DISTINCT"
  | "STALE_BETWEEN_SOURCE_AND_RECEIPT"
  | "STALE_AT_ADMISSION"
  | "NO_PRICE";

export interface BenchmarkAdmissionOk {
  readonly ok: true;
  readonly observation: SourceObservation;
  readonly price: number;
  readonly ageAtReceiptMs: number;
  readonly freshnessGateMs: number;
  readonly provenanceHash: string;
}

export interface BenchmarkAdmissionRefused {
  readonly ok: false;
  readonly code: BenchmarkRejectionCode;
  readonly detail: string;
  /** Role-derived ineligibility, so the reason distinguishes KIND from TIMESTAMP. */
  readonly eligibility: BenchmarkEligibility;
}

export type BenchmarkAdmission = BenchmarkAdmissionOk | BenchmarkAdmissionRefused;

/**
 * Admit a source observation as the independent basis benchmark.
 *
 * UNCHANGED IN SUBSTANCE from the previous revision: a valid provider-issued
 * `sourceAsOf` remains mandatory, and no role bypasses it. What changed is that
 * a refusal now names WHY — independence (venue data), role (signals/artifacts),
 * or timestamp (a benchmark role that failed to supply a usable instant).
 *
 * A refusal here is NOT a rejection of the source. It means only that this
 * source cannot serve as the basis reference; it may still be fully admitted as
 * venue context, proposal input, or recorded artifact.
 */
export function admitBenchmark(args: {
  observation: SourceObservation;
  now: Date;
  freshnessGateMs: number;
}): BenchmarkAdmission {
  const o = args.observation;
  const eligibility = benchmarkEligibilityForRole(o.role);

  if (o.failureReason !== null) {
    return { ok: false, code: "SOURCE_FAILED", detail: o.failureReason, eligibility };
  }
  if (sourceAdmissionFor(o) === "REJECTED_MALFORMED") {
    return { ok: false, code: "SOURCE_MALFORMED", detail: "observation is missing provider or symbol", eligibility };
  }
  if (eligibility !== "ELIGIBLE_PENDING_TIMESTAMP_GATE") {
    const why =
      eligibility === "NOT_ELIGIBLE_INDEPENDENCE"
        ? `role ${o.role} describes the instrument being traded, so it cannot be an INDEPENDENT underlying-equity reference; using it as the benchmark would make the strategy agree with itself`
        : eligibility === "NOT_ELIGIBLE_ARTIFACT_SOURCE"
          ? `role ${o.role} is an externally produced artifact, not a live independent market reference`
          : `role ${o.role} is not a reference-benchmark role`;
    return { ok: false, code: "ROLE_NOT_BENCHMARK_ELIGIBLE", detail: why, eligibility };
  }
  // Load-bearing: no provider timestamp means no provenance, whatever the role.
  if (o.sourceAsOf === null) {
    return {
      ok: false,
      code: "SOURCE_ASOF_MISSING",
      eligibility,
      detail:
        `source '${o.provider}' supplied no provider timestamp (timestampType=${o.timestampType}). ` +
        `A local fetch time is never a substitute, so this cannot be a benchmark.`,
    };
  }
  const sourceMs = Date.parse(o.sourceAsOf);
  if (Number.isNaN(sourceMs)) {
    return { ok: false, code: "SOURCE_ASOF_UNPARSEABLE", detail: `sourceAsOf '${o.sourceAsOf}' is not a parseable instant`, eligibility };
  }
  const receiptMs = Date.parse(o.responseReceivedAt);
  const nowMs = args.now.getTime();
  if (Number.isNaN(receiptMs)) {
    return { ok: false, code: "TIMESTAMPS_NOT_DISTINCT", detail: `responseReceivedAt '${o.responseReceivedAt}' is unparseable`, eligibility };
  }
  if (sourceMs > nowMs) {
    return { ok: false, code: "SOURCE_ASOF_NOT_BEFORE_RECEIPT", eligibility, detail: `sourceAsOf ${o.sourceAsOf} is in the future relative to admission at ${args.now.toISOString()}` };
  }
  if (o.sourceAsOf === o.fetchedAt || o.sourceAsOf === o.responseReceivedAt) {
    return {
      ok: false,
      code: "TIMESTAMPS_NOT_DISTINCT",
      eligibility,
      detail: `sourceAsOf equals ${o.sourceAsOf === o.fetchedAt ? "fetchedAt" : "responseReceivedAt"}; a provider timestamp must be distinct from local request times`,
    };
  }
  const ageAtReceiptMs = receiptMs - sourceMs;
  if (ageAtReceiptMs < 0) {
    return { ok: false, code: "SOURCE_ASOF_NOT_BEFORE_RECEIPT", eligibility, detail: `sourceAsOf is ${-ageAtReceiptMs}ms after our receipt of it; the provider clock is not credible` };
  }
  if (ageAtReceiptMs >= args.freshnessGateMs) {
    return { ok: false, code: "STALE_BETWEEN_SOURCE_AND_RECEIPT", eligibility, detail: `ageAtReceiptMs=${ageAtReceiptMs} exceeds the ${args.freshnessGateMs}ms gate` };
  }
  const ageAtAdmissionMs = nowMs - sourceMs;
  if (ageAtAdmissionMs >= args.freshnessGateMs) {
    return { ok: false, code: "STALE_AT_ADMISSION", eligibility, detail: `ageAtAdmissionMs=${ageAtAdmissionMs} exceeds the ${args.freshnessGateMs}ms gate` };
  }
  const price =
    o.price !== null
      ? o.price
      : o.bid !== null && o.ask !== null
        ? Number(((o.bid + o.ask) / 2).toFixed(8))
        : null;
  if (price === null || !Number.isFinite(price) || price <= 0) {
    return { ok: false, code: "NO_PRICE", eligibility, detail: `source '${o.provider}' supplied no usable price` };
  }
  return {
    ok: true,
    observation: o,
    price,
    ageAtReceiptMs,
    freshnessGateMs: args.freshnessGateMs,
    provenanceHash: provenanceHash(o),
  };
}