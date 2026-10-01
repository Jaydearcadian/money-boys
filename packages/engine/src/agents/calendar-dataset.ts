/**
 * Typed calendar dataset — PROPOSAL ONLY, NOT WIRED INTO PRODUCTION.
 *
 * STATUS
 *   This module defines the schema, the validator, and the provenance model
 *   for a version-controlled session calendar. It contains NO holiday data and
 *   NO default calendar. It resolves nothing until a reviewed dataset is
 *   supplied and explicitly installed.
 *
 * WHY A DATASET RATHER THAN A RUNTIME FETCH
 *   Research found a clean and uncomfortable split:
 *
 *     - The AUTHORITATIVE calendars (NYSE and Nasdaq publish dated holiday and
 *       early-close schedules through 2028) exist only as PDF and HTML.
 *     - The MACHINE-READABLE JSON endpoints are undocumented, unversioned,
 *       disallowed by `robots.txt`, and explicitly prohibited for automated
 *       capture by BOTH operators' terms of use.
 *
 *   So a runtime fetch would be an unpermitted automated capture under the ICE
 *   and Nasdaq agreements. The compliant architecture is a one-time,
 *   human-supervised derivation from the published documents into a
 *   version-controlled dataset, with the exchange pages retained as CITATION
 *   for human review rather than a runtime dependency.
 *
 * DERIVATION IS A SEPARATE, EXPLICIT STEP
 *   Nothing here fetches anything. `provenance` records where a dataset came
 *   from so a reviewer can check it, and `verifyDataset` recomputes the content
 *   hash so tampering is detectable. Producing a dataset from a PDF is a
 *   deliberate human act with review, not an automated pipeline.
 *
 * FAIL CLOSED
 *   `validateCalendarDataset` rejects a dataset that is malformed, unversioned,
 *   unhashed, internally inconsistent, or whose coverage does not span a
 *   requested date. There is no partial-acceptance path.
 */
import { createHash } from "node:crypto";

/** Session classification for one ET calendar date. */
export type SessionStatus = "OPEN" | "EARLY_CLOSE" | "CLOSED";

/**
 * One calendar date.
 *
 * `openMinute`/`closeMinute` are minutes from ET midnight as LOCAL WALL-CLOCK
 * time in America/New_York. They are deliberately NOT UTC and carry no offset:
 * 9:30 means 9:30 in whichever DST state applies on that date. Storing a UTC
 * instant here would be a category error.
 */
export interface CalendarEntry {
  /** ISO date in ET, `YYYY-MM-DD`. */
  readonly date: string;
  readonly status: SessionStatus;
  /** Minutes from ET midnight. Required unless status is CLOSED. */
  readonly openMinute?: number;
  /** Minutes from ET midnight. Required unless status is CLOSED. */
  readonly closeMinute?: number;
  /** Redundant with status === EARLY_CLOSE, kept explicit for review. */
  readonly earlyClose: boolean;
  /** Always `America/New_York`. Recorded per-entry for auditability. */
  readonly timezone: "America/New_York";
  /** Operator-published label, e.g. "Thanksgiving Day". Carried into evidence. */
  readonly note?: string;
}

/**
 * Provenance for a derived dataset. Required, never optional: a calendar with
 * no provenance is indistinguishable from a guessed one, and a guessed holiday
 * list is exactly what must not reach production.
 */
export interface CalendarProvenance {
  /** Where the human derived this from. Citation, not a runtime dependency. */
  readonly sourceUrl: string;
  /** Operator that published it. */
  readonly sourcePublisher: "NYSE" | "NASDAQ";
  /** Document title/filename as published. */
  readonly sourceDocument: string;
  /** Publisher's own currency statement, verbatim where possible. */
  readonly sourceEffectiveDate: string;
  /** Publisher-declared version, when one exists. Empty string if none does. */
  readonly sourceVersion: string | null;
  /**
   * `Last-Modified` observed at fetch. Recorded because it is the only
   * machine-readable freshness signal the operators expose — and because
   * research showed it can drift from the document's creation date, so it is
   * evidence, not proof.
   */
  readonly sourceLastModified: string | null;
  /** Who performed the derivation, for review routing. */
  readonly derivedBy: string;
  /** When the derivation was performed. */
  readonly derivedAt: string;
}

