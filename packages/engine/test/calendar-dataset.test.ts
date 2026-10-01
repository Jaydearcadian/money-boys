import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeDatasetHash,
  stampDataset,
  validateCalendarDataset,
  verifyDatasetHash,
  type CalendarDatasetV1,
  type CalendarEntry,
  type CalendarProvenance,
} from "../src/agents/calendar-dataset.js";

/**
 * Calendar dataset SCHEMA and VALIDATOR tests.
 *
 * SCOPE LIMIT, stated plainly: this file proves the schema is well-formed and
 * that the validator refuses bad data. It does NOT prove any real holiday is
 * correct. Every dataset here is explicitly SYNTHETIC and its provenance says
 * so, because a fixture that looked authoritative would be the exact failure
 * this project exists to prevent.
 *
 * No production wiring is tested here, because none exists yet.
 */

const SYNTHETIC_PROVENANCE: CalendarProvenance = {
  sourceUrl: "https://example.invalid/SYNTHETIC-fixture-not-a-real-calendar",
  sourcePublisher: "NYSE",
  sourceDocument: "SYNTHETIC FIXTURE — NOT A REAL PUBLISHED CALENDAR",
  sourceEffectiveDate: "SYNTHETIC",
  sourceVersion: null,
  sourceLastModified: null,
  derivedBy: "test fixture",
  derivedAt: "2026-01-01T00:00:00.000Z",
};

const ENTRIES: CalendarEntry[] = [
  { date: "2026-10-05", status: "OPEN", openMinute: 570, closeMinute: 960, earlyClose: false, timezone: "America/New_York", note: "synthetic regular" },
  { date: "2026-10-06", status: "EARLY_CLOSE", openMinute: 570, closeMinute: 780, earlyClose: true, timezone: "America/New_York", note: "synthetic early close" },
  { date: "2026-10-07", status: "CLOSED", earlyClose: false, timezone: "America/New_York", note: "synthetic holiday" },
  { date: "2026-10-08", status: "OPEN", openMinute: 570, closeMinute: 960, earlyClose: false, timezone: "America/New_York" },
];

function dataset(over: Partial<CalendarDatasetV1> = {}): CalendarDatasetV1 {
  const base = stampDataset({
    datasetId: "synthetic-fixture.r1",
    exchange: "NYSE",
    coverageStart: "2026-10-05",
    coverageEnd: "2026-10-08",
    provenance: SYNTHETIC_PROVENANCE,
    entries: ENTRIES,
  });
  return { ...base, ...over } as CalendarDatasetV1;
}

describe("calendar dataset — a well-formed dataset validates", () => {
  it("accepts the synthetic fixture", () => {
    const r = validateCalendarDataset(dataset());
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.ok && r.entryCount, 4);
  });

  it("computes a stable hash over content, independent of array order", () => {
    const reversed = stampDataset({
      datasetId: "synthetic-fixture.r1",
      exchange: "NYSE",
      coverageStart: "2026-10-05",
      coverageEnd: "2026-10-08",
      provenance: SYNTHETIC_PROVENANCE,
      entries: [...ENTRIES].reverse(),
    });
    assert.equal(reversed.contentHash, dataset().contentHash, "hash must be order-independent");
    assert.equal(verifyDatasetHash(reversed), true);
  });

  it("changes the hash when any entry changes", () => {
    const mutated = stampDataset({
      datasetId: "synthetic-fixture.r1",
      exchange: "NYSE",
      coverageStart: "2026-10-05",
      coverageEnd: "2026-10-08",
      provenance: SYNTHETIC_PROVENANCE,
      entries: ENTRIES.map((e) => (e.date === "2026-10-06" ? { ...e, closeMinute: 900 } : e)),
    });
    assert.notEqual(mutated.contentHash, dataset().contentHash);
  });
});

