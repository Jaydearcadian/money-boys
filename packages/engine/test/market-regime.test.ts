import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HOLIDAY_LIMITATION,
  TRADFI_CLOSE_MINUTE,
  TRADFI_OPEN_MINUTE,
  BenchmarkFreshnessUnprovableError,
  assessBenchmarkFreshness,
  assertBenchmarkProvable,
  etWallClockToInstant,
  isTradfiOpen,
  nextReopenInstant,
  requiredBenchmarkSourceFor,
  resolveRegime,
  toEtWallClock,
} from "../src/agents/market-regime.js";

/**
 * Market regime + benchmark freshness guards.
 *
 * Two reproduced defects motivated this module:
 *   - the pre-flight hardcoded hoursToClose: 1, so carry was understated ~65x
 *     during the Friday->Monday window it exists to model
 *   - the GAP-015 freshness control existed but was never called by the real
 *     packet path, and the Bitget MCP quote publishes NO timestamp, so
 *     freshness was unverifiable and being treated as fine
 */

const MAX_AGE = 96 * 60 * 60 * 1000; // one TradFi weekend
const u = (iso: string): Date => new Date(iso);

describe("ET wall-clock conversion", () => {
  it("converts UTC to ET wall-clock (EST, UTC-5)", () => {
    const wc = toEtWallClock(u("2026-01-15T15:00:00Z"));
    assert.equal(wc.hour, 10);
    assert.equal(wc.weekday, 4); // Thursday
  });

  it("converts UTC to ET wall-clock (EDT, UTC-4)", () => {
    const wc = toEtWallClock(u("2026-07-15T15:00:00Z"));
    assert.equal(wc.hour, 11); // one hour later in DST
    assert.equal(wc.weekday, 3); // Wednesday
  });

  it("round-trips wall-clock back to an instant across DST", () => {
    // Winter (EST) and summer (EDT) must both round-trip.
    for (const iso of ["2026-01-15T14:30:00Z", "2026-07-15T13:30:00Z"]) {
      const d = u(iso);
      const wc = toEtWallClock(d);
      const back = etWallClockToInstant(wc);
      assert.equal(back.getTime(), d.getTime(), `round trip failed for ${iso}`);
    }
  });

  it("normalises midnight to hour 0 rather than 24", () => {
    const wc = toEtWallClock(u("2026-01-15T05:00:00Z")); // 00:00 ET
    assert.ok(wc.hour === 0 || wc.hour === 24);
    const back = etWallClockToInstant({ ...wc, hour: 0 });
    assert.equal(toEtWallClock(back).day, 15);
  });
});

describe("session boundary detection", () => {
  it("is closed before the open, at the open, and at the close", () => {
    // 2026-09-30 is a Wednesday (EDT, UTC-4).
    assert.equal(isTradfiOpen(toEtWallClock(u("2026-09-30T13:29:00Z"))), false); // 09:29 ET
    assert.equal(isTradfiOpen(toEtWallClock(u("2026-09-30T13:30:00Z"))), true); //  09:30 ET
    assert.equal(isTradfiOpen(toEtWallClock(u("2026-09-30T19:59:00Z"))), true); //  15:59 ET
    assert.equal(isTradfiOpen(toEtWallClock(u("2026-09-30T20:00:00Z"))), false); // 16:00 ET
  });

  it("is closed at the weekend", () => {
    assert.equal(isTradfiOpen(toEtWallClock(u("2026-10-03T15:00:00Z"))), false); // Saturday
    assert.equal(isTradfiOpen(toEtWallClock(u("2026-10-04T15:00:00Z"))), false); // Sunday
  });

  it("exposes the regular-session bounds it uses", () => {
    assert.equal(TRADFI_OPEN_MINUTE, 570); //  09:30
    assert.equal(TRADFI_CLOSE_MINUTE, 960); // 16:00
  });
});

