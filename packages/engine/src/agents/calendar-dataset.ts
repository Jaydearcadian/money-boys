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

export interface CalendarDatasetV1 {
  readonly schemaVersion: 1;
  /** Stable id of this dataset revision, e.g. `nyse-2026-2028.r1`. */
  readonly datasetId: string;
  readonly exchange: "NYSE" | "NASDAQ";
  /** Inclusive ET ISO date bounds actually covered. */
  readonly coverageStart: string;
  readonly coverageEnd: string;
  readonly provenance: CalendarProvenance;
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