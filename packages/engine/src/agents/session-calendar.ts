/**
 * TradFi session calendar (GAP-017).
 *
 * WHY THIS EXISTS
 *   `resolveRegime` decides open/closed purely from the ET wall clock. It has
 *   no calendar, so on a market holiday or an early close it reports
 *   `tradfi_open` while the underlying venue is actually shut. A trading path
 *   that trusts it would admit a packet against a dead market.
 *
 *   This module supplies the missing calendar knowledge as an INJECTED,
 *   EXPLICIT dataset, and fails closed when that dataset cannot answer.
 *
 * POLICY: UNKNOWN CALENDAR MEANS NO TRADE
 *   Every day must be classified by the injected calendar:
 *     - `REGULAR`          a normal 09:30-16:00 ET session
 *     - `EARLY_CLOSE`      session ends before 16:00 ET
 *     - `HOLIDAY`          no session at all
 *     - `EARLY_OPEN`       session starts after 09:30 ET
 *   A date the calendar does not mention is `UNKNOWN`, which is NOT tradable.
 *   There is no "assume regular" fallback.
 *
 * CALENDAR IS INJECTED, NEVER HARD-CODED HERE
 *   A trading-day calendar is regulatory data that changes. Hard-coding one
 *   would create a second, unaudited source of truth. The caller supplies a
 *   `TradingCalendar`; this module only interprets it.
 *
 * NOTE ON WEEKENDS
 *   Saturday and Sunday are classified `HOLIDAY` unconditionally. NYSE/Nasdaq
 *   do not trade them and there is no exception.
 */
import { ET_TIME_ZONE, TRADFI_OPEN_MINUTE, TRADFI_CLOSE_MINUTE, toEtWallClock } from "./market-regime.js";

export type SessionDayType = "REGULAR" | "HOLIDAY" | "EARLY_CLOSE" | "EARLY_OPEN";

export interface CalendarDay {
  /** ISO date in ET, `YYYY-MM-DD`. */
  date: string;
  type: SessionDayType;
  /** Minutes from ET midnight. Required for EARLY_CLOSE and EARLY_OPEN. */
  closeMinute?: number;
  openMinute?: number;
  /** Human-readable note carried into evidence. */
  note?: string;
}

export interface TradingCalendar {
  /** Identifier of the dataset in force, recorded in evidence. */
  id: string;
  /** Exchange this calendar describes. */
  exchange: "NYSE" | "NASDAQ";
  days: Record<string, CalendarDay>;
}

export type SessionVerdict =
  | { tradable: true; type: SessionDayType; openMinute: number; closeMinute: number; note: string; date: string }
  | { tradable: false; reason: string; code: string; type: SessionDayType; date: string; note: string };