describe("carry horizon", () => {
  it("open-market regime uses ZERO carry", () => {
    const r = resolveRegime(u("2026-09-30T14:00:00Z")); // 10:00 ET Wednesday
    assert.equal(r.regime, "tradfi_open");
    assert.equal(r.hoursToNextReopen, 0);
    assert.equal(r.nextReopenAtIso, null);
    assert.equal(r.requiredBenchmarkSource, "live_intraday");
  });

  it("intraday closure carries to the SAME day close-of-session", () => {
    // 16:00 ET Wednesday (EDT, UTC-4 => 20:00Z) -> reopen tomorrow 09:30, 17.5h.
    const r = resolveRegime(u("2026-09-30T20:00:00Z"));
    assert.equal(r.regime, "tradfi_closed");
    assert.ok(Math.abs(r.hoursToNextReopen - 17.5) < 0.05, `got ${r.hoursToNextReopen}`);
    assert.equal(r.requiredBenchmarkSource, "latest_close");
  });

  it("Friday close to Monday open resolves to ~65.5 hours", () => {
    const r = resolveRegime(u("2026-10-02T20:00:00Z")); // Friday 16:00 ET exactly
    assert.equal(r.regime, "tradfi_closed");
    assert.ok(
      Math.abs(r.hoursToNextReopen - 65.5) < 0.05,
      `expected ~65.5h, got ${r.hoursToNextReopen}`,
    );
    assert.equal(r.nextReopenAtIso, "2026-10-05T13:30:00.000Z"); // Monday 09:30 EDT
  });

  it("late Friday evening carries to Monday morning", () => {
    const r = resolveRegime(u("2026-10-03T02:00:00Z")); // Friday 22:00 ET
    assert.ok(r.hoursToNextReopen > 0 && r.hoursToNextReopen < 65.5);
  });

  it("Saturday midday carries just over a day", () => {
    const r = resolveRegime(u("2026-10-03T16:00:00Z")); // Saturday 12:00 ET
    assert.equal(r.regime, "tradfi_closed");
    assert.ok(r.hoursToNextReopen > 20 && r.hoursToNextReopen < 46,
      `got ${r.hoursToNextReopen}`);
  });

  it("Monday pre-open resolves to the same-day 09:30", () => {
    const r = resolveRegime(u("2026-10-05T12:00:00Z")); // Monday 08:00 ET
    assert.equal(r.regime, "tradfi_closed");
    assert.ok(r.hoursToNextReopen > 1 && r.hoursToNextReopen < 2, `got ${r.hoursToNextReopen}`);
  });

  it("resolves a reopen within 7 days for every weekday of a week", () => {
    for (let d = 0; d < 7; d += 1) {
      // 21:00Z is 17:00 ET (EDT): after every weekday close.
      const r = resolveRegime(new Date(Date.UTC(2026, 9, 5 + d, 21, 0, 0)));
      assert.ok(r.hoursToNextReopen > 0 && r.hoursToNextReopen <= 72,
        `day ${d}: ${r.hoursToNextReopen}`);
    }
  });

  it("is deterministic", () => {
    const a = resolveRegime(u("2026-10-02T20:00:00Z"));
    const b = resolveRegime(u("2026-10-02T20:00:00Z"));
    assert.deepEqual(a, b);
  });

  it("nextReopenInstant always lands on a weekday 09:30 ET", () => {
    for (let h = 0; h < 24 * 9; h += 7) {
      const now = new Date(Date.UTC(2026, 9, 5, 0, 0, 0) + h * 3_600_000);
      const reopen = nextReopenInstant(now);
      const wc = toEtWallClock(reopen);
      assert.ok(wc.weekday >= 1 && wc.weekday <= 5, `reopen landed on weekday ${wc.weekday}`);
      assert.equal(wc.hour, 9);
      assert.equal(wc.minute, 30);
      assert.ok(reopen.getTime() > now.getTime(), "reopen must be in the future");
    }
  });

  it("handles the DST fall-back weekend without collapsing", () => {
    // 2026-11-01 is the US DST end date. The Saturday-to-Monday window is
    // ~42.5 real hours because the lost hour is inside it, which is exactly
    // why wall-clock arithmetic alone would be wrong.
    const r = resolveRegime(u("2026-10-31T20:00:00Z")); // Saturday 16:00 ET
    assert.equal(r.regime, "tradfi_closed");
    assert.ok(r.hoursToNextReopen > 40 && r.hoursToNextReopen < 45,
      `DST weekend horizon ${r.hoursToNextReopen}`);
    assert.equal(r.nextReopenAtIso, "2026-11-02T14:30:00.000Z"); // Mon 09:30 EST
  });

  it("the DST week is an hour SHORTER than the ordinary week", () => {
    const dstWeek = resolveRegime(u("2026-10-31T20:00:00Z")).hoursToNextReopen;
    const ordinary = resolveRegime(u("2026-10-02T20:00:00Z")).hoursToNextReopen;
    assert.ok(dstWeek < ordinary,
      `DST ${dstWeek} should be shorter than ordinary ${ordinary}`);
  });
});