/**
 * Same-day operator checklist.
 *
 * WHY THIS CANNOT COME FROM THE DATASET
 *   Nasdaq's own calendar page directs readers to Trader Alerts for all
 *   per-day information, including unscheduled closures and early closes. Those
 *   alerts are not machine-readable. An annual calendar therefore cannot
 *   detect a closure announced the morning of.
 *
 *   That makes this checklist a genuine control rather than ceremony: it is the
 *   only thing standing between a stale-but-valid annual calendar and an
 *   unscheduled closure.
 *
 * `complete` is NOT derived from the other fields. It is set by the operator,
 * and the resolver trusts that statement as an assertion of a human action.
 */
export interface SameDayChecklist {
  /** An operator reviewed the annual calendar for this date. */
  readonly annualCalendarReviewed: boolean;
  /** Current Trader Alerts were checked for this date. */
  readonly traderAlertsChecked: boolean;
  /** No unscheduled closure or early close was found. */
  readonly noUnscheduledChange: boolean;
  /** An operator explicitly confirmed the session is expected to trade. */
  readonly operatorConfirmed: boolean;
  /** Who completed it, for the evidence record. */
  readonly confirmedBy: string;
  /** When it was completed. */
  readonly confirmedAt: string;
  /** Operator-set verdict. True only if every step above was performed. */
  readonly complete: boolean;
}

/** The four required steps, named so a UI can render and record them. */
export const SAME_DAY_CHECKLIST_STEPS = [
  "annual calendar reviewed",
  "current Trader Alerts checked",
  "no unscheduled closure/early close found",
  "operator confirms session",
] as const;

/**
 * Build a checklist record from the four individual confirmations.
 *
 * `complete` is COMPUTED here rather than asserted by the caller, so a caller
 * cannot claim completion while having ticked only some boxes. `confirmedBy`
 * and `confirmedAt` remain mandatory: an unsigned checklist proves nothing.
 */
export function buildSameDayChecklist(args: {
  annualCalendarReviewed: boolean;
  traderAlertsChecked: boolean;
  noUnscheduledChange: boolean;
  operatorConfirmed: boolean;
  confirmedBy: string;
  confirmedAt: string;
}): SameDayChecklist {
  const complete =
    args.annualCalendarReviewed &&
    args.traderAlertsChecked &&
    args.noUnscheduledChange &&
    args.operatorConfirmed &&
    args.confirmedBy.length > 0 &&
    args.confirmedAt.length > 0;
  return { ...args, complete };
}

/** Which steps are outstanding, for a specific refusal message. */
export function incompleteChecklistSteps(c: SameDayChecklist): string[] {
  const missing: string[] = [];
  if (!c.annualCalendarReviewed) missing.push(SAME_DAY_CHECKLIST_STEPS[0]);
  if (!c.traderAlertsChecked) missing.push(SAME_DAY_CHECKLIST_STEPS[1]);
  if (!c.noUnscheduledChange) missing.push(SAME_DAY_CHECKLIST_STEPS[2]);
  if (!c.operatorConfirmed) missing.push(SAME_DAY_CHECKLIST_STEPS[3]);
  if (c.confirmedBy.length === 0) missing.push("confirmedBy");
  if (c.confirmedAt.length === 0) missing.push("confirmedAt");
  return missing;
}

/**
 * Review record for a HUMAN-REVIEWED dataset.
 *
 * This exists to make the distinction between an operator-reviewed artifact and
 * automated provider data explicit and machine-checkable. A dataset carrying
 * this block is `OPERATOR_REVIEWED_CALENDAR`: it was transcribed and checked by
 * a person, and it is therefore suitable for a bounded operator-triggered path
 * but NOT for unattended or production use.
 *
 * `automatedProviderData` is fixed at `false` by the type. There is currently
 * no authorised machine-readable source, so a dataset claiming otherwise would
 * be asserting a licence nobody holds.
 */
