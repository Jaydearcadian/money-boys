/**
 * Market regime and benchmark resolver.
 *
 * Answers two questions the strategy needs before it may trade:
 *   1. Is TradFi open right now, and how long until it next opens?
 *   2. Which benchmark source is legitimate in this regime, and can its
 *      freshness actually be PROVEN?
 *
 * REGIME RULES
 *  - tradfi_open:   Mon-Fri 09:30-16:00 ET. Carry horizon is 0: there is no
 *                   reopen to carry through because the benchmark venue is
 *                   live and tradable right now.
 *  - tradfi_closed: outside that window. The carry horizon is the true hours
 *                   until the next 09:30 ET reopen, so funding carry is
 *                   charged over the real gap. Friday 16:00 -> Monday 09:30
 *                   resolves to ~65.5 hours.
 *
 * DST
 *  - All arithmetic is done on ET wall-clock via Intl, then converted back to
 *    an instant with an offset solve. That is DST-correct without a tz
 *    database: "next 09:30 ET" is always 09:30 on the wall clock, whether
 *    that is UTC-4 or UTC-5.
 *
 * HOLIDAYS: NOT SUPPORTED in this slice. An early close or market holiday is
 * treated as a normal weekday. This is a real limitation: on a holiday before
 * 16:00 ET this module would report tradfi_open when the venue is shut. See
 * GAP-017. Fail-closed callers must therefore treat an unrecognized market
 * day as suspect rather than authoritative.
 */

export const ET_TIME_ZONE = "America/New_York";

/** Regular-session bounds in ET wall-clock. */
export const TRADFI_OPEN_MINUTE = 9 * 60 + 30; // 09:30
export const TRADFI_CLOSE_MINUTE = 16 * 60; // 16:00

export type MarketRegime = "tradfi_open" | "tradfi_closed";

export interface EtWallClock {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  weekday: number; // 0=Sun .. 6=Sat
}

export interface RegimeSnapshot {
  regime: MarketRegime;
  /** ET wall-clock of the evaluation instant. */
  etNow: EtWallClock;
  etNowIso: string;
  /** True hours until the next 09:30 ET reopen. 0 when currently open. */
  hoursToNextReopen: number;
  /** ISO instant of the next 09:30 ET reopen; null when currently open. */
  nextReopenAtIso: string | null;
  /** Basis source that is legitimate in this regime. */
  requiredBenchmarkSource: "live_intraday" | "latest_close";
  /** Holiday calendars are not implemented. Always true today (GAP-017). */
  holidayCalendarSupported: false;
  limitation: string;
}

const ET_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: ET_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  weekday: "short",
});

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** Decompose an instant into ET wall-clock fields. */
export function toEtWallClock(instant: Date): EtWallClock {
  const parts = ET_FORMAT.formatToParts(instant);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "0";
  const hourRaw = Number(get("hour"));
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    // Intl renders midnight as 24 in some ICU versions; normalise to 0.
    hour: hourRaw === 24 ? 0 : hourRaw,
    minute: Number(get("minute")),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

/**
 * Convert an ET wall-clock to a UTC instant.
 *
 * Solves the UTC offset by formatting a candidate and comparing. Two passes
 * are enough for every real-world offset including DST boundaries.
 */
export function etWallClockToInstant(wc: EtWallClock): Date {
  const asUtc = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, 0, 0);
  let guess = new Date(asUtc);
  for (let i = 0; i < 3; i += 1) {
    const back = toEtWallClock(guess);
    const backAsUtc = Date.UTC(back.year, back.month - 1, back.day, back.hour, back.minute, 0, 0);
    const drift = asUtc - backAsUtc;
    if (drift === 0) break;
    guess = new Date(guess.getTime() + drift);
  }
  return guess;
}

/** Minutes since ET midnight. */
function minutesOfDay(wc: EtWallClock): number {
  return wc.hour * 60 + wc.minute;
}

