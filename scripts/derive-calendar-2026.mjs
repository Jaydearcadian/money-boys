/**
 * DERIVATION of the operator-reviewed 2026 Nasdaq session calendar.
 *
 * Reproduces foundry/evidence/p11/calendar/nasdaq-2026.operator-reviewed.json
 * from the transcribed input below. Run manually when the source calendar is
 * amended; it is NOT part of `pnpm verify` and fetches nothing.
 *
 * INPUT: the 12 dated rows of the official "U.S. Equity and Options Markets
 * Holiday Schedule 2026" table, transcribed verbatim by human review from
 * https://www.nasdaqtrader.com/trader.aspx?id=Calendar. Those rows are the
 * ONLY holiday data. Every other weekday is a regular 09:30-16:00 ET session,
 * derived arithmetically. No holiday is guessed and nothing is scraped.
 *
 * NOT automated provider data. Not licensed for automated ingestion. The
 * resulting dataset is bounded to 2026 and is refused beyond that horizon.
 */
import { createHash } from "node:crypto";

// ---- Verbatim transcription of the published 2026 table -------------------
const PUBLISHED_2026 = [
  { date: "2026-01-01", status: "CLOSED",      note: "New Years Day (Observed)" },
  { date: "2026-01-19", status: "CLOSED",      note: "Martin Luther King, Jr. Day" },
  { date: "2026-02-16", status: "CLOSED",      note: "President's Day - U.S." },
  { date: "2026-04-03", status: "CLOSED",      note: "Good Friday" },
  { date: "2026-05-25", status: "CLOSED",      note: "Memorial Day - U.S." },
  { date: "2026-06-19", status: "CLOSED",      note: "Juneteenth Holiday (Observed)" },
  { date: "2026-07-03", status: "CLOSED",      note: "Independence Day - U.S. (Observed)" },
  { date: "2026-09-07", status: "CLOSED",      note: "Labor Day - U.S." },
  { date: "2026-11-26", status: "CLOSED",      note: "Thanksgiving Day - U.S." },
  { date: "2026-11-27", status: "EARLY_CLOSE", closeMinute: 13 * 60, note: "Early Close* - U.S. 1:00 p.m." },
  { date: "2026-12-24", status: "EARLY_CLOSE", closeMinute: 13 * 60, note: "Early Close* - U.S. 1:00 p.m." },
  { date: "2026-12-25", status: "CLOSED",      note: "Christmas Holiday - U.S." },
];

const OPEN_MINUTE = 9 * 60 + 30;  // 09:30 ET
const CLOSE_MINUTE = 16 * 60;     // 16:00 ET
const OVERRIDES = new Map(PUBLISHED_2026.map((r) => [r.date, r]));

// Every weekday in 2026 becomes a session unless the published table overrides.
const entries = [];
const d = new Date(Date.UTC(2026, 0, 1));
const end = new Date(Date.UTC(2026, 11, 31));
while (d <= end) {
  const iso = d.toISOString().slice(0, 10);
  const dow = d.getUTCDay();
  if (dow !== 0 && dow !== 6) {
    const o = OVERRIDES.get(iso);
    entries.push(
      o
        ? { date: iso, status: o.status,
            ...(o.status !== "CLOSED" ? { openMinute: OPEN_MINUTE } : {}),
            ...(o.closeMinute ? { closeMinute: o.closeMinute } : {}),
            earlyClose: o.status === "EARLY_CLOSE", timezone: "America/New_York", note: o.note }
        : { date: iso, status: "OPEN", openMinute: OPEN_MINUTE, closeMinute: CLOSE_MINUTE,
            earlyClose: false, timezone: "America/New_York", note: "Regular session" }
    );
  }
  d.setUTCDate(d.getUTCDate() + 1);
}

const canonical = (v) => {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(canonical);
  const o = {};
  for (const k of Object.keys(v).sort()) if (v[k] !== undefined) o[k] = canonical(v[k]);
  return o;
};
const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : 1));
const contentHash = createHash("sha256").update(JSON.stringify(canonical(sorted)), "utf8").digest("hex");

const dataset = {
  schemaVersion: 1,
  datasetId: "nasdaq-2026.operator-reviewed.r1",
  exchange: "NASDAQ",
  coverageStart: "2026-01-01",
  coverageEnd: "2026-12-31",
  provenance: {
    sourceUrl: "https://www.nasdaqtrader.com/trader.aspx?id=Calendar",
    sourcePublisher: "NASDAQ",
    sourceDocument: "U.S. Equity and Options Markets Holiday Schedule 2026 (nasdaqtrader.com/trader.aspx?id=Calendar)",
    sourceEffectiveDate: "2026-01-01",
    // Nasdaq publishes NO version identifier for this calendar. Explicitly null
    // rather than fabricated, because a fabricated version would be
    // indistinguishable from a real one at review time.
    sourceVersion: null,
    sourceLastModified: null,
    derivedBy: "operator-reviewed manual derivation",
    derivedAt: "2026-10-01T00:00:00.000Z",
  },
  review: {
    label: "OPERATOR_REVIEWED_CALENDAR",
    automatedProviderData: false,
    reviewer: "operator-reviewed",
    reviewTimestamp: "2026-10-01T00:00:00.000Z",
    derivationMethod:
      "The 12 dated rows of the published 2026 table were transcribed verbatim as the derivation input. " +
      "Every other weekday is a regular 09:30-16:00 ET session, derived arithmetically from that closure " +
      "list. No holiday was guessed and no endpoint was fetched or scraped.",
    publishedRows: PUBLISHED_2026,
  },
  sameDayChecklistRequired: true,
  disclaimer:
    "OPERATOR_REVIEWED_CALENDAR. Derived by manual transcription and human review of the official Nasdaq " +
    "published holiday schedule. NOT automated provider data and NOT licensed for automated ingestion. " +
    "Unattended/production use is BLOCKED until an authorised machine-readable calendar source exists. " +
    "Bounded forward coverage only (2026); dates beyond the published horizon resolve to UNKNOWN.",
  contentHash,
  entries: sorted,
};

const fs = await import("node:fs");
fs.writeFileSync(
  "/home/ubuntu/money-boys/foundry/evidence/p11/calendar/nasdaq-2026.operator-reviewed.json",
  JSON.stringify(dataset, null, 2) + "\n"
);
const counts = sorted.reduce((a, e) => ((a[e.status] = (a[e.status] ?? 0) + 1), a), {});
console.log("entries:", sorted.length, "| counts:", JSON.stringify(counts));
console.log("coverage:", dataset.coverageStart, "..", dataset.coverageEnd);
console.log("contentHash:", contentHash);
console.log("weekday count 2026 (262):", sorted.length, "| closures:", (counts.CLOSED ?? 0));
