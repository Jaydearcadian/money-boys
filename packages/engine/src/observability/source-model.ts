/**
 * Normalized source-observation model for the Money Boys observation runner.
 *
 * WHAT THIS IS
 *   The single shape every source adapter must produce, so downstream admission
 *   logic never has to know which vendor a number came from. A source declares
 *   its ROLE and its benchmark eligibility explicitly; the runner refuses to
 *   treat venue data as an independent reference, and never lets a missing
 *   source timestamp be papered over with a local one.
 *
 * SOURCE ROLES — fixed, and the reason they matter
 *
 *   VENUE_CONTEXT_OR_RESEARCH        Bitget MCP / venue context.
 *       benchmarkEligible: FALSE, permanently. Venue data describes the thing
 *       being traded, not an independent underlying reference. Using it as the
 *       benchmark would make the strategy agree with itself.
 *
 *   INDEPENDENT_REFERENCE_BENCHMARK  Robinhood, manually injected.
 *       The only role that can produce a BASIS_PREDICTION. Accepted ONLY as a
 *       caller-supplied validated observation while GAP-019 remains unresolved.
 *       This module never fetches it.
 *
 *   UNTRUSTED_RESEARCH               GetAgent / Playbook / bitget-signal.
 *       Interfaces and artifact capture only. Output is recorded as research
 *       context and can never influence a prediction, a gate, or an outcome.
 *
 * TIMESTAMP DISCIPLINE — the reason this model is typed the way it is
 *   `sourceAsOf`, `fetchedAt` and `responseReceivedAt` are three distinct
 *   fields and never aliases. A source that supplies no provider timestamp
 *   leaves `sourceAsOf` null, and a null `sourceAsOf` is never admissible as a
 *   benchmark. That is the failure mode that would otherwise let a local clock
 *   masquerade as provider provenance.
 *
 * NO NETWORK HERE
 *   This module defines shapes and pure admission. It performs no fetch, opens
 *   no timer, and imports no dispatcher.
 */
import { createHash } from "node:crypto";

export type SourceRole =
  | "VENUE_CONTEXT_OR_RESEARCH"
  | "INDEPENDENT_REFERENCE_BENCHMARK"
  | "UNTRUSTED_RESEARCH";

export type SourceEligibility = "ELIGIBLE_BENCHMARK" | "CONTEXT_ONLY" | "REJECTED";

/** A source that supplied its own provider-issued instant. */
export type SourceTimestampType =
  | "PROVIDER_GENERATED_QUOTE"
  | "PROVIDER_SESSION_CLOSE"
  | "VENUE_MATCH_ENGINE_EVENT"
  | "NONE_SUPPLIED";

/**
 * Normalized source observation.
 *
 * `benchmarkEligible` is DERIVED from role, never set by the adapter. An
 * adapter that tries to declare venue data benchmark-eligible is ignored, and
 * the caller sees `CONTEXT_ONLY` regardless of what it asked for.
 */
export interface SourceObservation {
  /** Vendor identity, e.g. `robinhood_stock_token_api`, `bitget_mcp`. */
  readonly provider: string;
  readonly role: SourceRole;
  /** Instrument symbol as the source publishes it. */
  readonly symbol: string;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly price: number | null;
  /**
   * Provider-published instant. NULL when the source supplied none. Never
   * substituted from `fetchedAt`.
   */
  readonly sourceAsOf: string | null;
  /** When this process requested the data. */
  readonly fetchedAt: string;
  /** When the source's response was received. */
  readonly responseReceivedAt: string;
  readonly timestampType: SourceTimestampType;
  /** Verbatim note about timestamp semantics, e.g. "not an exchange trade time". */
  readonly timestampNote: string;
  /** Typed failure reason when the source could not be read. */
  readonly failureReason: string | null;
  /** Free-form provenance retained into the record. */
  readonly provenance: Readonly<Record<string, unknown>>;
}

/** Derived eligibility. Fixed by role; never adapter-controlled. */
export function eligibilityForRole(role: SourceRole): SourceEligibility {
  switch (role) {
    case "INDEPENDENT_REFERENCE_BENCHMARK":
      return "ELIGIBLE_BENCHMARK";
    case "VENUE_CONTEXT_OR_RESEARCH":
      return "CONTEXT_ONLY";
    case "UNTRUSTED_RESEARCH":
      return "REJECTED";
  }
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
 * Covers the fields that determine the decision, so a record's inputs can be
 * re-derived and compared later. `fetchedAt`/`responseReceivedAt` are included
 * because they affect the admission age.
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
      failureReason: o.failureReason,
    }),
  );
}

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

/**
 * Source adapter contract.
 *
 * `observe(symbol, now)` is called ONCE per `runOnce()` invocation with an
 * injected clock. An adapter that performs network I/O inside `observe` is
 * permitted for the Robinhood path (it is manually injected and operator-
 * triggered), and forbidden for the fixture path. Nothing here schedules.
 */
export interface SourceAdapter {
  readonly provider: string;
  readonly role: SourceRole;
  /**
   * When true, this adapter must not perform any network access. Enforced by
   * the fixture runner and asserted by test.
   */
  readonly offline: boolean;
  observe(symbol: string, now: Date): SourceObservation | SourceObservationFailure;
}

