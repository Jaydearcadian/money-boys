import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  admitCalendarForDate,
  buildSameDayChecklist,
  buildSessionVerification,
  computeDatasetHash,
  incompleteChecklistSteps,
  MAX_DATASET_AGE_DAYS,
  validateCalendarDataset,
  verifyDatasetHash,
  type CalendarDatasetV1,
  type CalendarEntry,
  type CalendarProvenance,
  type SameDayChecklist,
} from "../src/agents/calendar-dataset.js";
import { resolveSession, type CalendarDay, type TradingCalendar } from "../src/agents/session-calendar.js";

/**
 * Dataset-age guard and the OPERATOR_REVIEWED_CALENDAR artifact.
 *
 * Two things are proven here:
 *   1. Age and horizon fail closed. A valid-but-old dataset must not be used,
 *      and a date beyond the published horizon must resolve to UNKNOWN.
 *   2. The checked-in 2026 artifact is internally coherent and its derived
 *      session classifications match the official published table.
 *
 * SCOPE LIMIT: this proves the ARTIFACT is coherent and the GUARD refuses bad
 * input. It does NOT prove the artifact will be re-derived when Nasdaq amends
 * the calendar, and it is NOT a production readiness claim. GAP-017 remains
 * PARTIAL/BLOCKED_EXTERNAL.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ARTIFACT_PATH = join(HERE, "..", "..", "..", "foundry", "evidence", "p11", "calendar", "nasdaq-2026.operator-reviewed.json");
const ARTIFACT = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as CalendarDatasetV1;

const NOW = new Date("2026-10-01T12:00:00.000Z");

/** Adapt the reviewed dataset into the resolver's TradingCalendar shape. */
function toTradingCalendar(ds: CalendarDatasetV1): TradingCalendar {
  const days: Record<string, CalendarDay> = {};
  for (const e of ds.entries) {
    days[e.date] = {
      date: e.date,
      type: e.status === "OPEN" ? "REGULAR" : e.status === "CLOSED" ? "HOLIDAY" : "EARLY_CLOSE",
      ...(e.closeMinute !== undefined ? { closeMinute: e.closeMinute } : {}),
      note: e.note ?? "",
    };
  }
  return { id: ds.datasetId, exchange: "NASDAQ", days };
}
const CAL = toTradingCalendar(ARTIFACT);

/** ET instant helper. `et(date, 'HH:MM')` -> an absolute Date. */
function et(date: string, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const offsetGuess = date < "2026-11-01" || date > "2027-03-14" ? 4 : 5;
  return new Date(`${date}T${String(h + offsetGuess).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`);
}

const completeChecklist = (now = NOW): SameDayChecklist =>
  buildSameDayChecklist({
    annualCalendarReviewed: true,
    traderAlertsChecked: true,
    noUnscheduledChange: true,
    operatorConfirmed: true,
    confirmedBy: "fixture operator",
    confirmedAt: now.toISOString(),
  });

// ---------------------------------------------------------------------------
// Artifact integrity
// ---------------------------------------------------------------------------

