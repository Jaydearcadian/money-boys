/**
 * EQUITY LEG INGEST — the half of the dataset that does not exist yet.
 *
 * WHY THIS FILE IS NECESSARY
 *   The rToken ingest (ingest-historical-candles.ts) captured FOUR venue
 *   perps: NVDAUSDT, TSLAUSDT, AAPLUSDT, BTCUSDT. That is the TOKEN leg only.
 *   evaluateBasisSpread requires `tradFiClosePrice` — the UNDERLYING equity
 *   close. Without it there is no basis, no hurdle, no alpha and nothing to
 *   compute Sharpe from. A backtest cannot be written against the existing
 *   dataset. This closes that hole.
 *
 * THE ALIGNMENT PROBLEM, STATED UP FRONT
 *   rTokens quote 24/7. Equities do not. The venue series has ~90 consecutive
 *   daily bars with no gaps; the equity series has ~66 bars over the same
 *   calendar span, because weekends and holidays are absent.
 *
 *   CONSEQUENCE: the two series CANNOT be joined 1:1 on date. A weekend rToken
 *   close has no equity counterpart, and comparing it to Friday's close would
 *   manufacture a basis that does not exist. This script therefore records the
 *   exact trading-date set per symbol and reports JOIN COVERAGE, so the
 *   backtest engine is forced to confront the mismatch rather than discover it
 *   after producing a Sharpe.
 *
 * TERMS OF USE ARE NOT SETTLED BY THIS SCRIPT
 *   Sources are tried in a deliberate order and the one actually used is
 *   stamped into the manifest with its terms status. See
 *   docs/data/EQUITY_SOURCE_DECISION.md — that document is the decision, this
 *   file only records which way it went.
 *
 * Usage: node --import tsx scripts/ingest-equity-candles.ts
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "foundry", "data", "historical");
const MANIFEST = join(OUT_DIR, "manifest.json");

/** Underlying equities for the rTokens already ingested. BTC has no equity leg. */
const EQUITIES: ReadonlyArray<{ symbol: string; rtoken: string }> = [
  { symbol: "NVDA", rtoken: "NVDAUSDT" },
  { symbol: "TSLA", rtoken: "TSLAUSDT" },
  { symbol: "AAPL", rtoken: "AAPLUSDT" },
];

interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Provider {
  id: string;
  endpointPattern: string;
  /** Terms posture recorded in the manifest. Never inferred at read time. */
  termsStatus: "DOCUMENTED_API" | "FIRST_PARTY_UNDOCUMENTED" | "THIRD_PARTY_UNDOCUMENTED";
  termsNote: string;
  fetchDaily(symbol: string): Promise<Bar[]>;
}

const UA = "Mozilla/5.0 (X11; Linux x86_64) money-boys-research";