/**
 * An explicit source failure, returned rather than thrown so the failure
 * becomes a recorded observation instead of a missing one.
 */
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

/** Convert an adapter failure into a normalized observation with no data. */
export function failureToObservation(
  f: SourceObservationFailure,
  now: Date,
): SourceObservation {
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
  };
}

// ---------------------------------------------------------------------------
// Benchmark admission
// ---------------------------------------------------------------------------

export type BenchmarkRejectionCode =
  | "SOURCE_FAILED"
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
}

export type BenchmarkAdmission = BenchmarkAdmissionOk | BenchmarkAdmissionRefused;

/**
 * Admit a source observation as an independent reference benchmark.
 *
 * The order of checks is deliberate and each one is a distinct, named failure:
 *
 *   1. the source actually produced data
 *   2. its ROLE permits benchmark use at all (venue data never does)
 *   3. it supplied a provider timestamp  — a null sourceAsOf is NEVER admitted
 *   4. that timestamp parses
 *   5. it is not in the future relative to our receipt clock
 *   6. sourceAsOf, fetchedAt and responseReceivedAt are genuinely distinct
 *   7. it is not stale between the provider's instant and our receipt
 *   8. it is still fresh at ADMISSION time
 *   9. it carries a usable price
 *
 * A refusal at any step is a refusal. There is no partial acceptance.
 */
export function admitBenchmark(args: {
  observation: SourceObservation;
  now: Date;
  freshnessGateMs: number;
}): BenchmarkAdmission {
  const o = args.observation;

  if (o.failureReason !== null) {
    return { ok: false, code: "SOURCE_FAILED", detail: o.failureReason };
  }
  if (eligibilityForRole(o.role) !== "ELIGIBLE_BENCHMARK") {
    return {
      ok: false,
      code: "ROLE_NOT_BENCHMARK_ELIGIBLE",
      detail:
        `source '${o.provider}' has role ${o.role}, which is not benchmark-eligible. ` +
        `Venue/context data describes the instrument being traded and can never serve as an ` +
        `independent underlying-equity reference.`,
    };
  }
  // The load-bearing check: no provider timestamp means no provenance.
  if (o.sourceAsOf === null) {
    return {
      ok: false,
      code: "SOURCE_ASOF_MISSING",
      detail:
        `source '${o.provider}' supplied no provider timestamp (timestampType=${o.timestampType}). ` +
        `A local fetch time is never a substitute, so this cannot be a benchmark.`,
    };
  }
  const sourceMs = Date.parse(o.sourceAsOf);
  if (Number.isNaN(sourceMs)) {
    return {
      ok: false,
      code: "SOURCE_ASOF_UNPARSEABLE",
      detail: `sourceAsOf '${o.sourceAsOf}' is not a parseable instant`,
    };
  }
  const receiptMs = Date.parse(o.responseReceivedAt);
  const nowMs = args.now.getTime();
  if (Number.isNaN(receiptMs)) {
    return { ok: false, code: "TIMESTAMPS_NOT_DISTINCT", detail: `responseReceivedAt '${o.responseReceivedAt}' is unparseable` };
  }
  if (sourceMs > nowMs) {
    return {
      ok: false,
      code: "SOURCE_ASOF_NOT_BEFORE_RECEIPT",
      detail: `sourceAsOf ${o.sourceAsOf} is in the future relative to admission at ${args.now.toISOString()}`,
    };
  }

  // Distinctness: a source that stamps all three identically is not carrying
  // provenance, it is echoing our own clock.
  if (o.sourceAsOf === o.fetchedAt || o.sourceAsOf === o.responseReceivedAt) {
    return {
      ok: false,
      code: "TIMESTAMPS_NOT_DISTINCT",
      detail:
        `sourceAsOf equals ${o.sourceAsOf === o.fetchedAt ? "fetchedAt" : "responseReceivedAt"}; ` +
        `a provider timestamp must be distinct from local request times`,
    };
  }

  const ageAtReceiptMs = receiptMs - sourceMs;
  if (ageAtReceiptMs < 0) {
    return {
      ok: false,
      code: "SOURCE_ASOF_NOT_BEFORE_RECEIPT",
      detail: `sourceAsOf is ${-ageAtReceiptMs}ms after our receipt of it; the provider clock is not credible`,
    };
  }
  if (ageAtReceiptMs >= args.freshnessGateMs) {
    return {
      ok: false,
      code: "STALE_BETWEEN_SOURCE_AND_RECEIPT",
      detail: `ageAtReceiptMs=${ageAtReceiptMs} exceeds the ${args.freshnessGateMs}ms gate`,
    };
  }

  const ageAtAdmissionMs = nowMs - sourceMs;
  if (ageAtAdmissionMs >= args.freshnessGateMs) {
    return {
      ok: false,
      code: "STALE_AT_ADMISSION",
      detail: `ageAtAdmissionMs=${ageAtAdmissionMs} exceeds the ${args.freshnessGateMs}ms gate`,
    };
  }

  const price =
    o.price !== null
      ? o.price
      : o.bid !== null && o.ask !== null
        ? Number(((o.bid + o.ask) / 2).toFixed(8))
        : null;
  if (price === null || !Number.isFinite(price) || price <= 0) {
    return { ok: false, code: "NO_PRICE", detail: `source '${o.provider}' supplied no usable price` };
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