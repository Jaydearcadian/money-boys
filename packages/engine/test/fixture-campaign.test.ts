import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runFixtureCampaign } from "../src/campaign/fixture-campaign.js";
import type { CalendarDay, TradingCalendar } from "../src/agents/session-calendar.js";

/**
 * Fixture-backed open-hours campaign.
 *
 * The campaign SHAPE is proven here, not a live trade: a known regular open
 * session, a fresh receipt-relative benchmark, a positive edge, and the full
 * open -> read-back -> close -> flatten -> FLAT lifecycle.
 *
 * Zero network. Zero venue contact beyond the scripted double. Every negative
 * scenario asserts `venueContacts === 0`.
 */

const TRADING_DAY = "2026-10-05"; // Monday
const OPEN_ET = new Date("2026-10-05T16:30:00.000Z"); // 12:30 ET
const CLOSED_ET = new Date("2026-10-05T21:00:00.000Z"); // 17:00 ET

function calendarOf(days: CalendarDay[]): TradingCalendar {
  const map: Record<string, CalendarDay> = {};
  for (const d of days) map[d.date] = d;
  return { id: "campaign-test-cal", exchange: "NYSE", days: map };
}
const REGULAR = calendarOf([{ date: TRADING_DAY, type: "REGULAR" }]);

describe("fixture campaign — happy path", () => {
  it("completes the full lifecycle and ends FLAT", async () => {
    const r = await runFixtureCampaign({ now: OPEN_ET, calendar: REGULAR });
    assert.equal(r.decision, "DISPATCHED_AND_FLAT");
    assert.equal(r.eligible, true);
    assert.equal(r.finalFlat, true, "account must be FLAT at the end");
  });

  it("performs exactly one open and one close against the venue", async () => {
    const r = await runFixtureCampaign({ now: OPEN_ET, calendar: REGULAR });
    assert.equal(r.venueContacts, 2);
    assert.deepEqual(r.calls.map((c) => c.method), ["dispatch", "closePosition"]);
  });

  it("records read-back for both the open and the flatten", async () => {
    const r = await runFixtureCampaign({ now: OPEN_ET, calendar: REGULAR });
    const names = r.steps.map((s) => s.step);
    assert.ok(names.includes("read_back_open"));
    assert.ok(names.includes("read_back_flat"));
  });

  it("binds the same receipt hash to both venue calls", async () => {
    const r = await runFixtureCampaign({ now: OPEN_ET, calendar: REGULAR });
    const hashes = new Set(r.calls.map((c) => c.receiptHash));
    assert.equal(hashes.size, 1, "open and close must share one sealed receipt");
    assert.equal([...hashes][0], r.receiptHash);
  });

  it("passes every recorded step", async () => {
    const r = await runFixtureCampaign({ now: OPEN_ET, calendar: REGULAR });
    const failed = r.steps.filter((s) => !s.ok);
    assert.deepEqual(failed, [], "all lifecycle steps must pass");
  });
});

describe("fixture campaign — read-back is load-bearing", () => {
  it("detects a venue that reports a different symbol than it filled", async () => {
    // The fill response claims one thing; the position book says another. The
    // read-back step must fail, which is the entire reason it exists.
    const r = await runFixtureCampaign({ now: OPEN_ET, calendar: REGULAR, fillMismatchSymbol: true });
    const readBack = r.steps.find((s) => s.step === "read_back_open");
    assert.ok(readBack);
    assert.equal(readBack.ok, false, "a symbol mismatch must fail the read-back");
    const detail = readBack.detail as { venueReportedSymbol: string };
    assert.equal(detail.venueReportedSymbol, "SOMEOTHERUSDT");
  });
});

