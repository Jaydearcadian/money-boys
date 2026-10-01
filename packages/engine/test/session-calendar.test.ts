import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSession, etDateKey, type TradingCalendar, type CalendarDay } from "../src/agents/session-calendar.js";

/**
 * GAP-017 calendar guard.
 *
 * The rule under test: a session is only tradable when the calendar SAYS it is.
 * Absence of a calendar entry is not evidence of a session, so an unrecognised
 * date fails closed.
 *
 * The calendar is INJECTED. Nothing here hard-codes a real trading calendar;
 * that would create a second unaudited source of truth.
 */

/** A minimal calendar covering only the dates a test cares about. */
function cal(days: CalendarDay[], id = "test-cal"): TradingCalendar {
  const map: Record<string, CalendarDay> = {};
  for (const d of days) map[d.date] = d;
  return { id, exchange: "NYSE", days: map };
}

const REGULAR = (date: string): CalendarDay => ({ date, type: "REGULAR" });

// 2026-10-05 is a Monday; 10-03 Sat, 10-04 Sun, 10-10 Sat, 10-11 Sun.
const MON = "2026-10-05";
const SAT = "2026-10-03";
const SUN = "2026-10-04";

/** ET wall-clock instant. `et()` builds an absolute instant from ET parts. */
function et(date: string, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  // October 2026: ET is UTC-4 (EDT). Build from the UTC equivalent.
  return new Date(`${date}T${String(h + 4).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`);
}

describe("session calendar — date derivation", () => {
  it("derives the ET calendar date, not the UTC date", () => {
    // 23:30 ET on the 5th is 03:30 UTC on the 6th. The ET date is the 5th.
    const lateEvening = new Date("2026-10-06T03:30:00.000Z");
    assert.equal(etDateKey(lateEvening), MON);
  });

  it("derives the ET date across the UTC midnight boundary", () => {
    const justAfterMidnightEt = new Date("2026-10-06T04:30:00.000Z"); // 00:30 ET on the 6th
    assert.equal(etDateKey(justAfterMidnightEt), "2026-10-06");
  });
});

describe("session calendar — regular sessions", () => {
  const calendar = cal([REGULAR(MON)]);

  it("accepts a regular session inside 09:30-16:00 ET", () => {
    const v = resolveSession({ now: et(MON, "12:00"), calendar });
    assert.equal(v.tradable, true);
    assert.equal(v.type, "REGULAR");
    assert.equal(v.openMinute, 9 * 60 + 30);
    assert.equal(v.closeMinute, 16 * 60);
  });

  it("accepts the opening instant itself", () => {
    const v = resolveSession({ now: et(MON, "09:30"), calendar });
    assert.equal(v.tradable, true);
  });

  it("rejects the closing instant itself", () => {
    // 16:00:00 ET is the close, not part of the session.
    const v = resolveSession({ now: et(MON, "16:00"), calendar });
    assert.equal(v.tradable, false);
    assert.equal((v as { code: string }).code, "AFTER_SESSION_CLOSE");
  });

  it("rejects one minute before the open", () => {
    const v = resolveSession({ now: et(MON, "09:29"), calendar });
    assert.equal(v.tradable, false);
    assert.equal((v as { code: string }).code, "BEFORE_SESSION_OPEN");
  });
});

describe("session calendar — GAP-017 fail-closed cases", () => {
  it("refuses a date absent from the calendar", () => {
    // 2026-10-06 is a Tuesday with no entry. NOT tradable.
    const v = resolveSession({ now: et("2026-10-06", "12:00"), calendar: cal([REGULAR(MON)]) });
    assert.equal(v.tradable, false);
    assert.equal((v as { code: string }).code, "UNKNOWN_CALENDAR_DAY");
    assert.match((v as { reason: string }).reason, /not present in calendar/);
  });

  it("refuses a declared holiday even at midday", () => {
    const calendar = cal([{ date: MON, type: "HOLIDAY", note: "Columbus Day" }]);
    const v = resolveSession({ now: et(MON, "12:00"), calendar });
    assert.equal(v.tradable, false);
    assert.equal((v as { code: string }).code, "HOLIDAY");
    assert.match((v as { reason: string }).reason, /Columbus Day/);
  });

  it("refuses an early close after the early close time", () => {
    // Early close at 13:00 ET (a real pattern: day after Thanksgiving).
    const calendar = cal([{ date: MON, type: "EARLY_CLOSE", closeMinute: 13 * 60, note: "1pm close" }]);
    const after = resolveSession({ now: et(MON, "13:00"), calendar });
    assert.equal(after.tradable, false);
    assert.equal((after as { code: string }).code, "AFTER_EARLY_CLOSE");
    // ...and accepts the session before it.
    const before = resolveSession({ now: et(MON, "12:59"), calendar });
    assert.equal(before.tradable, true);
    assert.equal(before.type, "EARLY_CLOSE");
    assert.equal(before.closeMinute, 13 * 60);
  });

  it("refuses an early open before the early open time", () => {
    const calendar = cal([{ date: MON, type: "EARLY_OPEN", openMinute: 11 * 60 }]);
    const v = resolveSession({ now: et(MON, "10:00"), calendar });
    assert.equal(v.tradable, false);
    assert.equal((v as { code: string }).code, "BEFORE_SESSION_OPEN");
    const after = resolveSession({ now: et(MON, "11:00"), calendar });
    assert.equal(after.tradable, true);
  });

  it("refuses a malformed entry whose close precedes its open", () => {
    const calendar = cal([{ date: MON, type: "EARLY_CLOSE", closeMinute: 9 * 60, openMinute: 10 * 60 }]);
    const v = resolveSession({ now: et(MON, "09:45"), calendar });
    assert.equal(v.tradable, false);
    assert.equal((v as { code: string }).code, "INVALID_CALENDAR_ENTRY");
  });

  it("refuses Saturdays and Sundays regardless of calendar contents", () => {
    // Even an explicit REGULAR entry cannot make a weekend tradable.
    const calendar = cal([REGULAR(SAT), REGULAR(SUN)]);
    for (const [date, day] of [[SAT, "10:00"], [SUN, "10:00"]] as const) {
      const v = resolveSession({ now: et(date, day), calendar });
      assert.equal(v.tradable, false, `${date} must never be tradable`);
      assert.equal((v as { code: string }).code, "WEEKEND");
    }
  });

  it("refuses an entirely empty calendar", () => {
    const v = resolveSession({ now: et(MON, "12:00"), calendar: cal([]) });
    assert.equal(v.tradable, false);
    assert.equal((v as { code: string }).code, "UNKNOWN_CALENDAR_DAY");
  });
});