/** ISO `YYYY-MM-DD` for the ET calendar date of an instant. */
export function etDateKey(instant: Date): string {
  const wc = toEtWallClock(instant);
  const y = wc.year;
  const m = String(wc.month).padStart(2, "0");
  const d = String(wc.day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** ISO weekday for the ET calendar date of an instant: 0=Sun .. 6=Sat. */
export function etWeekday(instant: Date): number {
  return toEtWallClock(instant).weekday;
}

function dayKeyFromParts(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Classify a TradFi session for one instant.
 *
 * Order matters. Weekends are rejected before the calendar is consulted,
 * because no exchange calendar trades Saturday or Sunday.
 *
 * A date absent from the calendar is `UNKNOWN` and NOT tradable. This is the
 * fail-closed default: an unrecognised market day is treated as suspect
 * (GAP-017) rather than optimistically assumed to be a normal session.
 */
export function resolveSession(args: {
  now: Date;
  calendar: TradingCalendar;
  /** Injected clock for tests; defaults to `now`. */
  minuteOfDay?: number;
}): SessionVerdict {
  const { now, calendar } = args;
  const wc = toEtWallClock(now);
  const date = dayKeyFromParts(wc.year, wc.month, wc.day);
  const minute = args.minuteOfDay ?? wc.hour * 60 + wc.minute;

  // --- Weekends: never tradable, regardless of what a calendar claims. ---
  if (wc.weekday === 0 || wc.weekday === 6) {
    return {
      tradable: false,
      code: "WEEKEND",
      reason: `${date} is a ${wc.weekday === 0 ? "Sunday" : "Saturday"}; US equity markets do not trade.`,
      type: "HOLIDAY",
      date,
      note: "Weekend. Weekend is never tradable and is not overridable by a calendar entry.",
    };
  }

  const entry = calendar.days[date];

  // --- Unknown calendar day: FAIL CLOSED. ---
  if (entry === undefined) {
    return {
      tradable: false,
      code: "UNKNOWN_CALENDAR_DAY",
      reason:
        `${date} is not present in calendar '${calendar.id}'. An unrecognised market day ` +
        `cannot be proven to be a trading session, so it is treated as NOT tradable (GAP-017).`,
      type: "HOLIDAY",
      date,
      note: "No calendar entry. Absence of data is not evidence of a session.",
    };
  }

  // --- Holiday: calendar knows the venue is shut. ---
  if (entry.type === "HOLIDAY") {
    return {
      tradable: false,
      code: "HOLIDAY",
      reason: `${date} is a market holiday per calendar '${calendar.id}'.${entry.note ? ` (${entry.note})` : ""}`,
      type: "HOLIDAY",
      date,
      note: entry.note ?? "Market holiday.",
    };
  }

  const openMinute = entry.type === "EARLY_OPEN" ? (entry.openMinute ?? TRADFI_OPEN_MINUTE) : TRADFI_OPEN_MINUTE;
  const closeMinute = entry.type === "EARLY_CLOSE" ? (entry.closeMinute ?? TRADFI_CLOSE_MINUTE) : TRADFI_CLOSE_MINUTE;

  // --- Structural sanity: a session that ends before it opens is not a session. ---
  if (closeMinute <= openMinute) {
    return {
      tradable: false,
      code: "INVALID_CALENDAR_ENTRY",
      reason: `${date} declares close ${closeMinute} <= open ${openMinute}; the entry is unusable.`,
      type: entry.type,
      date,
      note: "Malformed calendar entry; fail closed.",
    };
  }

  // --- Before the session opens. ---
  if (minute < openMinute) {
    return {
      tradable: false,
      code: "BEFORE_SESSION_OPEN",
      reason: `${date} ${fmtMinute(minute)} ET precedes the session open ${fmtMinute(openMinute)} ET.`,
      type: entry.type,
      date,
      note: entry.note ?? "Pre-open.",
    };
  }

  // --- At or after the session closes. Includes early closes. ---
  if (minute >= closeMinute) {
    return {
      tradable: false,
      code: entry.type === "EARLY_CLOSE" ? "AFTER_EARLY_CLOSE" : "AFTER_SESSION_CLOSE",
      reason:
        `${date} ${fmtMinute(minute)} ET is at or after the session close ${fmtMinute(closeMinute)} ET` +
        `${entry.type === "EARLY_CLOSE" ? " (EARLY_CLOSE day)" : ""}.`,
      type: entry.type,
      date,
      note: entry.note ?? "Post-close.",
    };
  }

  return {
    tradable: true,
    type: entry.type,
    openMinute,
    closeMinute,
    date,
    note: entry.note ?? `Regular ${fmtMinute(openMinute)}-${fmtMinute(closeMinute)} ET session.`,
  };
}

function fmtMinute(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** The calendar limitation this module is designed to remove. */
export const CALENDAR_LIMITATION =
  "Sessions are classified from an INJECTED calendar. An absent date is UNKNOWN and NOT tradable. " +
  "The calendar dataset itself is external regulatory data and must be reviewed when it changes.";