describe("fixture campaign — negative scenarios contact nothing", () => {
  it("refuses a closed session with zero venue contacts", async () => {
    const r = await runFixtureCampaign({ now: CLOSED_ET, calendar: REGULAR });
    assert.equal(r.decision, "NO_TRADE");
    assert.equal(r.venueContacts, 0);
    assert.equal(r.finalFlat, true);
  });

  it("refuses a holiday with zero venue contacts", async () => {
    const r = await runFixtureCampaign({
      now: OPEN_ET,
      calendar: calendarOf([{ date: TRADING_DAY, type: "HOLIDAY", note: "Test holiday" }]),
    });
    assert.equal(r.decision, "NO_TRADE");
    assert.equal(r.venueContacts, 0);
    assert.equal(r.steps[0]!.ok, false);
  });

  it("refuses an early close once the early close time has passed", async () => {
    // Early close 13:00 ET = 17:00Z. Campaign at 17:30 ET is after it.
    const r = await runFixtureCampaign({
      now: new Date("2026-10-05T21:30:00.000Z"),
      calendar: calendarOf([{ date: TRADING_DAY, type: "EARLY_CLOSE", closeMinute: 13 * 60 }]),
    });
    assert.equal(r.decision, "NO_TRADE");
    assert.equal(r.venueContacts, 0);
  });

  it("refuses an unknown calendar date with zero venue contacts", async () => {
    const r = await runFixtureCampaign({ now: OPEN_ET, calendar: calendarOf([]) });
    assert.equal(r.decision, "NO_TRADE");
    assert.equal(r.venueContacts, 0);
    assert.equal((r.steps[0]!.detail as { code: string }).code, "UNKNOWN_CALENDAR_DAY");
  });

  it("refuses a weekend with zero venue contacts", async () => {
    // 2026-10-03 is a Saturday.
    const r = await runFixtureCampaign({
      now: new Date("2026-10-03T16:30:00.000Z"),
      calendar: calendarOf([{ date: "2026-10-03", type: "REGULAR" }]),
    });
    assert.equal(r.decision, "NO_TRADE");
    assert.equal(r.venueContacts, 0);
    assert.equal((r.steps[0]!.detail as { code: string }).code, "WEEKEND");
  });

  it("refuses when there is no positive edge, with zero venue contacts", async () => {
    const r = await runFixtureCampaign({ now: OPEN_ET, calendar: REGULAR, freshOpenPositiveEdge: false });
    assert.equal(r.decision, "NO_TRADE");
    assert.equal(r.venueContacts, 0);
  });

  it("refuses a packet that aged out between admission and dispatch", async () => {
    // Admitted fresh, dispatched 20s later: past the 15s gate.
    const r = await runFixtureCampaign({ now: OPEN_ET, calendar: REGULAR, dispatchDelayMs: 20_000 });
    assert.equal(r.decision, "NO_TRADE");
    assert.equal(r.venueContacts, 0, "an expired-at-dispatch packet must not reach the venue");
  });

  it("accepts a dispatch that happens promptly", async () => {
    const r = await runFixtureCampaign({ now: OPEN_ET, calendar: REGULAR, dispatchDelayMs: 1_000 });
    assert.equal(r.decision, "DISPATCHED_AND_FLAT");
    assert.equal(r.finalFlat, true);
  });
});

describe("fixture campaign — it proves shape, not a live trade", () => {
  it("is not authorized as live campaign evidence", () => {
    // A standing reminder encoded as an assertion: this harness must never be
    // treated as a Demo campaign. GAP-017 and GAP-019 remain open gates.
    assert.equal(typeof runFixtureCampaign, "function");
    assert.ok(
      !process.env.BITGET_API_KEY,
      "fixture campaign must run without venue credentials in the environment",
    );
  });
});
describe("fixture campaign — dispatch-boundary checklist", () => {
  it("reaches the venue when the checklist is complete", async () => {
    const r = await runFixtureCampaign({ now: OPEN_ET, calendar: REGULAR });
    assert.equal(r.decision, "DISPATCHED_AND_FLAT");
    assert.equal(r.venueContacts, 2);
  });

  it("contacts NOTHING when the checklist is incomplete", async () => {
    // Trader Alerts unchecked: the exact gap that makes an annual calendar
    // insufficient on the day. Dispatch must refuse.
    const r = await runFixtureCampaign({
      now: OPEN_ET, calendar: REGULAR,
      sameDayChecklist: {
        annualCalendarReviewed: true, traderAlertsChecked: false,
        noUnscheduledChange: true, operatorConfirmed: true,
        confirmedBy: "fixture operator", confirmedAt: OPEN_ET.toISOString(),
      },
    });
    assert.equal(r.decision, "NO_TRADE");
    assert.equal(r.venueContacts, 0, "an unchecked Trader Alert feed must not authorise an order");
    assert.equal(r.finalFlat, true);
  });

  it("contacts NOTHING when no operator has confirmed the session", async () => {
    const r = await runFixtureCampaign({
      now: OPEN_ET, calendar: REGULAR,
      sameDayChecklist: {
        annualCalendarReviewed: true, traderAlertsChecked: true,
        noUnscheduledChange: true, operatorConfirmed: false,
        confirmedBy: "fixture operator", confirmedAt: OPEN_ET.toISOString(),
      },
    });
    assert.equal(r.decision, "NO_TRADE");
    assert.equal(r.venueContacts, 0);
  });

  it("contacts NOTHING when the checklist is unsigned", async () => {
    const r = await runFixtureCampaign({
      now: OPEN_ET, calendar: REGULAR,
      sameDayChecklist: {
        annualCalendarReviewed: true, traderAlertsChecked: true,
        noUnscheduledChange: true, operatorConfirmed: true,
        confirmedBy: "", confirmedAt: "",
      },
    });
    assert.equal(r.decision, "NO_TRADE");
    assert.equal(r.venueContacts, 0);
  });
});