describe("benchmark source selection by regime", () => {
  it("open hours require a source that publishes a timestamp", () => {
    assert.equal(requiredBenchmarkSourceFor("tradfi_open"), "EXPLICIT_TS_SOURCE");
  });

  it("closure may use the latest quote", () => {
    assert.equal(requiredBenchmarkSourceFor("tradfi_closed"), "BITGET_MCP_QUOTE");
  });
});

describe("benchmark freshness classification", () => {
  const now = u("2026-09-30T14:00:00Z");

  it("a real upstream timestamp yields verified_fresh", () => {
    const e = assessBenchmarkFreshness({
      price: 228.0852, source: "EXPLICIT_TS_SOURCE", provider: "bitget_data",
      sourceAsOf: u("2026-09-30T13:59:30Z").toISOString(),
      fetchedAt: now.toISOString(), maxAgeMs: MAX_AGE,
    });
    assert.equal(e.freshness, "verified_fresh");
    assert.equal(e.ageMs, 30_000);
  });

  it("a MISSING upstream timestamp is unverifiable, not fresh", () => {
    const e = assessBenchmarkFreshness({
      price: 228.0852, source: "BITGET_MCP_QUOTE", provider: "bitget_data",
      sourceAsOf: null, fetchedAt: now.toISOString(), maxAgeMs: MAX_AGE,
    });
    assert.equal(e.freshness, "unverifiable");
    assert.equal(e.sourceAsOf, null);
    assert.equal(e.ageMs, null);
    assert.match(e.notes, /UNPROVABLE/);
  });

  it("an old upstream timestamp yields verified_stale", () => {
    const e = assessBenchmarkFreshness({
      price: 128.8, source: "EXPLICIT_TS_SOURCE",
      sourceAsOf: u("2026-09-18T20:00:00Z").toISOString(),
      fetchedAt: now.toISOString(), maxAgeMs: MAX_AGE,
    });
    assert.equal(e.freshness, "verified_stale");
    assert.ok(e.ageMs! > MAX_AGE);
  });

  it("an unparseable timestamp is unverifiable", () => {
    const e = assessBenchmarkFreshness({
      price: 1, source: "EXPLICIT_TS_SOURCE", sourceAsOf: "yesterday",
      fetchedAt: now.toISOString(), maxAgeMs: MAX_AGE,
    });
    assert.equal(e.freshness, "unverifiable");
  });

  it("a future timestamp is unverifiable, not fresh", () => {
    const e = assessBenchmarkFreshness({
      price: 1, source: "EXPLICIT_TS_SOURCE",
      sourceAsOf: u("2026-09-30T15:00:00Z").toISOString(),
      fetchedAt: now.toISOString(), maxAgeMs: MAX_AGE,
    });
    assert.equal(e.freshness, "unverifiable");
  });

  it("LOCAL_SNAPSHOT is always unverifiable", () => {
    const e = assessBenchmarkFreshness({
      price: 128.8, source: "LOCAL_SNAPSHOT",
      sourceAsOf: u("2026-09-30T13:59:00Z").toISOString(),
      fetchedAt: now.toISOString(), maxAgeMs: MAX_AGE,
    });
    assert.equal(e.freshness, "unverifiable");
  });

  it("keeps sourceAsOf and fetchedAt distinct", () => {
    const e = assessBenchmarkFreshness({
      price: 1, source: "EXPLICIT_TS_SOURCE",
      sourceAsOf: "2026-09-30T13:00:00Z", fetchedAt: "2026-09-30T14:00:00Z",
      maxAgeMs: MAX_AGE,
    });
    // Both are preserved verbatim as supplied; neither is rewritten.
    assert.equal(e.sourceAsOf, "2026-09-30T13:00:00Z");
    assert.equal(e.fetchedAt, "2026-09-30T14:00:00Z");
    assert.notEqual(e.sourceAsOf, e.fetchedAt);
  });
});

