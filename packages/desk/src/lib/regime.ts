/**
 * US equity regular-session regime, computed from a clock instead of being
 * hard-coded.
 *
 * The earlier landing page printed "TRADFI CLOSED: WEEKEND ARMED" at all
 * times, which is false from Monday 09:30 ET to Friday 16:00 ET. This pure
 * function derives the label from the instant it is given.
 *
 * LIMITATION (mirrors GAP-017): exchange holidays and early closes are NOT
 * modelled. On a market holiday this reports "open" during 09:30-16:00 ET.
 * `holidayCalendarModelled` is always `false` so a caller can disclose it.
 */

export interface EquityRegime {
  open: boolean;
  /** Short label, safe to render next to an icon. */
  label: string;
  /** Next regular-session open, e.g. "Mon 09:30 ET". `null` while open. */
  nextOpen: string | null;
  holidayCalendarModelled: false;
}

const OPEN_MIN = 9 * 60 + 30;
const CLOSE_MIN = 16 * 60;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

interface EtParts {
  dow: number;
  minutes: number;
}

function easternParts(now: Date): EtParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dow = DAYS.indexOf(get("weekday") as (typeof DAYS)[number]);
  // Some runtimes render midnight as "24" even with h23; normalise.
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  return { dow, minutes: hour * 60 + minute };
}

function isWeekday(dow: number): boolean {
  return dow >= 1 && dow <= 5;
}

export function usEquityRegime(now: Date = new Date()): EquityRegime {
  const { dow, minutes } = easternParts(now);

  if (isWeekday(dow) && minutes >= OPEN_MIN && minutes < CLOSE_MIN) {
    return {
      open: true,
      label: "US equities open",
      nextOpen: null,
      holidayCalendarModelled: false,
    };
  }

  // Closed: find the next weekday open. Before today's open on a weekday the
  // next open is today; otherwise walk forward to the next weekday.
  let daysAhead = 0;
  if (!(isWeekday(dow) && minutes < OPEN_MIN)) {
    daysAhead = 1;
    while (!isWeekday((dow + daysAhead) % 7)) daysAhead += 1;
  }
  const nextDow = (dow + daysAhead) % 7;
  return {
    open: false,
    label: "US equities closed",
    nextOpen: `${DAYS[nextDow]} 09:30 ET`,
    holidayCalendarModelled: false,
  };
}