/** True when the ET wall-clock falls inside a regular weekday session. */
export function isTradfiOpen(wc: EtWallClock): boolean {
  const isWeekday = wc.weekday >= 1 && wc.weekday <= 5;
  if (!isWeekday) return false;
  const m = minutesOfDay(wc);
  return m >= TRADFI_OPEN_MINUTE && m < TRADFI_CLOSE_MINUTE;
}

/** Next 09:30 ET reopen strictly after the given instant. */
export function nextReopenInstant(now: Date): Date {
  const wc = toEtWallClock(now);
  // Today, if the session has not started yet and it is a weekday.
  if (wc.weekday >= 1 && wc.weekday <= 5) {
    const todayOpen = etWallClockToInstant({ ...wc, hour: 9, minute: 30, second: 0 } as EtWallClock);
    if (todayOpen.getTime() > now.getTime()) return todayOpen;
  }
  // Otherwise walk forward day by day in ET wall-clock space. At most 7 steps.
  for (let add = 1; add <= 7; add += 1) {
    const probe = new Date(Date.UTC(wc.year, wc.month - 1, wc.day + add, 12, 0, 0));
    const probeEt = toEtWallClock(probe);
    if (probeEt.weekday >= 1 && probeEt.weekday <= 5) {
      return etWallClockToInstant({ ...probeEt, hour: 9, minute: 30 } as EtWallClock);
    }
  }
  throw new Error("could not resolve a next TradFi reopen within 7 days");
}

/**
 * Full regime snapshot for an instant.
 *
 * Deterministic: the same instant always yields the same answer.
 */
export function resolveRegime(now: Date = new Date()): RegimeSnapshot {
  const etNow = toEtWallClock(now);
  const open = isTradfiOpen(etNow);
  if (open) {
    return {
      regime: "tradfi_open",
      etNow,
      etNowIso: now.toISOString(),
      hoursToNextReopen: 0,
      nextReopenAtIso: null,
      requiredBenchmarkSource: "live_intraday",
      holidayCalendarSupported: false,
      limitation: HOLIDAY_LIMITATION,
    };
  }
  const reopen = nextReopenInstant(now);
  const hours = (reopen.getTime() - now.getTime()) / 3_600_000;
  return {
    regime: "tradfi_closed",
    etNow,
    etNowIso: now.toISOString(),
    hoursToNextReopen: Number(hours.toFixed(4)),
    nextReopenAtIso: reopen.toISOString(),
    requiredBenchmarkSource: "latest_close",
    holidayCalendarSupported: false,
    limitation: HOLIDAY_LIMITATION,
  };
}

export const HOLIDAY_LIMITATION =
  "Holidays and early closes are NOT modelled. A market holiday or early close " +
  "before 16:00 ET will be reported as tradfi_open when the venue is actually shut. " +
  "Treat an unrecognized market day as suspect (GAP-017).";

// ---------------------------------------------------------------------------
// Benchmark freshness
// ---------------------------------------------------------------------------

export type FreshnessStatus = "verified_fresh" | "verified_stale" | "unverifiable";

export interface BenchmarkEvidence {
  price: number;
  /** Which surface produced it. */
  source: "BITGET_MCP_QUOTE" | "BITGET_MCP_HISTORICAL" | "EXPLICIT_TS_SOURCE" | "LOCAL_SNAPSHOT";
  provider: string | null;
  /**
   * Timestamp carried by the UPSTREAM SOURCE itself. Null when the source
   * publishes none, which makes freshness UNPROVABLE rather than assumed.
   */
  sourceAsOf: string | null;
  /** When this process performed the fetch. Always known. */
  fetchedAt: string;
  freshness: FreshnessStatus;
  ageMs: number | null;
  notes: string;
}

export class BenchmarkFreshnessUnprovableError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(`FAIL_CLOSED: benchmark freshness cannot be established — ${detail}`);
    this.name = "BenchmarkFreshnessUnprovableError";
    this.detail = detail;
  }
}

/**
 * Classify benchmark freshness.
 *
 * `sourceAsOf === null` yields "unverifiable" even when the price was fetched
 * a millisecond ago. A fetch time says when WE looked, not how old the DATA
 * is, and conflating the two is how a stale benchmark sneaks into a live
 * decision.
 */
