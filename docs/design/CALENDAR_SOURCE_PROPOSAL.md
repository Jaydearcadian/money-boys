# Calendar Source Discovery and Dataset Proposal

**Status:** PROPOSAL. No calendar is installed. No production wiring.
**Baseline:** `9567c87`
**Scope:** discovery, verification from primary documentation, typed dataset schema.
**Not done:** live read, polling, order, GAP-017/019 edits, claim promotion.

---

## 1. Headline finding

**No authoritative US equity calendar is available for automated ingestion.** The sources split cleanly, and the split is uncomfortable:

| | Authoritative? | Machine-readable? | Licensed for automation? |
|---|---|---|---|
| NYSE / Nasdaq published calendars | **Yes** | **No** (PDF/HTML only) | **No** |
| JSON endpoints (`api.nasdaq.com`, `nyse.com/api/*`) | No | Yes | **No** — explicitly prohibited |

Feeding `api.nasdaq.com` into a resolver would be an unpermitted automated capture under the Nasdaq Legal Agreement, and arguably a breach of ICE's terms as well. The JSON is *reachable*, which is not the same as *permitted*.

**Recommended architecture: one-time, human-supervised derivation into a version-controlled dataset.** Exchange pages become **citation for human review**, not a runtime dependency.

---

## 2. Sources examined

### 2.1 NYSE — official exchange

| Item | Finding |
|---|---|
| Primary | `https://www.nyse.com/trade/hours-calendars` |
| Calendar PDF | `https://www.nyse.com/publicdocs/nyse/ICE_NYSE_2026_Yearly_Trading_Calendar.pdf` |
| Hours | 09:30–16:00 **ET**, stated as "All times are Eastern Time" |
| Timezone | ET local wall-clock → **DST-affected** |
| Holidays | Dated table covering **2026, 2027, 2028** |
| Early closes | **Footnotes only** — not independently enumerable ⚠️ |
| Publication | Annual, ~2.5 years forward; last announced 2025-12-23 |
| Versioning | **None published.** PDF self-declares "correct as of Dec. 10 2025 … subject to change" |
| Licensing | **Prohibited** — "personal, non-commercial use"; "does not include use of any data mining, robots or similar data gathering or extraction methods" |

**Why NYSE is a poor derivation source:** early closes exist only as footnote markers attached to holiday rows. Parsing them is fragile in exactly the way that produces a silently-wrong early close — the failure mode most likely to produce an unfalsifiable bad trade.

### 2.2 Nasdaq — official exchange, structurally cleaner

| Item | Finding |
|---|---|
| Primary | `https://www.nasdaqtrader.com/trader.aspx?id=Calendar` |
| Calendar PDF | `https://www.nasdaqtrader.com/content/technicalsupport/2026tradingcalendar.pdf` |
| Hours | "Opens: 9:30 am Eastern Time Zone; Closes: 4:00 pm Eastern Time Zone" |
| Holidays | Dated table, per-date grid |
| Early closes | ✅ **First-class rows** with an explicit status value |
| Publication | Annual PDF; per-day overrides via **Trader Alerts** (not machine-readable) ⚠️ |
| Versioning | **None published.** `Last-Modified` drifts from `CreationDate` ⚠️ |
| Licensing | **Prohibited** — Legal Agreement §2 bars automated capture; §7 bars use for "data analysis software" and AI/ML development |

Example of the structure that makes this the better source:

```
Thanksgiving Day  | November 26, 2026 | Closed
Early Close       | November 27, 2026 | 1:00 p.m.
```

**Nasdaq is the better derivation source**: early closes are distinguishable rows, not footnotes.

### 2.3 Machine-readable endpoints — all rejected

| Endpoint | Status | Why rejected |
|---|---|---|
| `api.nasdaq.com/api/market-info` | 200 JSON | Undocumented (`/api/docs` empty). `robots.txt` = `Disallow: /`. `no-store` cache headers. Today-only — **cannot resolve a future date**, which is exactly what fail-closed needs. |
| `www.nyse.com/api/trade-halts/current` | 200 JSON | Undocumented. Returns LULD/news **halts**, not a session calendar. |
| `api.nasdaq.com/api/quote/NVDA/historical` | 200 JSON | Undocumented, disallowed, string-typed numerics, `MM/DD/YYYY` dates. |
| `nasdaqtrader.com/Trader.aspx?id=MarketSystemStatus` | HTML | Reports **infrastructure health, not session state** — reads "operating normally" on a holiday. |