describe("operator-reviewed artifact — integrity", () => {
  it("validates against the schema", () => {
    const r = validateCalendarDataset(ARTIFACT);
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it("verifies its own content hash", () => {
    assert.equal(verifyDatasetHash(ARTIFACT), true);
    assert.equal(ARTIFACT.contentHash, computeDatasetHash(ARTIFACT.entries));
  });

  it("is labelled as operator-reviewed, not automated provider data", () => {
    assert.equal(ARTIFACT.review?.label, "OPERATOR_REVIEWED_CALENDAR");
    assert.equal(ARTIFACT.review?.automatedProviderData, false);
    assert.ok((ARTIFACT.review?.reviewer ?? "").length > 0);
    assert.ok((ARTIFACT.review?.reviewTimestamp ?? "").length > 0);
    assert.ok((ARTIFACT.review?.derivationMethod ?? "").length > 0);
  });

  it("does not invent a source version", () => {
    // Nasdaq publishes no version identifier, so the field is explicitly null
    // rather than fabricated. This is the documented, correct state.
    assert.equal(ARTIFACT.provenance.sourceVersion, null);
    assert.equal("sourceVersion" in ARTIFACT.provenance, true);
  });

  it("requires the same-day checklist", () => {
    assert.equal(ARTIFACT.sameDayChecklistRequired, true);
  });

  it("stops at the published horizon and declares it", () => {
    assert.equal(ARTIFACT.coverageStart, "2026-01-01");
    assert.equal(ARTIFACT.coverageEnd, "2026-12-31");
    assert.ok(
      ARTIFACT.entries.every((e) => e.date >= ARTIFACT.coverageStart && e.date <= ARTIFACT.coverageEnd),
      "no entry may fall outside the declared coverage",
    );
  });

  it("retains the transcribed published rows for re-derivation", () => {
    assert.equal(ARTIFACT.review?.publishedRows.length, 12);
    // Thanksgiving and the day after must both be present.
    const dates = (ARTIFACT.review?.publishedRows ?? []).map((r) => r.date);
    assert.ok(dates.includes("2026-11-26"), "Thanksgiving Day");
    assert.ok(dates.includes("2026-11-27"), "day after Thanksgiving (early close)");
    assert.ok(dates.includes("2026-12-24"), "Christmas Eve (early close)");
  });

  it("stores times as ET wall-clock minutes, never UTC instants", () => {
    for (const e of ARTIFACT.entries) {
      assert.equal(e.timezone, "America/New_York");
    }
    const regular = ARTIFACT.entries.find((e) => e.status === "OPEN");
    assert.equal(regular?.openMinute, 570, "09:30 ET");
    assert.equal(regular?.closeMinute, 960, "16:00 ET");
    const early = ARTIFACT.entries.find((e) => e.status === "EARLY_CLOSE");
    assert.equal(early?.closeMinute, 780, "13:00 ET");
  });
});

// ---------------------------------------------------------------------------
// Dataset-age and horizon guard
// ---------------------------------------------------------------------------

describe("calendar admission — dataset age guard", () => {
  function aged(derivedAt: string): CalendarDatasetV1 {
    return { ...ARTIFACT, provenance: { ...ARTIFACT.provenance, derivedAt } };
  }

  it("admits a freshly derived dataset", () => {
    const r = admitCalendarForDate({ dataset: ARTIFACT, date: "2026-10-05", now: NOW });
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it("refuses a dataset genuinely older than the maximum age", () => {
    // derivedAt must be in the PAST to exercise the age branch. An earlier
    // version of this test set it in the future, which silently exercised the
    // clock-skew branch instead and left the age comparison unproven.
    const old = new Date(NOW.getTime() - (MAX_DATASET_AGE_DAYS + 30) * 86_400_000).toISOString();
    const r = admitCalendarForDate({ dataset: aged(old), date: "2026-10-05", now: NOW });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "DATASET_TOO_OLD");
    assert.match((r as { detail: string }).detail, /days old/);
  });

  it("admits a dataset just inside the maximum age", () => {
    const recent = new Date(NOW.getTime() - (MAX_DATASET_AGE_DAYS - 1) * 86_400_000).toISOString();
    const r = admitCalendarForDate({ dataset: aged(recent), date: "2026-10-05", now: NOW });
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it("refuses a 2027 date even when the dataset is still within its age limit", () => {
    // The scenario "a 2026 dataset in 2027" is actually caught by the HORIZON,
    // not by age. At 2027-06-01 the artifact is only ~243 days old and passes
    // the 400-day age limit -- but no 2027 date exists in it, so it must be
    // refused. Age and horizon are separate controls and either alone is
    // insufficient.
    const r = admitCalendarForDate({ dataset: ARTIFACT, date: "2027-01-04", now: new Date("2027-06-01T12:00:00.000Z") });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "DATE_OUTSIDE_HORIZON");
  });

  it("admits a covered 2026 date even when the wall clock is in early 2027", () => {
    // Age and horizon are independent: a still-fresh dataset may legitimately
    // resolve a covered date. What must never happen is resolving an UNCOVERED
    // date, which the horizon check above prevents.
    const r = admitCalendarForDate({ dataset: ARTIFACT, date: "2026-12-30", now: new Date("2027-01-15T12:00:00.000Z") });
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it("refuses a dataset whose derivedAt is in the future", () => {
    // A clock disagreement must not be read as "very fresh".
    const r = admitCalendarForDate({ dataset: aged("2027-01-01T00:00:00.000Z"), date: "2026-10-05", now: NOW });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "DATASET_TOO_OLD");
  });

  it("refuses a missing dataset", () => {
    const r = admitCalendarForDate({ dataset: null, date: "2026-10-05", now: NOW });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "DATASET_MISSING");
  });

  it("refuses a malformed dataset", () => {
    const r = admitCalendarForDate({ dataset: { schemaVersion: 9 }, date: "2026-10-05", now: NOW });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "DATASET_MALFORMED");
  });

  it("refuses a hash mismatch", () => {
    const tampered = { ...ARTIFACT, contentHash: "0".repeat(64) };
    const r = admitCalendarForDate({ dataset: tampered, date: "2026-10-05", now: NOW });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "DATASET_MALFORMED", "the validator catches it before the hash gate");
  });

  it("refuses an entry edited after hashing, even with the original hash", () => {
    const edited: CalendarDatasetV1 = {
      ...ARTIFACT,
      entries: ARTIFACT.entries.map((e: CalendarEntry) =>
        e.date === "2026-12-25" ? { ...e, status: "OPEN" as const, openMinute: 570, closeMinute: 960 } : e,
      ),
    };
    const r = admitCalendarForDate({ dataset: edited, date: "2026-10-05", now: NOW });
    assert.equal(r.ok, false);
    // The validator runs first and reports the hash failure as a defect in the
    // dataset, so the refusal surfaces as DATASET_MALFORMED. The important part
    // is that it is refused at all, and that the reason names the hash.
    assert.equal((r as { code: string }).code, "DATASET_MALFORMED");
    assert.match((r as { detail: string }).detail, /CONTENT_HASH_MISMATCH/);
  });

  it("refuses a date beyond the published horizon", () => {
    const r = admitCalendarForDate({ dataset: ARTIFACT, date: "2027-01-04", now: NOW });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "DATE_OUTSIDE_HORIZON");
  });

  it("refuses a date before the published horizon", () => {
    const r = admitCalendarForDate({ dataset: ARTIFACT, date: "2025-12-31", now: NOW });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "DATE_OUTSIDE_HORIZON");
  });

  it("refuses a weekend, which has no entry", () => {
    const r = admitCalendarForDate({ dataset: ARTIFACT, date: "2026-10-03", now: NOW });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "DATE_OUTSIDE_HORIZON");
  });

  it("refuses a malformed date string", () => {
    const r = admitCalendarForDate({ dataset: ARTIFACT, date: "10/05/2026", now: NOW });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "DATE_OUTSIDE_HORIZON");
  });
});