export function assessBenchmarkFreshness(args: {
  price: number;
  source: BenchmarkEvidence["source"];
  provider?: string | null;
  sourceAsOf: string | null;
  fetchedAt: string;
  maxAgeMs: number;
}): BenchmarkEvidence {
  const { price, source, provider = null, sourceAsOf, fetchedAt, maxAgeMs } = args;
  const fetched = Date.parse(fetchedAt);

  if (source === "LOCAL_SNAPSHOT") {
    return {
      price,
      source,
      provider,
      sourceAsOf,
      fetchedAt,
      freshness: "unverifiable",
      ageMs: null,
      notes: "LOCAL_SNAPSHOT is an offline fixture and is never a live benchmark",
    };
  }

  if (sourceAsOf === null) {
    return {
      price,
      source,
      provider,
      sourceAsOf: null,
      fetchedAt,
      freshness: "unverifiable",
      ageMs: null,
      notes:
        "upstream source publishes no timestamp; freshness is UNPROVABLE. A fetch time " +
        "records when we looked, not how old the data is. Execution must fail closed.",
    };
  }

  const sourceMs = Date.parse(sourceAsOf);
  if (Number.isNaN(sourceMs)) {
    return {
      price,
      source,
      provider,
      sourceAsOf,
      fetchedAt,
      freshness: "unverifiable",
      ageMs: null,
      notes: `upstream sourceAsOf '${sourceAsOf}' is not a parseable timestamp`,
    };
  }
  if (sourceMs > fetched + 60_000) {
    return {
      price,
      source,
      provider,
      sourceAsOf,
      fetchedAt,
      freshness: "unverifiable",
      ageMs: null,
      notes: "upstream sourceAsOf is in the future relative to fetch time",
    };
  }

  const ageMs = fetched - sourceMs;
  return {
    price,
    source,
    provider,
    sourceAsOf,
    fetchedAt,
    freshness: ageMs > maxAgeMs ? "verified_stale" : "verified_fresh",
    ageMs,
    notes:
      ageMs > maxAgeMs
        ? `source data is ${Math.round(ageMs / 60000)}min old, exceeding the max`
        : "source timestamp present and within the max age",
  };
}

/**
 * Gate a benchmark for a trading decision.
 *
 * Throws unless freshness is VERIFIED fresh. "verified_stale" and
 * "unverifiable" both fail closed, and a caller can never silently proceed on
 * an unprovable benchmark.
 */
export function assertBenchmarkProvable(
  evidence: BenchmarkEvidence,
  regime: MarketRegime,
): BenchmarkEvidence {
  if (regime === "tradfi_closed") {
    // A closure window legitimately carries a benchmark older than an
    // intraday max age, so the ceiling is widened, but it is still bounded.
    const closureCeilingMs = 7 * 24 * 3_600_000;
    if (evidence.freshness === "unverifiable") {
      throw new BenchmarkFreshnessUnprovableError(
        `regime=${regime}, freshness=unverifiable (${evidence.notes})`,
      );
    }
    if (evidence.ageMs !== null && evidence.ageMs > closureCeilingMs) {
      throw new BenchmarkFreshnessUnprovableError(
        `regime=${regime}, age=${evidence.ageMs}ms exceeds the closure ceiling`,
      );
    }
    return evidence;
  }

  if (evidence.freshness !== "verified_fresh") {
    throw new BenchmarkFreshnessUnprovableError(
      `regime=${regime}, freshness=${evidence.freshness} (${evidence.notes})`,
    );
  }
  return evidence;
}

/**
 * Select the benchmark source a regime requires.
 *
 * During closure the latest reliable close is legitimate. During open hours
 * only a live intraday reference qualifies.
 */
export function requiredBenchmarkSourceFor(regime: MarketRegime): BenchmarkEvidence["source"] {
  return regime === "tradfi_open" ? "EXPLICIT_TS_SOURCE" : "BITGET_MCP_QUOTE";
}