describe("session calendar — DST awareness", () => {
  // Real US transitions: 2026-11-01 (fall back) and 2027-03-14 (spring
  // forward). Both are Sundays, which is itself worth pinning: a transition
  // always lands on the non-trading day, so the calendar must NOT treat a DST
  // day as tradable merely because the weekday looks ordinary elsewhere.
  //
  // Instants verified against
  // Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).

  const FALL_BACK = "2026-11-01";
  const SPRING_FWD = "2027-03-14";

  it("refuses a DST transition day: it is a Sunday", () => {
    for (const date of [FALL_BACK, SPRING_FWD]) {
      const calendar = cal([{ date, type: "REGULAR" }]);
      const v = resolveSession({ now: new Date(`${date}T19:00:00.000Z`), calendar });
      assert.equal(v.tradable, false, `${date} is a Sunday and must not trade`);
      assert.equal((v as { code: string }).code, "WEEKEND");
    }
  });

  it("classifies the Monday after a fall-back transition using the new offset", () => {
    // 2026-11-02 is the first trading day after DST ends. EST (UTC-5) applies.
    // 09:30 ET === 14:30Z.
    const date = "2026-11-02";
    const calendar = cal([{ date, type: "REGULAR" }]);
    const atOpen = resolveSession({ now: new Date(`${date}T14:30:00.000Z`), calendar });
    assert.equal(atOpen.tradable, true, "09:30 ET must be inside the session");
    assert.equal(atOpen.date, date);

    // One hour earlier is 08:30 ET: before the open.
    const preOpen = resolveSession({ now: new Date(`${date}T13:30:00.000Z`), calendar });
    assert.equal(preOpen.tradable, false);
    assert.equal((preOpen as { code: string }).code, "BEFORE_SESSION_OPEN");
  });

  it("classifies the Monday after a spring-forward transition using the new offset", () => {
    // 2027-03-15 is the first trading day after DST starts. EDT (UTC-4) applies.
    // 09:30 ET === 13:30Z.
    const date = "2027-03-15";
    const calendar = cal([{ date, type: "REGULAR" }]);
    const atOpen = resolveSession({ now: new Date(`${date}T13:30:00.000Z`), calendar });
    assert.equal(atOpen.tradable, true, "09:30 ET must be inside the session");

    // 08:30 ET === 12:30Z: before the open.
    const preOpen = resolveSession({ now: new Date(`${date}T12:30:00.000Z`), calendar });
    assert.equal(preOpen.tradable, false);
    assert.equal((preOpen as { code: string }).code, "BEFORE_SESSION_OPEN");
  });

  it("uses the ET date, so a late-ET-evening instant is classified on its ET day", () => {
    // 23:30 ET on 2026-11-02 is 04:30Z on 2026-11-03. The ET date governs, so
    // this is AFTER_SESSION_CLOSE on the 2nd, not a pre-open on the 3rd.
    const calendar = cal([{ date: "2026-11-02", type: "REGULAR" }]);
    const v = resolveSession({ now: new Date("2026-11-03T04:30:00.000Z"), calendar });
    assert.equal(v.tradable, false);
    assert.equal(v.date, "2026-11-02", "must classify on the ET date, not the UTC date");
    assert.equal((v as { code: string }).code, "AFTER_SESSION_CLOSE");
  });

  it("agrees with an independent Intl-derived ET wall clock", () => {
    // Cross-check the module's own date/minute derivation against Intl, which
    // is the authoritative IANA implementation.
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      dateStyle: "short",
      timeStyle: "medium",
      hour12: false,
    });
    const probes = [
      "2026-11-02T14:30:00.000Z",
      "2026-11-02T19:59:00.000Z",
      "2027-03-15T13:30:00.000Z",
      "2027-03-15T20:00:00.000Z",
    ];
    for (const iso of probes) {
      const [d, t] = fmt.format(new Date(iso)).split(", ");
      const expectedDate = d;
      const [hh, mm] = t.split(":").map(Number);
      const expectedMinute = hh * 60 + mm;
      const calendar = cal([{ date: expectedDate, type: "REGULAR" }]);
      const v = resolveSession({ now: new Date(iso), calendar });
      assert.equal(v.date, expectedDate, `date mismatch for ${iso}`);
      assert.equal(v.tradable, expectedMinute >= 9 * 60 + 30 && expectedMinute < 16 * 60, `verdict mismatch for ${iso}`);
    }
  });
});