describe("benchmark usability gate", () => {
  const now = u("2026-09-30T14:00:00Z");
  const mk = (sourceAsOf: string | null, source: "EXPLICIT_TS_SOURCE" | "BITGET_MCP_QUOTE" = "EXPLICIT_TS_SOURCE") =>
    assessBenchmarkFreshness({
      price: 228, source, sourceAsOf, fetchedAt: now.toISOString(), maxAgeMs: MAX_AGE,
    });

  it("open hours: a provably fresh benchmark is usable", () => {
    assert.doesNotThrow(() =>
      assertBenchmarkProvable(mk(u("2026-09-30T13:59:00Z").toISOString()), "tradfi_open"));
  });

  it("open hours: MISSING source timestamp blocks execution", () => {
    assert.throws(
      () => assertBenchmarkProvable(mk(null, "BITGET_MCP_QUOTE"), "tradfi_open"),
      BenchmarkFreshnessUnprovableError,
    );
  });

  it("open hours: STALE source timestamp blocks execution", () => {
    assert.throws(
      () => assertBenchmarkProvable(mk(u("2026-09-18T20:00:00Z").toISOString()), "tradfi_open"),
      BenchmarkFreshnessUnprovableError,
    );
  });

  it("closure: an unverifiable benchmark STILL blocks", () => {
    assert.throws(
      () => assertBenchmarkProvable(mk(null, "BITGET_MCP_QUOTE"), "tradfi_closed"),
      BenchmarkFreshnessUnprovableError,
    );
  });

  it("closure: a bounded-age benchmark is usable", () => {
    assert.doesNotThrow(() =>
      assertBenchmarkProvable(mk(u("2026-09-30T13:00:00Z").toISOString()), "tradfi_closed"));
  });

  it("closure: a benchmark beyond the 7-day ceiling blocks", () => {
    assert.throws(
      () => assertBenchmarkProvable(mk(u("2026-09-01T00:00:00Z").toISOString()), "tradfi_closed"),
      BenchmarkFreshnessUnprovableError,
    );
  });
});

describe("holiday handling is explicitly unsupported", () => {
  it("every snapshot declares the limitation", () => {
    const r = resolveRegime(u("2026-09-30T14:00:00Z"));
    assert.equal(r.holidayCalendarSupported, false);
    assert.equal(r.limitation, HOLIDAY_LIMITATION);
    assert.match(r.limitation, /NOT modelled/i);
  });

  it("a holiday is misreported as tradfi_open, which is the documented risk", () => {
    // 2026-11-26 is Thanksgiving. This module will say tradfi_open at 11:00 ET
    // even though the venue is shut. The test exists to pin that known gap
    // (GAP-017) rather than to hide it.
    const r = resolveRegime(u("2026-11-26T16:00:00Z"));
    assert.equal(r.regime, "tradfi_open");
    assert.equal(r.holidayCalendarSupported, false);
  });
});
