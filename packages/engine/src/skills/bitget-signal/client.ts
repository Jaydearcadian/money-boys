import { createHash } from "node:crypto";

/**
 * Bitget-signal research client (zero-credential research skills:
 * macro-analyst, news-briefing, sentiment-analyst).
 * Macro Boy ingests raw news headlines; Quant Boy calibrates the
 * funding-carry penalty from funding/sentiment context.
 * All entrypoints fail closed to deterministic simulated data — never throw.
 */

export interface RawCatalyst {
  headline: string;
  source: string;
  timestamp: string;
}

export interface MarketSentiment {
  fundingRate8h: number;
  longShortRatio: number;
}

export const BITGET_SIGNAL_TIMEOUT_MS = 1500;

function simSeed(symbol: string): number {
  const hex = createHash("sha256").update(`bitget-signal:${symbol}`).digest("hex").slice(0, 8);
  return parseInt(hex, 16) / 0xffffffff;
}

/** Deterministic simulated headlines (offline fallback). */
export function simulatedCatalysts(symbol: string): RawCatalyst[] {
  const base = "2026-09-18T20:00:00Z";
  return [
    {
      headline: `${symbol} weekend basis watch: desk notes Friday close imbalance into Monday reopen`,
      source: "news-briefing",
      timestamp: base,
    },
    {
      headline: `${symbol} options flow skewed to upside calls ahead of weekend session`,
      source: "sentiment-analyst",
      timestamp: base,
    },
    {
      headline: `Macro desk: Fed speaker commentary keeps weekend risk premium elevated for ${symbol}`,
      source: "macro-analyst",
      timestamp: base,
    },
  ];
}

/** Deterministic simulated funding/sentiment context (offline fallback). */
export function simulatedSentiment(symbol: string): MarketSentiment {
  const s = simSeed(symbol);
  return {
    fundingRate8h: Math.round((0.00005 + s * 0.0002) * 1e8) / 1e8,
    longShortRatio: Math.round((1.0 + s * 0.8) * 100) / 100,
  };
}

/**
 * Fetch latest raw catalysts for a symbol via the news-briefing skill
 * surface. Falls back to deterministic simulated headlines offline.
 */
export async function fetchLatestCatalysts(symbol: string): Promise<RawCatalyst[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BITGET_SIGNAL_TIMEOUT_MS);
    try {
      const res = await fetch("https://agent.bitget.com/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "news_briefing", arguments: { symbol } },
        }),
        signal: controller.signal,
      });
      if (!res.ok) return simulatedCatalysts(symbol);
      const body = (await res.json()) as Record<string, unknown>;
      const result = (body["result"] ?? body) as Record<string, unknown>;
      const content = result["content"] as unknown;
      if (Array.isArray(content) && content.length > 0) {
        const out: RawCatalyst[] = [];
        for (const block of content.slice(0, 8)) {
          if (block !== null && typeof block === "object") {
            const text = (block as Record<string, unknown>)["text"];
            if (typeof text === "string" && text.trim().length > 0) {
              out.push({
                headline: text.trim().slice(0, 280),
                source: "news-briefing",
                timestamp: new Date().toISOString(),
              });
            }
          }
        }
        if (out.length > 0) return out;
      }
      return simulatedCatalysts(symbol);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return simulatedCatalysts(symbol);
  }
}

/**
 * Fetch live-or-simulated funding/sentiment context to inform Quant Boy's
 * funding carry penalty (H_funding). Never throws.
 */
export async function fetchMarketSentiment(symbol: string): Promise<MarketSentiment> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BITGET_SIGNAL_TIMEOUT_MS);
    try {
      const res = await fetch("https://agent.bitget.com/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "sentiment_analysis", arguments: { symbol } },
        }),
        signal: controller.signal,
      });
      if (!res.ok) return simulatedSentiment(symbol);
      const body = (await res.json()) as Record<string, unknown>;
      const result = (body["result"] ?? body) as Record<string, unknown>;
      const fr = result["fundingRate8h"] ?? result["fundingRate"] ?? (result["data"] as Record<string, unknown> | undefined)?.["fundingRate8h"];
      const lsr = result["longShortRatio"] ?? (result["data"] as Record<string, unknown> | undefined)?.["longShortRatio"];
      const fundingRate8h =
        typeof fr === "number" && Number.isFinite(fr) ? fr : simulatedSentiment(symbol).fundingRate8h;
      const longShortRatio =
        typeof lsr === "number" && Number.isFinite(lsr) && lsr > 0
          ? lsr
          : simulatedSentiment(symbol).longShortRatio;
      return { fundingRate8h, longShortRatio };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return simulatedSentiment(symbol);
  }
}

/** SHA-256 evidence binding for an incoming (headline + source) signal. */
export function hashSignalEvidence(headline: string, source: string): string {
  return createHash("sha256").update(`${headline}::${source}`, "utf8").digest("hex");
}
