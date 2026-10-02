/**
 * TradFi Friday-benchmark snapshots via the Bitget Developer Toolkit
 * bitget-mcp-server (HTTP transport: https://agent.bitget.com/mcp).
 * Pure TypeScript, zero credentials.
 *
 * STRICT FAIL-CLOSED SEMANTICS (institutional requirement / S2 Hackathon):
 * live execution NEVER silently falls back to LOCAL_SNAPSHOT. The default
 * is allowFallback = false; any unreachable feed, HTTP error, or invalid
 * payload throws BenchmarkFeedUnavailableError. Callers (council adapter)
 * must catch it and HARD_VETO. Explicit opt-in fallback
 * (allowFallback: true) is reserved for offline PAPER tooling/tests only.
 */

export type BenchmarkSource = "BITGET_MCP" | "LOCAL_SNAPSHOT";

export interface TradFiBenchmark {
  symbol: string;
  closePriceUsd: number;
  asOf: string;
  source: BenchmarkSource;
}

/**
 * Maximum acceptable benchmark age, in milliseconds.
 *
 * A benchmark older than this is STALE and must veto rather than trade. The
 * repo snapshot is dated 2026-09-18 while the live price has moved ~44% since,
 * which is exactly the failure mode this bounds.
 */
export const BENCHMARK_MAX_AGE_MS = 96 * 60 * 60 * 1000; // one TradFi weekend

export class StaleBenchmarkError extends Error {
  readonly asOf: string;
  readonly ageMs: number;
  readonly maxAgeMs: number;
  constructor(asOf: string, ageMs: number, maxAgeMs: number) {
    super(
      `FAIL_CLOSED: benchmark is stale (asOf=${asOf}, age=${Math.round(ageMs / 60000)}min > max=${Math.round(maxAgeMs / 60000)}min)`,
    );
    this.name = "StaleBenchmarkError";
    this.asOf = asOf;
    this.ageMs = ageMs;
    this.maxAgeMs = maxAgeMs;
  }
}

/**
 * Deterministic staleness gate.
 *
 * Applies to every benchmark regardless of source. `LOCAL_SNAPSHOT` is only
 * ever produced for offline fixtures/tests, so a snapshot can never be used
 * for a live/demo strategy decision (GAP-015).
 */
export function assertBenchmarkFresh(
  benchmark: TradFiBenchmark,
  now: number = Date.now(),
  maxAgeMs: number = BENCHMARK_MAX_AGE_MS,
): TradFiBenchmark {
  const asOf = Date.parse(benchmark.asOf);
  if (Number.isNaN(asOf)) {
    throw new StaleBenchmarkError(benchmark.asOf, Number.POSITIVE_INFINITY, maxAgeMs);
  }
  const ageMs = now - asOf;
  if (ageMs > maxAgeMs) {
    throw new StaleBenchmarkError(benchmark.asOf, ageMs, maxAgeMs);
  }
  return benchmark;
}

/**
 * Gate for any live/demo strategy decision.
 *
 * Refuses LOCAL_SNAPSHOT outright and refuses stale MCP data. Throws so the
 * council adapter's existing catch seals HARD_VETO with zero execution.
 */
export function assertBenchmarkUsableForTrading(
  benchmark: TradFiBenchmark,
  now: number = Date.now(),
  maxAgeMs: number = BENCHMARK_MAX_AGE_MS,
): TradFiBenchmark {
  if (benchmark.source === "LOCAL_SNAPSHOT") {
    throw new Error(
      `FAIL_CLOSED: LOCAL_SNAPSHOT benchmark for ${benchmark.symbol} must not be used for live/demo trading`,
    );
  }
  return assertBenchmarkFresh(benchmark, now, maxAgeMs);
}

/**
 * OFFLINE TEST FIXTURE ONLY.
 *
 * The values are a frozen 2026-09-18 snapshot kept so existing unit tests and
 * PAPER tooling have a deterministic benchmark. They are ~44% away from the
 * live market and MUST NOT influence a Demo or live strategy decision. Use
 * `assertBenchmarkUsableForTrading` to enforce that.
 */
export const FRIDAY_CLOSE_SNAPSHOT: Record<string, number> = {
  rNVDAUSDT: 128.8,
  rTSLAUSDT: 218.0,
  rAAPLUSDT: 224.2,
  rMSFTUSDT: 428.5,
  rAMZNUSDT: 186.4,
};

/**
 * STAMP REQUIRED ON ANY PERFORMANCE ARTIFACT BUILT FROM A SNAPSHOT BENCHMARK.
 *
 * A snapshot is a hardcoded table. Any metric computed from one describes the
 * arithmetic of that table, not a market. Emitting such metrics WITHOUT this
 * stamp is how a fixture becomes apparent track evidence: the artifact in
 * foundry/evidence/paper-trading reported winRatePct 100 and maxDrawdownPct 0
 * over 29 trades, and every figure descended from one fabricated close plus
 * hand-authored dislocations plus a seeded RNG.
 */
export const SYNTHETIC_PERFORMANCE_STAMP = {
  syntheticFixture: true,
  validAsPerformanceEvidence: false,
  reason:
    "Computed from FRIDAY_CLOSE_SNAPSHOT (a hardcoded table) plus authored scenario inputs. " +
    "Describes the arithmetic of the fixture, not any market. NOT a backtest and NOT admissible " +
    "as Track 1 backtest record.",
} as const;