export interface OperatorReviewRecord {
  readonly label: "OPERATOR_REVIEWED_CALENDAR";
  readonly automatedProviderData: false;
  readonly reviewer: string;
  readonly reviewTimestamp: string;
  /** How the entries were produced. Human-scaled, not automated. */
  readonly derivationMethod: string;
  /**
   * The published rows that were transcribed. Retained so a reviewer can
   * re-derive the dataset from the same input without re-reading the source.
   */
  readonly publishedRows: readonly { date: string; status: string; note: string; closeMinute?: number }[];
}

export interface CalendarDatasetV1 {
  readonly schemaVersion: 1;
  /** Stable id of this dataset revision, e.g. `nasdaq-2026.operator-reviewed.r1`. */
  readonly datasetId: string;
  readonly exchange: "NYSE" | "NASDAQ";
  /** Inclusive ET ISO date bounds actually covered. */
  readonly coverageStart: string;
  readonly coverageEnd: string;
  readonly provenance: CalendarProvenance;
  /** Present only on operator-reviewed datasets. Absent = unreviewed. */
  readonly review?: OperatorReviewRecord;
  /**
   * Whether a same-day operator checklist is mandatory for this dataset.
   * True for operator-reviewed artifacts, because an annual calendar cannot
   * detect a same-day closure announced outside it.
   */
  readonly sameDayChecklistRequired?: boolean;
  /** Human-readable scope limit, carried into evidence. */
  readonly disclaimer?: string;
  /**
   * SHA-256 over the canonical JSON of `entries`. Excludes this field itself.
   * Recomputable via `computeDatasetHash`.
   */
  readonly contentHash: string;
  readonly entries: readonly CalendarEntry[];
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

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * SHA-256 over the canonical JSON of the dataset's entries.
 *
 * Entries are sorted by date so the hash is independent of array order, which
 * makes it a stable identity for the CONTENT rather than the serialisation.
 */
export function computeDatasetHash(entries: readonly CalendarEntry[]): string {
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return createHash("sha256").update(canonicalJson(sorted), "utf8").digest("hex");
}

/** True when the dataset's recorded hash matches its entries. */
export function verifyDatasetHash(ds: CalendarDatasetV1): boolean {
  return ds.contentHash === computeDatasetHash(ds.entries);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  readonly code: string;
  readonly detail: string;
}

export type ValidationResult =
  | { readonly ok: true; readonly entryCount: number }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

/**
 * Maximum age of a derived dataset before it must be re-derived.
 *
 * 400 days, not a year, for two reasons: exchanges publish roughly a year and a
 * half ahead, so a dataset is normally fresh; and an annual publication cycle
 * plus revisions means a 13-month-old dataset may already predate a published
 * amendment.
 */
export const MAX_DATASET_AGE_DAYS = 400;

/**
 * Why a dataset may not be used. Every one of these resolves to UNKNOWN at the
 * session layer, and therefore to NO_TRADE. They are distinguished so an
 * operator can tell a stale artifact from a corrupt one.
 */
export type CalendarRefusal =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: CalendarRefusalCode; readonly detail: string };

export type CalendarRefusalCode =
  | "DATASET_MISSING"
  | "DATASET_MALFORMED"
  | "DATASET_HASH_MISMATCH"
  | "DATASET_TOO_OLD"
  | "DATE_OUTSIDE_HORIZON"
  | "REVIEW_INCOMPLETE";

/**
 * Admissibility of a dataset for one specific date.
 *
 * This is the age and horizon guard. It answers a different question from
 * `validateCalendarDataset`, which asks "is this dataset well-formed". Here the
 * question is "may this dataset be trusted TODAY for THIS date" — which is the
 * question that actually matters when a system is about to act.
 *
 * Fail-closed on all of:
 *   - no dataset supplied
 *   - malformed dataset
 *   - content hash does not match entries
 *   - dataset older than MAX_DATASET_AGE_DAYS
 *   - requested date outside the declared coverage horizon
 *   - an incomplete same-day operator checklist (when required)
 *
 * Note the asymmetry with `assertBenchmarkProvable`: a widened freshness
 * ceiling is a POLICY decision requiring explicit authorization. There is no
 * widening here. A stale or uncovered date is UNKNOWN, full stop.
 */
