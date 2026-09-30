// Robinhood underlying-equity benchmark adapter (read-only, no credentials).
//
// Resolves GAP-018: a benchmark source whose OWN as-of timestamp is published.
//
// TIMESTAMP DISCIPLINE
//   sourceAsOf = provider `generatedAt`, verbatim
//   fetchedAt  = local Money Boys request time
// These are NEVER conflated. The MCP response-envelope timestamp is not a
// sourceAsOf; it records when we asked, not when the quote formed.
//
// MULTIPLIER DISCIPLINE
//   /rhj/prices returns RAW UNDERLYING-EQUITY bid/ask, not multiplier-adjusted
//   token values. `currentMultiplier` is carried as SEPARATE METADATA and is
//   never applied here. Applying it to a Bitget rToken would be wrong unless
//   Bitget's own instrument docs prove the same multiplier applies.
import {
  RH_ASSETS_PATH,
  RH_PRICES_CACHE_WINDOW_MS,
  RH_PRICES_PATH,
  RhAssetsResponseSchema,
  RhPricesResponseSchema,
  TIMESTAMP_TYPE_PROVIDER_QUOTE,
  type RhAsset,
  type RhQuote,
} from "./schemas.js";

export const BENCHMARK_PROVIDER = "robinhood_stock_token_api";

export class BenchmarkSourceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "BenchmarkSourceError";
    this.code = code;
  }
}

export interface RobinhoodBenchmark {
  provider: typeof BENCHMARK_PROVIDER;
  symbol: string;
  bid: number;
  ask: number;
  midpoint: number;
  currency: string;
  /** Provider-published quote instant. Never a fetch time. */
  sourceAsOf: string;
  /** Local request time. Never a substitute for sourceAsOf. */
  fetchedAt: string;
  timestampType: typeof TIMESTAMP_TYPE_PROVIDER_QUOTE;
  cacheWindowMs: number;
  isTradingHalt: boolean;
  sourceUrl: string;
  priceBasis: "RAW_UNDERLYING_EQUITY_NOT_MULTIPLIER_ADJUSTED";
  /** Metadata only. NEVER applied to the price. */
  multiplierMetadata: {
    currentMultiplier: string | null;
    appliedToPrice: false;
    note: string;
  };
}

export interface FetchLike {
  (input: string, init?: { signal?: AbortSignal }): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
}

async function getJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(url);
  } catch (e) {
    throw new BenchmarkSourceError("TRANSPORT", `request to ${url} failed: ${String(e)}`);
  }
  if (!res.ok) {
    throw new BenchmarkSourceError("HTTP", `${url} returned HTTP ${res.status}`);
  }
  try {
    return await res.json();
  } catch {
    throw new BenchmarkSourceError("MALFORMED_JSON", `${url} returned unparseable JSON`);
  }
}

/**
 * Parse a validated quote into a benchmark, or throw.
 *
 * Every rejection is an explicit typed failure so the caller's fail-closed
 * path can name the reason.
 */
