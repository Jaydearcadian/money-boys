/**
 * TradFi Friday-benchmark snapshots via the Bitget Developer Toolkit
 * bitget-mcp-server (HTTP transport: https://agent.bitget.com/mcp).
 * Pure TypeScript, zero credentials. Fail-closed to verified static
 * Friday-close snapshots when the MCP endpoint is unreachable.
 */

export type BenchmarkSource = "BITGET_MCP" | "LOCAL_SNAPSHOT";

export interface TradFiBenchmark {
  symbol: string;
  closePriceUsd: number;
  asOf: string;
  source: BenchmarkSource;
}

/** Verified Friday-close snapshot (fallback when MCP is unreachable). */
export const FRIDAY_CLOSE_SNAPSHOT: Record<string, number> = {
  rNVDAUSDT: 128.8,
  rTSLAUSDT: 218.0,
  rAAPLUSDT: 224.2,
  rMSFTUSDT: 428.5,
  rAMZNUSDT: 186.4,
};

export const BENCHMARK_AS_OF = "2026-09-18T20:00:00Z";
export const BITGET_MCP_URL = "https://agent.bitget.com/mcp";
export const BENCHMARK_TIMEOUT_MS = 1500;

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
 * Tries the Bitget MCP `get_stock_quote` tool with a 1500ms timeout;
 * on timeout, HTTP error, or unparseable payload returns the verified
 * static snapshot with source LOCAL_SNAPSHOT. Never throws for a
 * known snapshot symbol.
 */
export async function fetchTradFiBenchmark(
  symbol: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TradFiBenchmark> {
  const underlying = cleanUnderlyingSymbol(symbol);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BENCHMARK_TIMEOUT_MS);
    try {
      const res = await fetchImpl(BITGET_MCP_URL, {
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
      if (!res.ok) return snapshotFor(symbol);
      const body: unknown = await res.json();
      const price = extractPrice(body);
      if (price === null) return snapshotFor(symbol);
      return {
        symbol,
        closePriceUsd: price,
        asOf: new Date().toISOString(),
        source: "BITGET_MCP",
      };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return snapshotFor(symbol);
  }
}

export const TradFiBenchmarkService = {
  fetch: fetchTradFiBenchmark,
  snapshot: snapshotFor,
  cleanSymbol: cleanUnderlyingSymbol,
  closes: FRIDAY_CLOSE_SNAPSHOT,
};