// ---------------------------------------------------------------------------
// Same-day checklist
// ---------------------------------------------------------------------------

describe("calendar admission — same-day operator checklist", () => {
  it("admits when every step is confirmed", () => {
    const r = admitCalendarForDate({ dataset: ARTIFACT, date: "2026-10-05", now: NOW, checklist: completeChecklist() });
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it("refuses when Trader Alerts were not checked", () => {
    // The single most important step: a same-day closure is invisible to the
    // annual calendar, so skipping this check is what lets a stale-but-valid
    // calendar authorise a trade on a closed market.
    const r = admitCalendarForDate({
      dataset: ARTIFACT, date: "2026-10-05", now: NOW,
      checklist: buildSameDayChecklist({
        annualCalendarReviewed: true, traderAlertsChecked: false,
        noUnscheduledChange: true, operatorConfirmed: true,
        confirmedBy: "op", confirmedAt: NOW.toISOString(),
      }),
    });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "REVIEW_INCOMPLETE");
    assert.match((r as { detail: string }).detail, /Trader Alerts/);
    assert.match((r as { detail: string }).detail, /UNKNOWN_SESSION -> NO_TRADE/);
  });

  it("refuses when the operator has not confirmed the session", () => {
    const r = admitCalendarForDate({
      dataset: ARTIFACT, date: "2026-10-05", now: NOW,
      checklist: buildSameDayChecklist({
        annualCalendarReviewed: true, traderAlertsChecked: true,
        noUnscheduledChange: true, operatorConfirmed: false,
        confirmedBy: "op", confirmedAt: NOW.toISOString(),
      }),
    });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "REVIEW_INCOMPLETE");
  });

  it("cannot claim completion with unchecked boxes", () => {
    const c = buildSameDayChecklist({
      annualCalendarReviewed: true, traderAlertsChecked: false,
      noUnscheduledChange: false, operatorConfirmed: false,
      confirmedBy: "", confirmedAt: "",
    });
    assert.equal(c.complete, false, "complete is computed, not asserted by the caller");
    assert.deepEqual(incompleteChecklistSteps(c), [
      "current Trader Alerts checked",
      "no unscheduled closure/early close found",
      "operator confirms session",
      "confirmedBy",
      "confirmedAt",
    ]);
  });

  it("refuses an unsigned checklist even with every box ticked", () => {
    const c = buildSameDayChecklist({
      annualCalendarReviewed: true, traderAlertsChecked: true,
      noUnscheduledChange: true, operatorConfirmed: true,
      confirmedBy: "", confirmedAt: NOW.toISOString(),
    });
    assert.equal(c.complete, false);
    const r = admitCalendarForDate({ dataset: ARTIFACT, date: "2026-10-05", now: NOW, checklist: c });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "REVIEW_INCOMPLETE");
  });
});