One inference worth explicitly rejecting: *holidays = dates absent from historical OHLCV*. It cannot distinguish early close from full close, cannot resolve future dates, breaks on halts, and violates the ToU.

---

## 3. Verification against the ten required items

| # | Item | Result |
|---|---|---|
| 1 | Regular trading days | ❌ **No dated positive list.** `Trading_Days.pdf` is aggregate counts only |
| 2 | Holidays | ✅ Dated, through 2028, both operators |
| 3 | Early closes | ✅ Published. Nasdaq structurally clean; NYSE footnote-only |
| 4 | Session open/close | ✅ 09:30–16:00 ET; early closes 13:00 ET per-date |
| 5 | Timezone / DST | ✅ ET wall-clock. **Never store UTC** — DST applies per date |
| 6 | Publication process | ✅ Annual; Nasdaq adds per-day Trader Alerts (not machine-readable) |
| 7 | Source timestamp / version | ⚠️ **No version id from either operator.** Only HTTP `Last-Modified`/`ETag`, which research showed can drift from document creation |
| 8 | Licensing | ❌ **Prohibited for automated use by both** |
| 9 | Staleness behaviour | ❌ No status endpoint, no pinning, no fallback. Must be self-implemented |
| 10 | Availability failure | Not documented by either operator. Design must be fail-closed by default |