async function getJson(url: string): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { "user-agent": UA, accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ALPHA_VANTAGE_KEY =
  process.env.ALPHAVANTAGE_API_KEY ||
  process.env.ALPHA_VANTAGE_API_KEY ||
  "5ZGLV4J6L4R1IH0J";

/**
 * Official Alpha Vantage TIME_SERIES_DAILY API.
 * Documented developer endpoint with explicit free-tier developer terms.
 */
const alphaVantage: Provider = {
  id: "alpha_vantage_daily",
  endpointPattern: "https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol={symbol}&apikey={key}&outputsize=compact",
  termsStatus: "DOCUMENTED_API",
  termsNote:
    "Official Alpha Vantage TIME_SERIES_DAILY API with documented developer terms of service.",
  async fetchDaily(symbol) {
    if (!ALPHA_VANTAGE_KEY) throw new Error("ALPHAVANTAGE_API_KEY missing");
    const url = alphaVantage.endpointPattern
      .replace("{symbol}", encodeURIComponent(symbol))
      .replace("{key}", encodeURIComponent(ALPHA_VANTAGE_KEY));
    const data = (await getJson(url)) as Record<string, unknown>;
    const ts = data["Time Series (Daily)"] as Record<string, Record<string, string>> | undefined;
    if (!ts || typeof ts !== "object") {
      const errNote = data["Note"] || data["Information"] || data["Error Message"] || JSON.stringify(data).slice(0, 120);
      throw new Error(`Alpha Vantage response missing Time Series (Daily): ${errNote}`);
    }
    const out: Bar[] = [];
    for (const [date, row] of Object.entries(ts)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      out.push({
        date,
        open: Number(row["1. open"] ?? 0),
        high: Number(row["2. high"] ?? 0),
        low: Number(row["3. low"] ?? 0),
        close: Number(row["4. close"] ?? 0),
        volume: Number(row["5. volume"] ?? 0),
      });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  },
};

/**
 * Nasdaq's own quote API. First-party data from the same publisher as the
 * 2026 session calendar, but the endpoint itself is not in their published
 * developer documentation, so the terms posture is UNDOCUMENTED either way.
 */
const nasdaq: Provider = {
  id: "nasdaq_quote_api",
  endpointPattern: "https://api.nasdaq.com/api/quote/{symbol}/historical?assetclass=stocks&fromdate={from}&todate={to}&limit=200",
  termsStatus: "FIRST_PARTY_UNDOCUMENTED",
  termsNote:
    "Nasdaq-published data from Nasdaq's own API, but the endpoint is undocumented and " +
    "nasdaqtrader.com terms prohibit automated capture. Same posture as the session calendar.",
  async fetchDaily(symbol) {
    const url = nasdaq.endpointPattern
      .replace("{symbol}", encodeURIComponent(symbol))
      .replace("{from}", "2026-06-01")
      .replace("{to}", "2026-10-03");
    const root = (await getJson(url)) as {
      data?: { tradesTable?: { rows?: Array<Record<string, string>> } };
    };
    const rows = root.data?.tradesTable?.rows ?? [];
    const num = (v: string | undefined): number => Number(String(v ?? "").replace(/[$,]/g, ""));
    const out: Bar[] = [];
    for (const r of rows) {
      const d = String(r["date"] ?? "");
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d);
      if (!m) continue;
      out.push({
        date: `${m[3]}-${m[1]}-${m[2]}`,
        close: num(r["close"]),
        open: num(r["open"]),
        high: num(r["high"]),
        low: num(r["low"]),
        volume: num(r["volume"]),
      });
    }
    // API returns newest-first; store oldest-first for chronological replay.
    return out.sort((a, b) => a.date.localeCompare(b.date));
  },
};

/** Yahoo's chart endpoint. Works, but third-party and undocumented. */
const yahoo: Provider = {
  id: "yahoo_chart_api",
  endpointPattern: "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=6mo&interval=1d",
  termsStatus: "THIRD_PARTY_UNDOCUMENTED",
  termsNote:
    "Yahoo Finance data via an endpoint absent from their published developer docs. " +
    "Yahoo terms restrict automated collection. Lower provenance than first-party.",
  async fetchDaily(symbol) {
    const url = yahoo.endpointPattern.replace("{symbol}", encodeURIComponent(symbol));
    const root = (await getJson(url)) as {
      chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<Record<string, Array<number | null>>> } }> };
    };
    const r = root.chart?.result?.[0];
    if (!r?.timestamp) return [];
    const q = r.indicators?.quote?.[0] ?? {};
    const out: Bar[] = [];
    for (let i = 0; i < r.timestamp.length; i++) {
      const c = q["close"]?.[i];
      if (c === null || c === undefined) continue;
      out.push({
        date: new Date((r.timestamp[i] as number) * 1000).toISOString().slice(0, 10),
        open: Number(q["open"]?.[i] ?? 0),
        high: Number(q["high"]?.[i] ?? 0),
        low: Number(q["low"]?.[i] ?? 0),
        close: Number(c),
        volume: Number(q["volume"]?.[i] ?? 0),
      });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  },
};

const PROVIDERS: Provider[] = [alphaVantage, nasdaq, yahoo];

function loadTokenDates(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const sym of ["NVDAUSDT", "TSLAUSDT", "AAPLUSDT", "BTCUSDT"]) {
    try {
      // The rToken files are a bare ARRAY of bar objects, not an object with a
      // `bars` key. Reading it the wrong way yields an EMPTY set, which would
      // report join coverage as 0/0 and read like "no overlap" instead of
      // "could not read the series". A silent 0/0 is a false negative, so the
      // count is asserted to be non-zero.
      const raw = JSON.parse(readFileSync(join(OUT_DIR, `${sym}-1D.json`), "utf8")) as
        | Array<{ timestampMs: number; dateIso?: string }>
        | { bars?: Array<{ timestampMs: number; dateIso?: string }> };
      const arr = Array.isArray(raw) ? raw : (raw.bars ?? []);
      if (arr.length === 0) throw new Error(`${sym}-1D.json contained no bars`);
      const dates = new Set<string>();
      for (const b of arr) {
        // dateIso is a UTC instant at 16:00Z; the ET session date is the bar's
        // own date, so derive it from the instant consistently for both legs.
        dates.add(new Date(b.timestampMs).toISOString().slice(0, 10));
      }
      map.set(sym, dates);
    } catch (e) {
      throw new Error(`cannot read rToken series for ${sym}: ${String(e)}`);
    }
  }
  return map;
}