describe("calendar dataset — validator refuses bad data", () => {
  function codes(ds: unknown): string[] {
    const r = validateCalendarDataset(ds);
    assert.equal(r.ok, false, "expected the dataset to be rejected");
    return r.issues.map((i) => i.code);
  }

  it("refuses a dataset with no provenance at all", () => {
    const { provenance, ...noProvenance } = dataset() as unknown as Record<string, unknown>;
    void provenance;
    assert.ok(codes(noProvenance).includes("PROVENANCE_MISSING"));
  });

  it("refuses provenance missing individual required fields", () => {
    const d = dataset();
    const broken: CalendarDatasetV1 = { ...d, provenance: { ...d.provenance, sourceUrl: "" } };
    assert.ok(codes(broken).includes("PROVENANCE_FIELD"));
  });

  it("refuses a tampered content hash", () => {
    const d = dataset();
    assert.ok(codes({ ...d, contentHash: "0".repeat(64) }).includes("CONTENT_HASH_MISMATCH"));
  });

  it("refuses an entry edited after hashing", () => {
    const d = dataset();
    const mutated = {
      ...d,
      entries: d.entries.map((e) => (e.date === "2026-10-07" ? { ...e, status: "OPEN" as const, openMinute: 570, closeMinute: 960 } : e)),
    };
    assert.ok(codes(mutated).includes("CONTENT_HASH_MISMATCH"), "hash must catch post-hash edits");
  });

  it("refuses a missing or malformed content hash", () => {
    const d = dataset();
    const { contentHash, ...noHash } = d as unknown as Record<string, unknown>;
    void contentHash;
    assert.ok(codes(noHash).includes("CONTENT_HASH_MISSING"));
  });

  it("refuses an earlyClose flag that disagrees with the status", () => {
    const d = stampDataset({
      datasetId: "x", exchange: "NYSE", coverageStart: "2026-10-05", coverageEnd: "2026-10-05",
      provenance: SYNTHETIC_PROVENANCE,
      entries: [{ date: "2026-10-05", status: "OPEN", openMinute: 570, closeMinute: 960, earlyClose: true, timezone: "America/New_York" }],
    });
    assert.ok(codes(d).includes("ENTRY_EARLY_CLOSE_FLAG"));
  });

  it("refuses an EARLY_CLOSE that is not actually early", () => {
    const d = stampDataset({
      datasetId: "x", exchange: "NYSE", coverageStart: "2026-10-05", coverageEnd: "2026-10-05",
      provenance: SYNTHETIC_PROVENANCE,
      entries: [{ date: "2026-10-05", status: "EARLY_CLOSE", openMinute: 570, closeMinute: 960, earlyClose: true, timezone: "America/New_York" }],
    });
    assert.ok(codes(d).includes("ENTRY_EARLY_NOT_EARLY"));
  });

  it("refuses a CLOSED entry that carries session times", () => {
    const d = stampDataset({
      datasetId: "x", exchange: "NYSE", coverageStart: "2026-10-05", coverageEnd: "2026-10-05",
      provenance: SYNTHETIC_PROVENANCE,
      entries: [{ date: "2026-10-05", status: "CLOSED", openMinute: 570, closeMinute: 960, earlyClose: false, timezone: "America/New_York" }],
    });
    assert.ok(codes(d).includes("ENTRY_CLOSED_HAS_TIMES"));
  });

  it("refuses an OPEN or EARLY_CLOSE entry with no session times", () => {
    const d = stampDataset({
      datasetId: "x", exchange: "NYSE", coverageStart: "2026-10-05", coverageEnd: "2026-10-05",
      provenance: SYNTHETIC_PROVENANCE,
      entries: [{ date: "2026-10-05", status: "OPEN", earlyClose: false, timezone: "America/New_York" }],
    });
    const found = codes(d);
    assert.ok(found.includes("ENTRY_OPEN_MINUTE"));
    assert.ok(found.includes("ENTRY_CLOSE_MINUTE"));
  });

  it("refuses a session whose close precedes its open", () => {
    const d = stampDataset({
      datasetId: "x", exchange: "NYSE", coverageStart: "2026-10-05", coverageEnd: "2026-10-05",
      provenance: SYNTHETIC_PROVENANCE,
      entries: [{ date: "2026-10-05", status: "OPEN", openMinute: 900, closeMinute: 570, earlyClose: false, timezone: "America/New_York" }],
    });
    assert.ok(codes(d).includes("ENTRY_TIME_ORDER"));
  });

  it("refuses duplicate dates", () => {
    const d = stampDataset({
      datasetId: "x", exchange: "NYSE", coverageStart: "2026-10-05", coverageEnd: "2026-10-05",
      provenance: SYNTHETIC_PROVENANCE,
      entries: [
        { date: "2026-10-05", status: "OPEN", openMinute: 570, closeMinute: 960, earlyClose: false, timezone: "America/New_York" },
        { date: "2026-10-05", status: "CLOSED", earlyClose: false, timezone: "America/New_York" },
      ],
    });
    assert.ok(codes(d).includes("ENTRY_DUPLICATE"));
  });

  it("refuses a non-America/New_York timezone", () => {
    const d = stampDataset({
      datasetId: "x", exchange: "NYSE", coverageStart: "2026-10-05", coverageEnd: "2026-10-05",
      provenance: SYNTHETIC_PROVENANCE,
      entries: [{ date: "2026-10-05", status: "OPEN", openMinute: 570, closeMinute: 960, earlyClose: false, timezone: "UTC" as never }],
    });
    assert.ok(codes(d).includes("ENTRY_TIMEZONE"));
  });

  it("refuses an empty entry list", () => {
    const d = stampDataset({
      datasetId: "x", exchange: "NYSE", coverageStart: "2026-10-05", coverageEnd: "2026-10-05",
      provenance: SYNTHETIC_PROVENANCE, entries: [],
    });
    assert.ok(codes(d).includes("ENTRIES_EMPTY"));
  });

  it("refuses entries outside the declared coverage window", () => {
    const d = dataset({ coverageStart: "2026-10-06" });
    assert.ok(codes(d).includes("COVERAGE_BEFORE_START"));
  });

  it("refuses a coverage window that is not fully populated", () => {
    const d = dataset({ coverageEnd: "2026-10-09" });
    assert.ok(codes(d).includes("COVERAGE_END_GAP"));
  });

  it("refuses an unsupported schema version", () => {
    assert.ok(codes({ ...dataset(), schemaVersion: 2 as never }).includes("SCHEMA_VERSION"));
  });

  it("refuses an unrecognised exchange", () => {
    assert.ok(codes({ ...dataset(), exchange: "LSE" as never }).includes("EXCHANGE"));
  });

  it("refuses a malformed date", () => {
    const d = stampDataset({
      datasetId: "x", exchange: "NYSE", coverageStart: "10/05/2026", coverageEnd: "10/05/2026",
      provenance: SYNTHETIC_PROVENANCE,
      entries: [{ date: "10/05/2026", status: "OPEN", openMinute: 570, closeMinute: 960, earlyClose: false, timezone: "America/New_York" }],
    });
    const found = codes(d);
    assert.ok(found.includes("ENTRY_DATE"));
    assert.ok(found.includes("COVERAGE_START"));
  });

  it("refuses a non-object candidate", () => {
    assert.ok(codes(null).includes("NOT_AN_OBJECT"));
    assert.ok(codes("nope").includes("NOT_AN_OBJECT"));
  });
});

describe("calendar dataset — scope limit is explicit", () => {
  it("labels its own provenance as synthetic", () => {
    // Guard against a future edit making a fixture look authoritative.
    const d = dataset();
    assert.match(d.provenance.sourceDocument, /SYNTHETIC/i);
    assert.match(d.provenance.sourceUrl, /SYNTHETIC/i);
    assert.ok(!d.provenance.sourceUrl.includes("nyse.com"));
    assert.ok(!d.provenance.sourceUrl.includes("nasdaq.com"));
  });

  it("proves no production calendar is installed", async () => {
    // There must be no module exporting a ready-made authoritative calendar.
    const mod = await import("../src/agents/calendar-dataset.js") as Record<string, unknown>;
    const exported = Object.keys(mod).sort();
    assert.deepEqual(
      exported.filter((k) => /CALENDAR|DEFAULT|REAL|AUTHOR/i.test(k) && !k.startsWith("validate") && !k.startsWith("compute") && !k.startsWith("stamp")),
      [],
      "no authoritative/default calendar may be exported",
    );
  });
});