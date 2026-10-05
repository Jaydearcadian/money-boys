# Equity Benchmark Data Source — Decision Required (UNRESOLVED)

**Status: OPEN. The ingest works; the terms posture is not settled.**
`scripts/ingest-equity-candles.ts` is live and has written
`foundry/data/historical/EQUITY-{NVDA,TSLA,AAPL}-1D.json`. Those files are real
data from a real source, and **whether we are permitted to keep using them is
an open question**, exactly like GAP-019.

---

## 1. Why this document exists

The rToken ingest captured the **token leg only** — four Bitget venue perps
(`NVDAUSDT`, `TSLAUSDT`, `AAPLUSDT`, `BTCUSDT`). `evaluateBasisSpread` requires
`tradFiClosePrice`, the **underlying equity** close. Without it there is no
basis, no hurdle, no alpha, and no Sharpe. GAP-021's own residual says
*"actual rToken **and underlying** prices"*.

This is a second GAP-019-shaped problem, and it arrived by inheritance rather
than decision. This document exists so it becomes a decision.

## 2. What was actually tested (2026-10-03)

| Source | Result | Posture |
|---|---|---|
| **Stooq** CSV | **HTTP 403** | Not reachable. The previously-planned source does not work. |
| **Nasdaq** `api.nasdaq.com/api/quote/...` | **HTTP 200**, 87 bars/symbol | First-party data, **undocumented endpoint** |
| **Yahoo** `query1.finance.yahoo.com/v8/finance/chart` | **HTTP 200**, works | Third-party, **undocumented endpoint** |
| Binance klines | HTTP 451 | Geo-restricted, and no equity leg anyway |
| Robinhood `/rhj/prices` | HTTP 200 | **Current quote only — no history.** Cannot serve as a benchmark series. |

The ingest currently tries **Nasdaq first**, then Yahoo, and stamps which one it
used plus its `termsStatus` into both the per-symbol file and the manifest.

## 3. The actual tension

**Nasdaq** is first-party: it is the same publisher as our reviewed 2026 session
calendar. But its developer terms prohibit automated capture, and
`api.nasdaq.com/api/quote` is not in any published developer documentation. So
it is first-party *data* reached through an *undocumented* route — the same
posture as the calendar we already flagged in GAP-017.

**Yahoo** is documented in neither data nor endpoint. Their terms restrict
automated collection. Lower provenance, and we are redistributing derived
metrics in a public submission.

**Neither is clean.** That is the finding.

## 4. Recommended options

**Option A — Alpha Vantage (recommended).** Documented API, explicit developer
terms, free tier available. Cost: you register for a key. This is the only
option that is *documented*, and documentation is the thing that makes GAP-019
style reasoning tractable at all. **This is what I would pick.**

**Option B — Operator legal decision.** Record a signed decision accepting the
undocumented-endpoint posture, scoped exactly like GAP-019: read-only, cached,
no redistribution of raw vendor data, metrics only.

**Option C — Escalate to counsel.** The honest option if a public submission
depends on it.

**Not recommended: quietly using Yahoo because it works.** That is how GAP-019
happened.

## 5. Independent of the source decision — a real finding

The two legs **cannot be joined 1:1**, and this is not fixable with a data source:

```
NVDAUSDT  token bars: 90   equity bars matched: 64   token dates with NO equity: 26
```

rTokens quote 24/7. Equities do not. **26 of 90 token dates are weekends and
holidays with no equity counterpart.** Forward-filling Friday's close across the
weekend would manufacture basis that does not exist.

The backtest engine must **skip or explicitly flag** those dates. The ingest
records `joinCoverage` per symbol so the mismatch is impossible to overlook.

## 6. Coherence check (passed)

Both legs were compared on the 64 overlapping dates:

```
mean +0.498%   min -2.847%   max +7.870%   stdev 1.766%   n=64
```

No multiplier error — both series are in the same price range. The observed
dispersion is **1.766% stdev**, which is roughly **43x** the passive hurdle
(0.041%). The synthetic fixture only ever modelled 130–320bp (1.3–3.2%).

**Note the discrepancy with live reads:** the two live reads showed basis of
~0.05%, an order of magnitude tighter than this 1.766% daily stdev. Cause is
unconfirmed — most likely daily-close-vs-daily-close versus intraday-quote-vs-
intraday-quote. Worth resolving before a Sharpe is computed, because it
changes how many trades the strategy should fire.

## 7. Until this is decided

- The equity files are **present but provisional**, and every one carries
  `termsStatus` and `termsNote` in-band.
- **No Sharpe, Sortino or backtest metric derived from them may be published
  or submitted** until Option A/B/C is recorded.
- This is tracked as **GAP-023**.