// ---------------------------------------------------------------------------
// Derived sessions match the official published table
// ---------------------------------------------------------------------------

describe("operator-reviewed artifact — derived sessions", () => {
  const cases: [string, string, boolean][] = [
    ["2026-10-05", "12:30", true],  // ordinary Monday
    ["2026-01-19", "12:30", false], // MLK Day
    ["2026-02-16", "12:30", false], // Presidents Day
    ["2026-04-03", "12:30", false], // Good Friday
    ["2026-06-19", "12:30", false], // Juneteenth
    ["2026-07-03", "12:30", false], // Independence Day observed
    ["2026-09-07", "12:30", false], // Labor Day
    ["2026-11-26", "12:30", false], // Thanksgiving
    ["2026-12-25", "12:30", false], // Christmas
    ["2026-11-27", "12:30", true],  // early close day, before 13:00
    ["2026-12-24", "12:30", true],  // early close day, before 13:00
  ];

  for (const [date, hhmm, tradable] of cases) {
    it(`classifies ${date} at ${hhmm} ET as ${tradable ? "tradable" : "not tradable"}`, () => {
      const v = resolveSession({ now: et(date, hhmm), calendar: CAL });
      assert.equal(v.tradable, tradable, `${date}: got ${(v as { code?: string }).code ?? "TRADABLE"}`);
      assert.equal(v.date, date);
    });
  }

  it("closes an early-close day at 13:00 ET", () => {
    const v = resolveSession({ now: et("2026-11-27", "13:00"), calendar: CAL });
    assert.equal(v.tradable, false);
    assert.equal((v as { code: string }).code, "AFTER_EARLY_CLOSE");
  });

  it("keeps an early-close day tradable right up to 13:00 ET", () => {
    const v = resolveSession({ now: et("2026-11-27", "12:59"), calendar: CAL });
    assert.equal(v.tradable, true);
    assert.equal(v.type, "EARLY_CLOSE");
  });

  it("refuses a 2027 date with no reviewed coverage", () => {
    // The published horizon stops at 2026. A 2027 date is UNKNOWN, not a
    // regular session by default.
    const v = resolveSession({ now: et("2027-01-04", "12:00"), calendar: CAL });
    assert.equal(v.tradable, false);
    assert.equal((v as { code: string }).code, "UNKNOWN_CALENDAR_DAY");
  });

  it("refuses weekends regardless of the reviewed dataset", () => {
    for (const d of ["2026-10-03", "2026-10-04"]) {
      const v = resolveSession({ now: et(d, "12:00"), calendar: CAL });
      assert.equal(v.tradable, false, `${d} must not trade`);
      assert.equal((v as { code: string }).code, "WEEKEND");
    }
  });

  it("carries the operator notes through to the resolver verdict", () => {
    const v = resolveSession({ now: et("2026-11-26", "12:00"), calendar: CAL });
    assert.match(v.note, /Thanksgiving/);
  });

  it("is DST-correct: session boundaries hold on both sides of a transition", () => {
    // 09:30 ET is 13:30Z under EDT and 14:30Z under EST. If the resolver
    // assumed a fixed offset, one of these would land outside the session.
    const edt = resolveSession({ now: new Date("2026-10-05T13:30:00.000Z"), calendar: CAL });
    assert.equal(edt.tradable, true, "09:30 ET under EDT must be inside the session");
    const est = resolveSession({ now: new Date("2026-11-30T14:30:00.000Z"), calendar: CAL });
    assert.equal(est.tradable, true, "09:30 ET under EST must be inside the session");
    // One hour before the open under either offset must be outside.
    assert.equal(resolveSession({ now: new Date("2026-10-05T12:30:00.000Z"), calendar: CAL }).tradable, false);
    assert.equal(resolveSession({ now: new Date("2026-11-30T13:30:00.000Z"), calendar: CAL }).tradable, false);
  });
});

// ---------------------------------------------------------------------------
// Scope limit
// ---------------------------------------------------------------------------