/** asOf for FRIDAY_CLOSE_SNAPSHOT. Offline fixtures only; not a live benchmark. */
export const BENCHMARK_AS_OF = "2026-09-18T20:00:00Z";
export const BITGET_MCP_URL = "https://agent.bitget.com/mcp";
export const BENCHMARK_TIMEOUT_MS = 1500;

/** Thrown when the live TradFi benchmark feed is unreachable/invalid and fail-closed is engaged. */
export class BenchmarkFeedUnavailableError extends Error {
  readonly symbol: string;
  constructor(symbol: string, detail = "feed unreachable") {
    super(`TradFi benchmark quote for ${symbol} failed: ${detail}. Fail-closed engaged.`);
    this.name = "BenchmarkFeedUnavailableError";
    this.symbol = symbol;
  }
}

export type FetchBenchmarkOptions = {
  /** Explicit opt-in to LOCAL_SNAPSHOT fallback. Default false (fail-closed). */
  allowFallback?: boolean;
};

/** "rNVDAUSDT" -> "NVDA", "rTSLAUSDT" -> "TSLA", passthrough otherwise. */
export function cleanUnderlyingSymbol(tokenSymbol: string): string {
  const m = /^r([A-Z]+)USDT$/.exec(tokenSymbol.trim());
  if (m?.[1]) return m[1];
  return tokenSymbol;
}

function snapshotFor(symbol: string): TradFiBenchmark {
  const close = FRIDAY_CLOSE_SNAPSHOT[symbol];
  if (close === undefined) {
    throw new Error(`No verified snapshot for symbol ${symbol}`);
  }
  return { symbol, closePriceUsd: close, asOf: BENCHMARK_AS_OF, source: "LOCAL_SNAPSHOT" };
}

function extractPrice(payload: unknown): number | null {
  if (payload === null || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const result = (root["result"] ?? root) as Record<string, unknown>;
  // MCP content blocks: { result: { content: [{ text: "..." }] } }
  const content = (result["content"] ?? root["content"]) as unknown;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block !== null && typeof block === "object") {
        const text = (block as Record<string, unknown>)["text"];
        if (typeof text === "string") {
          try {
            const parsed = JSON.parse(text) as Record<string, unknown>;
            for (const k of ["close", "closePrice", "price", "lastPrice"]) {
              const v = parsed[k];
              if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
              if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) > 0)
                return Number(v);
            }
          } catch {
            const num = Number(text);
            if (Number.isFinite(num) && num > 0) return num;
          }
        }
      }
    }
  }
  for (const k of ["close", "closePrice", "closePriceUsd", "price", "lastPrice"]) {
    const v = (result[k] ?? root[k]) as unknown;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) > 0)
      return Number(v);
  }
  return null;
}

/**
 * Fetch the Friday TradFi benchmark close for a token symbol.
 *
 * STRICT FAIL-CLOSED (default): tries the Bitget MCP `get_stock_quote`
 * tool with a 1500ms timeout; on timeout, HTTP error, or unparseable
 * payload THROWS BenchmarkFeedUnavailableError. No silent fallback.
 *
 * Set { allowFallback: true } ONLY for offline PAPER tooling/tests to
 * receive the verified static snapshot with source LOCAL_SNAPSHOT.
 */
export async function fetchTradFiBenchmark(
  symbol: string,
  fetchImpl: typeof fetch = fetch,
  opts?: FetchBenchmarkOptions | boolean,
): Promise<TradFiBenchmark> {
  const allowFallback =
    typeof opts === "boolean" ? opts : (opts?.allowFallback ?? false);
  const underlying = cleanUnderlyingSymbol(symbol);
  const fail = (detail: string): TradFiBenchmark => {
    if (allowFallback) return snapshotFor(symbol);
    throw new BenchmarkFeedUnavailableError(symbol, detail);
  };
  let res!: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BENCHMARK_TIMEOUT_MS);
    try {
      res = await fetchImpl(BITGET_MCP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "get_stock_quote", arguments: { symbol: underlying } },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (err instanceof BenchmarkFeedUnavailableError) throw err;
    const detail = err instanceof Error ? err.message : String(err);
    return fail(`feed unreachable (${detail})`);
  }
  if (!res!.ok) return fail(`feed unreachable (HTTP ${res!.status})`);
  let body: unknown;
  try {
    body = await res!.json();
  } catch {
    return fail("feed unreachable (invalid JSON)");
  }
  const price = extractPrice(body);
  if (price === null) return fail("feed unreachable (invalid response)");
  return {
    symbol,
    closePriceUsd: price,
    asOf: new Date().toISOString(),
    source: "BITGET_MCP",
  };
}

export const TradFiBenchmarkService = {
  fetch: fetchTradFiBenchmark,
  snapshot: snapshotFor,
  cleanSymbol: cleanUnderlyingSymbol,
  closes: FRIDAY_CLOSE_SNAPSHOT,
  assertFresh: assertBenchmarkFresh,
  assertUsableForTrading: assertBenchmarkUsableForTrading,
  maxAgeMs: BENCHMARK_MAX_AGE_MS,
};