export function parseBenchmarkQuote(args: {
  quote: RhQuote;
  expectedSymbol: string;
  fetchedAt: string;
  sourceUrl: string;
  asset?: RhAsset | undefined;
}): RobinhoodBenchmark {
  const { quote, expectedSymbol, fetchedAt, sourceUrl, asset } = args;

  if (quote.isTradingHalt) {
    throw new BenchmarkSourceError("TRADING_HALT", `${expectedSymbol} is under a trading halt`);
  }

  // Symbol identity must match exactly. A mismatch means we are not looking at
  // the instrument the strategy asked for.
  if (quote.tokenSymbol !== expectedSymbol) {
    throw new BenchmarkSourceError(
      "SYMBOL_MISMATCH",
      `expected ${expectedSymbol}, provider returned ${quote.tokenSymbol}`,
    );
  }
  if (asset) {
    if (asset.tokenSymbol !== expectedSymbol) {
      throw new BenchmarkSourceError(
        "SYMBOL_MISMATCH",
        `asset metadata ${asset.tokenSymbol} does not match ${expectedSymbol}`,
      );
    }
    if (asset.status !== "ASSET_STATUS_ACTIVE") {
      throw new BenchmarkSourceError(
        "ASSET_INACTIVE",
        `${expectedSymbol} status is ${asset.status}`,
      );
    }
  }

  const bid = Number(quote.bid);
  const ask = Number(quote.ask);
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) {
    throw new BenchmarkSourceError("MALFORMED_PRICE", `bid/ask not numeric: ${quote.bid}/${quote.ask}`);
  }
  if (bid <= 0 || ask <= 0) {
    throw new BenchmarkSourceError("NON_POSITIVE_PRICE", `bid/ask must be positive: ${bid}/${ask}`);
  }
  if (ask < bid) {
    throw new BenchmarkSourceError("CROSSED_QUOTE", `ask ${ask} is below bid ${bid}`);
  }

  // generatedAt is REQUIRED and must be a real instant. Nanosecond precision
  // is legal ISO-8601; JS Date parses to millisecond resolution.
  const raw = quote.generatedAt;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new BenchmarkSourceError("MISSING_GENERATED_AT", "provider published no generatedAt");
  }
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    throw new BenchmarkSourceError("MALFORMED_GENERATED_AT", `generatedAt '${raw}' is not ISO-8601`);
  }

  return {
    provider: BENCHMARK_PROVIDER,
    symbol: quote.tokenSymbol,
    bid,
    ask,
    midpoint: Number(((bid + ask) / 2).toFixed(6)),
    currency: quote.currency,
    // Verbatim provider instant, NOT normalised to our own formatting.
    sourceAsOf: raw,
    fetchedAt,
    timestampType: TIMESTAMP_TYPE_PROVIDER_QUOTE,
    cacheWindowMs: RH_PRICES_CACHE_WINDOW_MS,
    isTradingHalt: quote.isTradingHalt,
    sourceUrl,
    priceBasis: "RAW_UNDERLYING_EQUITY_NOT_MULTIPLIER_ADJUSTED",
    multiplierMetadata: {
      currentMultiplier: asset?.currentMultiplier ?? null,
      appliedToPrice: false,
      note:
        "Robinhood /prices bid/ask are raw underlying-equity values. currentMultiplier is " +
        "recorded for reference only and is NOT applied. Applying it to a Bitget rToken " +
        "requires independent proof that Bitget's instrument uses the same multiplier.",
    },
  };
}

/** Fetch and validate one underlying-equity benchmark. */
export async function fetchRobinhoodBenchmark(args: {
  symbol: string;
  baseUrl?: string;
  fetchImpl: FetchLike;
  fetchedAt?: string;
  withAssetMetadata?: boolean;
}): Promise<RobinhoodBenchmark> {
  const { symbol, fetchImpl } = args;
  const base = args.baseUrl ?? "https://api.robinhood.com";
  const fetchedAt = args.fetchedAt ?? new Date().toISOString();
  const url = `${base}${RH_PRICES_PATH}/${encodeURIComponent(symbol)}`;

  const body = await getJson(fetchImpl, url);
  const parsed = RhPricesResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new BenchmarkSourceError("SHAPE_DRIFT", `response did not match the documented shape: ${parsed.error.message}`);
  }
  const quotes = parsed.data.quotes;
  if (quotes.length === 0) {
    throw new BenchmarkSourceError("EMPTY_QUOTES", `no quote returned for ${symbol}`);
  }
  const quote = quotes.find((q) => q.tokenSymbol === symbol);
  if (!quote) {
    throw new BenchmarkSourceError(
      "SYMBOL_NOT_RETURNED",
      `provider returned ${quotes.length} quote(s), none for ${symbol}`,
    );
  }

  let asset: RhAsset | undefined;
  if (args.withAssetMetadata !== false) {
    try {
      const assetsBody = await getJson(fetchImpl, `${base}${RH_ASSETS_PATH}`);
      const assets = RhAssetsResponseSchema.safeParse(assetsBody);
      if (assets.success) {
        asset = assets.data.assets.find((a) => a.tokenSymbol === symbol);
        if (!asset) {
          throw new BenchmarkSourceError("ASSET_NOT_LISTED", `${symbol} absent from /rhj/assets`);
        }
      }
    } catch (e) {
      if (e instanceof BenchmarkSourceError) throw e;
      throw new BenchmarkSourceError("ASSET_FETCH_FAILED", String(e));
    }
  }

  return parseBenchmarkQuote({ quote, expectedSymbol: symbol, fetchedAt, sourceUrl: url, asset });
}

/** Map a Bitget repo symbol to the Robinhood underlying reference symbol. */
export function toUnderlyingReferenceSymbol(repoSymbol: string): string {
  const m = /^r([A-Z0-9]+)USDT$/i.exec(repoSymbol.trim());
  return m?.[1] ? m[1].toUpperCase() : repoSymbol.trim().toUpperCase();
}