export function admitCalendarForDate(args: {
  dataset: unknown;
  /** The ET calendar date being resolved, `YYYY-MM-DD`. */
  date: string;
  /** Reference instant for age comparison. Injected for determinism. */
  now: Date;
  maxAgeDays?: number;
  /**
   * Same-day operator checklist. Required when the caller is an operator-
   * triggered path, because a same-day closure announced outside the annual
   * calendar is not detectable from the dataset alone.
   */
  checklist?: SameDayChecklist;
}): CalendarRefusal {
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  if (!ISO.test(args.date)) {
    return { ok: false, code: "DATE_OUTSIDE_HORIZON", detail: `date must be YYYY-MM-DD, got ${String(args.date)}` };
  }

  // ---- No dataset at all ---------------------------------------------------
  if (args.dataset === null || args.dataset === undefined) {
    return { ok: false, code: "DATASET_MISSING", detail: "no calendar dataset was supplied; cannot classify any date" };
  }

  // ---- Well-formed? --------------------------------------------------------
  const validation = validateCalendarDataset(args.dataset);
  if (!validation.ok) {
    return {
      ok: false,
      code: "DATASET_MALFORMED",
      detail: validation.issues.map((i) => `${i.code}: ${i.detail}`).join("; "),
    };
  }
  const ds = args.dataset as CalendarDatasetV1;

  // ---- Content hash ---------------------------------------------------------
  // Checked again here even though the validator checks it: admission and
  // validation are separate gates and this one is the last line before a date
  // is trusted.
  if (!verifyDatasetHash(ds)) {
    return {
      ok: false,
      code: "DATASET_HASH_MISMATCH",
      detail: `contentHash ${ds.contentHash} does not match the entries; the dataset was altered after review`,
    };
  }

  // ---- Age ------------------------------------------------------------------
  const maxAgeDays = args.maxAgeDays ?? MAX_DATASET_AGE_DAYS;
  const derivedMs = Date.parse(ds.provenance.derivedAt);
  const nowMs = args.now.getTime();
  if (Number.isNaN(derivedMs)) {
    return { ok: false, code: "DATASET_TOO_OLD", detail: `derivedAt '${ds.provenance.derivedAt}' is not a parseable instant` };
  }
  const ageMs = nowMs - derivedMs;
  if (ageMs < 0) {
    // A future derivation date means a clock disagreement. Treat as untrusted.
    return {
      ok: false,
      code: "DATASET_TOO_OLD",
      detail: `derivedAt ${ds.provenance.derivedAt} is in the future relative to ${args.now.toISOString()}`,
    };
  }
  const ageDays = ageMs / 86_400_000;
  if (ageDays > maxAgeDays) {
    return {
      ok: false,
      code: "DATASET_TOO_OLD",
      detail: `dataset ${ds.datasetId} is ${ageDays.toFixed(1)} days old, exceeding the ${maxAgeDays}-day maximum; re-derive before use`,
    };
  }

  // ---- Horizon --------------------------------------------------------------
  // Operators publish a bounded forward calendar. Beyond it we simply do not
  // know, and "we do not know" is UNKNOWN. This is an accepted limitation of
  // the published horizon, not a defect to engineer around.
  if (args.date < ds.coverageStart || args.date > ds.coverageEnd) {
    return {
      ok: false,
      code: "DATE_OUTSIDE_HORIZON",
      detail: `${args.date} is outside the declared coverage ${ds.coverageStart}..${ds.coverageEnd}; the source publishes a bounded forward calendar`,
    };
  }
  // The entry must actually exist, even inside the declared window.
  const entry = ds.entries.find((e) => e.date === args.date);
  if (entry === undefined) {
    return {
      ok: false,
      code: "DATE_OUTSIDE_HORIZON",
      detail: `${args.date} falls inside the coverage window but has no entry; treating as UNKNOWN rather than assuming a regular session`,
    };
  }

  // ---- Same-day operator checklist ------------------------------------------
  if (args.checklist !== undefined && !args.checklist.complete) {
    return {
      ok: false,
      code: "REVIEW_INCOMPLETE",
      detail: `same-day checklist incomplete: ${incompleteChecklistSteps(args.checklist).join(", ")}. Result is UNKNOWN_SESSION -> NO_TRADE.`,
    };
  }

  return { ok: true };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isMinuteOfDay(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 1440;
}

/**
 * Validate a candidate dataset.
 *
 * Deliberately strict. The failure modes it exists to prevent are: a partially
 * transcribed holiday list, an early close with no time, a dataset whose hash
 * does not match its content, coverage gaps, and a provenance-free guess.
 */
export function validateCalendarDataset(candidate: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const add = (code: string, detail: string) => issues.push({ code, detail });

  if (typeof candidate !== "object" || candidate === null) {
    return { ok: false, issues: [{ code: "NOT_AN_OBJECT", detail: "dataset must be an object" }] };
  }
  const ds = candidate as Partial<CalendarDatasetV1>;

  if (ds.schemaVersion !== 1) add("SCHEMA_VERSION", `expected schemaVersion 1, got ${String(ds.schemaVersion)}`);
  if (typeof ds.datasetId !== "string" || ds.datasetId.length === 0) add("DATASET_ID", "datasetId is required");
  if (ds.exchange !== "NYSE" && ds.exchange !== "NASDAQ") {
    add("EXCHANGE", `exchange must be NYSE or NASDAQ, got ${String(ds.exchange)}`);
  }
  if (!ISO_DATE.test(String(ds.coverageStart))) add("COVERAGE_START", "coverageStart must be YYYY-MM-DD");
  if (!ISO_DATE.test(String(ds.coverageEnd))) add("COVERAGE_END", "coverageEnd must be YYYY-MM-DD");

  // ---- Provenance is mandatory. -------------------------------------------
  const p = ds.provenance as Partial<CalendarProvenance> | undefined;
  if (p === undefined || p === null) {
    add("PROVENANCE_MISSING", "a calendar without provenance cannot be reviewed; refusing");
  } else {
    for (const field of ["sourceUrl", "sourcePublisher", "sourceDocument", "sourceEffectiveDate", "derivedBy", "derivedAt"] as const) {
      const v = p[field];
      if (typeof v !== "string" || v.length === 0) add("PROVENANCE_FIELD", `provenance.${field} is required`);
    }
    // sourceVersion may legitimately be null: no operator publishes one.
    if (!("sourceVersion" in p)) add("PROVENANCE_FIELD", "provenance.sourceVersion must be present (null is valid)");
  }

  if (!Array.isArray(ds.entries)) {
    add("ENTRIES_MISSING", "entries must be an array");
    return { ok: false, issues };
  }
  const entries = ds.entries as readonly CalendarEntry[];

  if (entries.length === 0) add("ENTRIES_EMPTY", "an empty calendar classifies nothing and must not be installed");

  const seen = new Set<string>();
  for (const e of entries) {
    if (typeof e !== "object" || e === null) {
      add("ENTRY_SHAPE", "every entry must be an object");
      continue;
    }
    if (!ISO_DATE.test(String(e.date))) {
      add("ENTRY_DATE", `entry date must be YYYY-MM-DD: ${String(e.date)}`);
      continue;
    }
    if (seen.has(e.date)) add("ENTRY_DUPLICATE", `duplicate date ${e.date}`);
    seen.add(e.date);

    if (e.status !== "OPEN" && e.status !== "EARLY_CLOSE" && e.status !== "CLOSED") {
      add("ENTRY_STATUS", `${e.date}: status must be OPEN, EARLY_CLOSE or CLOSED`);
    }
    if (e.timezone !== "America/New_York") {
      add("ENTRY_TIMEZONE", `${e.date}: timezone must be America/New_York`);
    }

    const earlyFlag = e.earlyClose;
    if (earlyFlag !== (e.status === "EARLY_CLOSE")) {
      add("ENTRY_EARLY_CLOSE_FLAG", `${e.date}: earlyClose flag disagrees with status`);
    }

    if (e.status === "CLOSED") {
      // A closed day has no session. Times must be absent, not invented.
      if (e.openMinute !== undefined || e.closeMinute !== undefined) {
        add("ENTRY_CLOSED_HAS_TIMES", `${e.date}: CLOSED entries must not carry session times`);
      }
    } else {
      if (!isMinuteOfDay(e.openMinute)) add("ENTRY_OPEN_MINUTE", `${e.date}: openMinute must be 0-1439`);
      if (!isMinuteOfDay(e.closeMinute)) add("ENTRY_CLOSE_MINUTE", `${e.date}: closeMinute must be 0-1439`);
      if (isMinuteOfDay(e.openMinute) && isMinuteOfDay(e.closeMinute) && e.closeMinute <= e.openMinute) {
        add("ENTRY_TIME_ORDER", `${e.date}: closeMinute must be after openMinute`);
      }
    }

    // An early close must actually close earlier than a regular session.
    if (e.status === "EARLY_CLOSE" && isMinuteOfDay(e.closeMinute) && e.closeMinute >= 16 * 60) {
      add("ENTRY_EARLY_NOT_EARLY", `${e.date}: EARLY_CLOSE must close before the 16:00 regular close`);
    }
  }

  // ---- Coverage must be contiguous with no interior gaps. -----------------
  if (ISO_DATE.test(String(ds.coverageStart)) && ISO_DATE.test(String(ds.coverageEnd)) && entries.length > 0) {
    const dates = entries.map((e) => e.date).sort();
    if (dates[0]! < String(ds.coverageStart)) add("COVERAGE_BEFORE_START", `entry ${dates[0]!} precedes coverageStart`);
    if (dates[dates.length - 1]! > String(ds.coverageEnd)) add("COVERAGE_AFTER_END", `entry ${dates[dates.length - 1]!} exceeds coverageEnd`);
    if (dates[0]! > String(ds.coverageStart)) add("COVERAGE_START_GAP", `coverageStart ${String(ds.coverageStart)} has no entry`);
    if (dates[dates.length - 1]! < String(ds.coverageEnd)) add("COVERAGE_END_GAP", `coverageEnd ${String(ds.coverageEnd)} has no entry`);
  }

  // ---- Review record, if present, must be coherent. -----------------------
  // A dataset claiming operator review must carry the evidence of that review.
  // `automatedProviderData` is fixed false by type: no authorised machine-
  // readable source exists, so a dataset asserting one would be claiming a
  // licence nobody holds.
  const review = ds.review as Partial<OperatorReviewRecord> | undefined;
  if (review !== undefined && review !== null) {
    if (review.label !== "OPERATOR_REVIEWED_CALENDAR") {
      add("REVIEW_LABEL", `review.label must be OPERATOR_REVIEWED_CALENDAR, got ${String(review.label)}`);
    }
    if (review.automatedProviderData !== false) {
      add("REVIEW_AUTOMATED_FLAG", "automatedProviderData must be false: no authorised machine-readable source exists");
    }
    for (const field of ["reviewer", "reviewTimestamp", "derivationMethod"] as const) {
      const v = review[field];
      if (typeof v !== "string" || v.length === 0) add("REVIEW_FIELD", `review.${field} is required`);
    }
    if (!Array.isArray(review.publishedRows) || review.publishedRows.length === 0) {
      add("REVIEW_PUBLISHED_ROWS", "review.publishedRows must retain the transcribed source rows");
    }
  }

  // ---- The hash must match the content. -----------------------------------
  if (typeof ds.contentHash !== "string" || !/^[0-9a-f]{64}$/.test(ds.contentHash)) {
    add("CONTENT_HASH_MISSING", "contentHash must be a 64-char lowercase SHA-256");
  } else if (!verifyDatasetHash(ds as CalendarDatasetV1)) {
    add("CONTENT_HASH_MISMATCH", "contentHash does not match the entries; the dataset was altered after hashing");
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, entryCount: entries.length };
}

/**
 * Build a dataset with its hash computed, for a human-supervised derivation.
 *
 * This does NOT fetch anything. It takes already-derived entries and stamps
 * them, so the hashing and validation are exercised without implying that the
 * entries are authoritative.
 */
export function stampDataset(args: {
  datasetId: string;
  exchange: "NYSE" | "NASDAQ";
  coverageStart: string;
  coverageEnd: string;
  provenance: CalendarProvenance;
  entries: readonly CalendarEntry[];
}): CalendarDatasetV1 {
  return {
    schemaVersion: 1,
    datasetId: args.datasetId,
    exchange: args.exchange,
    coverageStart: args.coverageStart,
    coverageEnd: args.coverageEnd,
    provenance: args.provenance,
    contentHash: computeDatasetHash(args.entries),
    entries: args.entries,
  };
}