describe("operator-reviewed artifact — scope limit is not production readiness", () => {
  it("declares itself bounded and not automated", () => {
    assert.match(ARTIFACT.disclaimer ?? "", /BLOCKED/i);
    assert.match(ARTIFACT.disclaimer ?? "", /NOT licensed for automated ingestion/i);
    assert.equal(ARTIFACT.review?.automatedProviderData, false);
  });

  it("covers exactly one calendar year, so it cannot outlive its horizon", () => {
    const years = new Set(ARTIFACT.entries.map((e) => e.date.slice(0, 4)));
    assert.deepEqual([...years], ["2026"]);
  });

  it("records that the source publishes no version identifier", () => {
    assert.equal(ARTIFACT.provenance.sourceVersion, null);
    assert.ok((ARTIFACT.provenance.sourceLastModified === null) || typeof ARTIFACT.provenance.sourceLastModified === "string");
  });
});
// ---------------------------------------------------------------------------
// Read-only observation proceeds with the weaker, accurate label
//
// The checklist moved to the dispatch boundary. A non-authoritative read no
// longer needs a signed attestation, but it must NEVER be described as fully
// session-verified.
// ---------------------------------------------------------------------------

describe("session verification label — weaker but accurate", () => {
  it("labels a read with no checklist ANNUAL_CALENDAR_ONLY", () => {
    const r = buildSessionVerification({});
    assert.equal(r.sessionVerification, "ANNUAL_CALENDAR_ONLY");
    assert.equal(r.sameDayAlertsChecked, false);
    assert.equal(r.calendarBasis, "ANNUAL_CALENDAR_ONLY");
    assert.equal(r.sameDayChecklistComplete, false);
  });

  it("is never dispatch-eligible regardless of checklist state", () => {
    const complete = buildSameDayChecklist({
      annualCalendarReviewed: true, traderAlertsChecked: true, noUnscheduledChange: true,
      operatorConfirmed: true, confirmedBy: "op", confirmedAt: "2026-10-01T00:00:00.000Z",
    });
    assert.equal(buildSessionVerification({ checklist: complete }).dispatchEligible, false);
    assert.equal(buildSessionVerification({}).dispatchEligible, false);
  });

  it("upgrades the label only when a COMPLETE checklist is supplied", () => {
    const complete = buildSameDayChecklist({
      annualCalendarReviewed: true, traderAlertsChecked: true, noUnscheduledChange: true,
      operatorConfirmed: true, confirmedBy: "op", confirmedAt: "2026-10-01T00:00:00.000Z",
    });
    const r = buildSessionVerification({ checklist: complete });
    assert.equal(r.sessionVerification, "SAME_DAY_ALERTS_VERIFIED");
    assert.equal(r.sameDayAlertsChecked, true);
    assert.equal(r.calendarBasis, "ANNUAL_CALENDAR_PLUS_ALERTS");
    // Even here it grants nothing.
    assert.equal(r.dispatchEligible, false);
  });

  it("does not upgrade the label for an incomplete checklist", () => {
    const partial = buildSameDayChecklist({
      annualCalendarReviewed: true, traderAlertsChecked: false, noUnscheduledChange: true,
      operatorConfirmed: true, confirmedBy: "op", confirmedAt: "2026-10-01T00:00:00.000Z",
    });
    const r = buildSessionVerification({ checklist: partial });
    assert.equal(r.sessionVerification, "ANNUAL_CALENDAR_ONLY");
    assert.equal(r.sameDayAlertsChecked, false);
  });

  it("admits calendar dates for observation WITHOUT a checklist", () => {
    // The whole point of the change: a read-only run is no longer blocked.
    const r = admitCalendarForDate({ dataset: ARTIFACT, date: "2026-10-05", now: NOW });
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it("still fails closed when a checklist IS supplied but incomplete", () => {
    // Opt-in enforcement is retained so an explicit request is honoured.
    const partial = buildSameDayChecklist({
      annualCalendarReviewed: true, traderAlertsChecked: false, noUnscheduledChange: false,
      operatorConfirmed: false, confirmedBy: "op", confirmedAt: NOW.toISOString(),
    });
    const r = admitCalendarForDate({ dataset: ARTIFACT, date: "2026-10-05", now: NOW, checklist: partial });
    assert.equal(r.ok, false);
    assert.equal((r as { code: string }).code, "REVIEW_INCOMPLETE");
  });

  it("still refuses a stale or uncovered dataset for observation", () => {
    // Weakening the checklist must NOT weaken any other gate.
    const stale = { ...ARTIFACT, provenance: { ...ARTIFACT.provenance, derivedAt: "2020-01-01T00:00:00.000Z" } };
    assert.equal(admitCalendarForDate({ dataset: stale, date: "2026-10-05", now: NOW }).ok, false);
    assert.equal(admitCalendarForDate({ dataset: null, date: "2026-10-05", now: NOW }).ok, false);
    assert.equal(admitCalendarForDate({ dataset: ARTIFACT, date: "2027-01-04", now: NOW }).ok, false);
  });
});