**Could not verify:**
- Whether either operator would grant written permission for automated consumption (both ToUs contain an escape hatch)
- Whether Nasdaq Data Link carries a holiday/trading-calendar dataset (not exhaustively searched)
- `Trading_Days.pdf` 2028 = **257** trading days — irreconcilable with a 10-closure calendar. **Treat as suspect**
- Whether NYSE early closes ever deviate from 13:00 ET beyond 2028
- Existence of *any* NYSE machine-readable session-status endpoint (all `/api/` calendar guesses 404'd; absence is inferred, not proven)

---

## 4. Typed dataset proposal

Implemented as a schema and validator in `packages/engine/src/agents/calendar-dataset.ts`. **No data, no default, nothing wired.**

```ts
interface CalendarEntry {
  date: string;                 // YYYY-MM-DD, ET
  status: "OPEN" | "EARLY_CLOSE" | "CLOSED";
  openMinute?: number;          // 0-1439, ET wall-clock
  closeMinute?: number;
  earlyClose: boolean;          // must agree with status
  timezone: "America/New_York";
  note?: string;
}

interface CalendarProvenance {  // REQUIRED, never optional
  sourceUrl: string;
  sourcePublisher: "NYSE" | "NASDAQ";
  sourceDocument: string;
  sourceEffectiveDate: string;
  sourceVersion: string | null; // null is valid: neither publishes one
  sourceLastModified: string | null;
  derivedBy: string;
  derivedAt: string;
}

interface CalendarDatasetV1 {
  schemaVersion: 1;
  datasetId: string;
  exchange: "NYSE" | "NASDAQ";
  coverageStart: string;
  coverageEnd: string;
  provenance: CalendarProvenance;
  contentHash: string;          // SHA-256 over canonical entries
  entries: readonly CalendarEntry[];
}
```

**Design decisions:**

- **Times are ET minutes from midnight, never UTC instants.** 9:30 means 9:30 in whichever DST state applies. Storing UTC would silently encode a DST assumption.
- **`contentHash` excludes itself** and sorts entries by date, so it identifies *content* rather than serialisation. `computeDatasetHash` is order-independent; `verifyDatasetHash` detects post-hash edits.
- **Provenance is mandatory.** A calendar without it is indistinguishable from a guess — which is precisely what must not ship.
- **`sourceVersion: null` is explicitly legal.** Requiring a value neither operator publishes would force a fabricated one.

### Validator refusals (24 tests)

Refuses: missing provenance · missing provenance fields · hash mismatch · post-hash entry edits · missing hash · `earlyClose` flag disagreeing with status · `EARLY_CLOSE` not actually early · `CLOSED` carrying session times · `OPEN`/`EARLY_CLOSE` missing times · close ≤ open · duplicate dates · wrong timezone · empty entries · entries outside coverage · coverage gaps · bad schema version · unknown exchange · malformed dates · non-object.

**Mutation-verified:** removing provenance enforcement → 1 failure; removing the hash check → 2 failures.

**Scope limit, encoded as an assertion:** every fixture is labelled `SYNTHETIC`, and a test asserts no authoritative-looking calendar is exported and that no fixture URL resembles `nyse.com` or `nasdaq.com`.

---

## 5. Acceptance requirements vs. current state

| Requirement | Status |
|---|---|
| known regular open day → OPEN | ✅ resolver + schema support it |
| known holiday → CLOSED | ✅ |
| known early close → EARLY_CLOSE | ✅ |
| weekend → CLOSED | ✅ pinned |
| unknown date → UNKNOWN / fail closed | ✅ pinned by mutation |
| stale or missing data → UNKNOWN / fail closed | ⚠️ **schema-side only.** Dataset-level staleness (age of the derived dataset vs today) is **not yet modelled** — see below |
| DST transition → correct `America/New_York` instant | ✅ pinned against `Intl` |

### The one gap: dataset staleness is not yet modelled

`validateCalendarDataset` rejects a malformed or unhashed dataset. It does **not** yet refuse a dataset that is *valid but old* — e.g. a 2026 dataset consulted in 2027.

This is a known, deliberate gap, not an oversight. The resolver already fails closed on any date outside coverage, so an out-of-date dataset cannot silently classify an uncovered date as tradable. But an explicit **max dataset age** check would be stronger and is the natural next step.

---

## 6. What must happen before wiring

1. **Derive a dataset from the Nasdaq dated calendar** (not NYSE — footnote-only early closes). Human-supervised, recorded with provenance.
2. **Add dataset-age validation** (`maxAgeDays` relative to `derivedAt` or a supplied as-of), so a stale dataset refuses rather than returning `UNKNOWN` late.
3. **Decide coverage horizon behaviour.** Operators publish through 2028. Beyond that, the resolver returns `UNKNOWN` — which is correct, and means the system simply cannot trade past the published horizon. That is an accepted limitation, not a bug to work around.
4. **Resolve the Trader Alert gap.** Nasdaq's own documentation says to refer to alerts for all per-day information. Those are not machine-readable, so a same-day closure announced outside the annual calendar would not be caught by the dataset alone. This is an unresolvable-without-contact gap and should be recorded as such.
5. **GAP-019 remains independent.** Robinhood terms are unresolved regardless of calendar status.

## 7. Authorization boundary

Not done, per instruction: no calendar wired into production, no guessed holiday list, no live read, no Robinhood polling, no order, no GAP-017/019 change, no claim promotion, no fixture evidence promoted to campaign evidence.

The `Trading_Days.pdf` 2028 count of **257** is recorded as unexplained rather than reconciled — an unresolved anomaly in an official source is worth flagging rather than quietly discarding.

---

## 8. Addendum — dataset-age guard and the reviewed artifact (implemented)

### 8.1 Age and horizon guard

`admitCalendarForDate({ dataset, date, now, checklist })` answers the question
that actually matters before acting: **may this dataset be trusted today for
this date?** Every failure resolves to `UNKNOWN` and therefore `NO_TRADE`.

| Condition | Refusal code |
|---|---|
| no dataset supplied | `DATASET_MISSING` |
| malformed dataset | `DATASET_MALFORMED` |
| content hash ≠ entries | `DATASET_HASH_MISMATCH` |
| `derivedAt` older than 400 days | `DATASET_TOO_OLD` |
| `derivedAt` in the future (clock skew) | `DATASET_TOO_OLD` |
| date outside `coverageStart..coverageEnd` | `DATE_OUTSIDE_HORIZON` |
| covered date with no entry | `DATE_OUTSIDE_HORIZON` |
| same-day checklist incomplete | `REVIEW_INCOMPLETE` |

`MAX_DATASET_AGE_DAYS = 400`. Deliberately not 365: exchanges publish ~1.5
years forward, so a dataset is normally fresh, and an annual cycle plus
revisions means a 13-month-old dataset may already predate an amendment.

**Age and horizon are independent controls.** A still-fresh dataset may
legitimately resolve a covered date even when the wall clock has moved on. What
must never happen is resolving an *uncovered* date, which the horizon check
prevents. Two tests pin both directions.

### 8.2 Operator-reviewed artifact

`foundry/evidence/p11/calendar/nasdaq-2026.operator-reviewed.json`

| | |
|---|---|
| Label | `OPERATOR_REVIEWED_CALENDAR` |
| `automatedProviderData` | `false` |
| Source | `https://www.nasdaqtrader.com/trader.aspx?id=Calendar` |
| Source doc | U.S. Equity and Options Markets Holiday Schedule 2026 |
| `sourceVersion` | **`null`** — Nasdaq publishes none; not fabricated |
| Coverage | 2026-01-01 … 2026-12-31 |
| Entries | 261 (249 OPEN, 10 CLOSED, 2 EARLY_CLOSE) |
| Content hash | `1d8a2172…fad5acc` |
| Reproduced by | `scripts/derive-calendar-2026.mjs` (not in `pnpm verify`) |

Derivation: the **12 dated rows** of the published table were transcribed
verbatim as the only holiday input. Every other weekday is a regular
09:30–16:00 ET session, derived arithmetically. Re-derivation is
byte-identical.

Cross-check: 261 weekdays − 10 closures = **251 trading days**, which matches
NYSE's independently published 2026 total of 251. The 2028 figure of 257
remains unexplained.

### 8.3 Same-day operator checklist

```
annual calendar reviewed            -> yes
current Trader Alerts checked       -> yes
no unscheduled closure/early close  -> yes
operator confirms session           -> yes
(signed: confirmedBy + confirmedAt)
```

Incomplete → `UNKNOWN_SESSION` → `NO_TRADE`.

This is a **real control, not ceremony.** Nasdaq's own page directs readers to
Trader Alerts for all per-day information, and those alerts are not
machine-readable. An annual calendar therefore **cannot** detect a closure
announced on the morning of. The checklist is the only thing standing between a
valid-but-stale calendar and an unscheduled closure.

`complete` is **computed** from the four confirmations, not asserted by the
caller, so ticking three boxes and setting `complete: true` is impossible.
A checklist with every box ticked but no signature is still incomplete.

### 8.4 Verification

47 tests. Mutation results:

| Mutation | Failures |
|---|---|
| Age branch removed | 1 |
| Horizon + entry lookup removed | 4 |
| Checklist enforcement removed | 3 |
| Artifact `review` block removed | (schema validation) |

Derived-session tests pin every one of the 11 published 2026 exceptions plus
DST correctness on both sides of the November transition.

### 8.5 Corrections made during this work

Two of my own assertions were wrong and I fixed the tests, not the code:

- The age test set `derivedAt` in the **future**, so it exercised the clock-skew
  branch and left the age comparison unproven. Removing the age branch then
  produced **zero** failures — which is how I found it.
- A test asserted a 2026 dataset was refused in mid-2027 by age. At ~243 days
  it is inside the 400-day limit; what actually refuses it is the **horizon**.
  Age and horizon are separate controls.

---

## 9. Disposition — controlled path vs production

| Path | Status |
|---|---|
| **Controlled Demo / operator-triggered** | Supported, with a reviewed artifact + age guard + same-day checklist |
| **Unattended / production** | **BLOCKED** until an authorized machine-readable calendar source exists |
| **GAP-017** | Remains **PARTIAL / BLOCKED_EXTERNAL**. Not closed. |
| **GAP-019** | Remains **BLOCKED_EXTERNAL**. Independent of calendar status. |

The reviewed artifact is sufficient for a bounded operator-triggered
read-only run. It is **not** sufficient for unattended operation, and nothing
here should be read as closing either external gap.