async function main(): Promise<void> {
  const tokenDates = loadTokenDates();
  const out: Record<string, unknown> = {};
  const summary: string[] = [];

  for (let idx = 0; idx < EQUITIES.length; idx++) {
    const { symbol, rtoken } = EQUITIES[idx]!;
    if (idx > 0) await sleep(2000); // Respect burst limits
    let bars: Bar[] = [];
    let used: Provider | null = null;
    let lastErr: unknown = null;
    for (const p of PROVIDERS) {
      try {
        const got = await p.fetchDaily(symbol);
        if (got.length > 0 && got.every((b) => b.close > 0)) {
          bars = got;
          used = p;
          break;
        }
        lastErr = new Error(`${p.id} returned ${got.length} usable bars`);
      } catch (e) {
        lastErr = e;
      }
    }
    if (!used) throw new Error(`no provider produced equity bars for ${symbol}: ${String(lastErr)}`);

    // ---- join coverage against the rToken series: THE number that matters
    const tokenSet = tokenDates.get(rtoken) ?? new Set<string>();
    if (tokenSet.size === 0) throw new Error(`no rToken dates loaded for ${rtoken}; refusing to report a false 0/0 join`);
    const equitySet = new Set(bars.map((b) => b.date));
    const matched = [...tokenSet].filter((d) => equitySet.has(d)).length;
    const tokenOnly = [...tokenSet].filter((d) => !equitySet.has(d)).length;

    const payload = {
      schemaVersion: 1,
      kind: "UNDERLYING_EQUITY_DAILY",
      symbol,
      rtokenLeg: rtoken,
      granularity: "1D",
      provider: used.id,
      termsStatus: used.termsStatus,
      termsNote: used.termsNote,
      endpoint: used.endpointPattern,
      fetchedAt: new Date().toISOString(),
      barsCount: bars.length,
      startDateIso: bars[0]?.date ?? null,
      endDateIso: bars[bars.length - 1]?.date ?? null,
      joinCoverage: {
        rtokenBars: tokenSet.size,
        equityBars: bars.length,
        datesMatching: matched,
        rtokenDatesWithoutEquity: tokenOnly,
        note:
          "rToken quotes 24/7; the equity does not. Dates absent from the equity series are " +
          "weekends/holidays and MUST NOT be paired with a stale prior close. The backtest " +
          "engine must skip or explicitly flag them rather than forward-fill.",
      },
      bars,
    };
    const file = join(OUT_DIR, `EQUITY-${symbol}-1D.json`);
    const text = `${JSON.stringify(payload, null, 2)}\n`;
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(file, text);
    out[symbol] = {
      file: `EQUITY-${symbol}-1D.json`,
      provider: used.id,
      termsStatus: used.termsStatus,
      barsCount: bars.length,
      startDateIso: bars[0]?.date ?? null,
      endDateIso: bars[bars.length - 1]?.date ?? null,
      fileSha256: createHash("sha256").update(text).digest("hex"),
      joinCoverage: { rtokenBars: tokenSet.size, equityBars: bars.length, datesMatching: matched, rtokenDatesWithoutEquity: tokenOnly },
    };
    summary.push(
      `${symbol}: ${bars.length} bars ${bars[0]?.date}->${bars[bars.length - 1]?.date} via ${used.id} | join ${matched}/${tokenSet.size} token dates matched, ${tokenOnly} token dates have NO equity (weekend/holiday)`,
    );
  }

  // ---- extend the existing manifest rather than replacing it -------------
  let manifest: Record<string, unknown> = {};
  try {
    manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Record<string, unknown>;
  } catch { manifest = {}; }
  manifest["equityLeg"] = {
    ingestedAt: new Date().toISOString(),
    purpose: "Underlying equity closes required by evaluateBasisSpread(tradFiClosePrice). The rToken ingest alone cannot produce a basis.",
    termsDecisionDoc: "docs/data/EQUITY_SOURCE_DECISION.md",
    symbols: out,
  };
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

  for (const line of summary) console.log(line);
  console.log("\nmanifest extended with equityLeg. Terms posture is UNRESOLVED — see docs/data/EQUITY_SOURCE_DECISION.md");
}

main().catch((e: unknown) => {
  console.error(`INGEST FAILED: ${String(e instanceof Error ? e.message : e)}`);
  process.exit(1);
});