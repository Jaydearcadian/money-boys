import { createHmac } from "node:crypto";
import { z } from "zod";

const TickerSchema = z.object({
  symbol: z.string().optional(),
  lastPr: z.string(),
  bidPr: z.string().optional(),
  askPr: z.string().optional(),
  ts: z.string().optional(),
});

export type BitgetTicker = z.infer<typeof TickerSchema>;

export type BitgetClientConfig = {
  apiKey: string;
  secretKey: string;
  passphrase: string;
  baseUrl?: string;
};

/**
 * Minimal Bitget API v2 client.
 * Public reads work without live keys.
 * Private routes require HMAC-SHA256 signing (I-03 receipt sealing is separate).
 */
export class BitgetClient {
  readonly apiKey: string;
  readonly secretKey: string;
  readonly passphrase: string;
  readonly baseUrl: string;

  constructor(cfg: BitgetClientConfig) {
    this.apiKey = cfg.apiKey;
    this.secretKey = cfg.secretKey;
    this.passphrase = cfg.passphrase;
    this.baseUrl = (cfg.baseUrl ?? "https://api.bitget.com").replace(/\/$/, "");
  }

  private sign(timestamp: string, method: string, path: string, body: string): string {
    const prehash = `${timestamp}${method.toUpperCase()}${path}${body}`;
    return createHmac("sha256", this.secretKey).update(prehash).digest("base64");
  }

  async request(
    method: "GET" | "POST",
    path: string,
    query: Record<string, string> = {},
    auth = false,
    bodyObj?: unknown,
  ): Promise<{ code: string; msg?: string; data?: unknown; raw: unknown }> {
    const qs = Object.keys(query)
      .sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k]!)}`)
      .join("&");
    const pathWithQuery = qs ? `${path}?${qs}` : path;
    const body = bodyObj === undefined ? "" : JSON.stringify(bodyObj);
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (auth) {
      const timestamp = Date.now().toString();
      headers["ACCESS-KEY"] = this.apiKey;
      headers["ACCESS-SIGN"] = this.sign(timestamp, method, pathWithQuery, body);
      headers["ACCESS-TIMESTAMP"] = timestamp;
      headers["ACCESS-PASSPHRASE"] = this.passphrase;
      headers.locale = "en-US";
    }
    const res = await fetch(`${this.baseUrl}${pathWithQuery}`, {
      method,
      headers,
      body: method === "GET" ? undefined : body || undefined,
    });
    const raw = (await res.json()) as { code?: string; msg?: string; data?: unknown };
    if (!res.ok) {
      throw new Error(`Bitget HTTP ${res.status}: ${JSON.stringify(raw)}`);
    }
    return {
      code: String(raw.code ?? res.status),
      msg: raw.msg,
      data: raw.data,
      raw,
    };
  }

  async getTicker(symbol: string): Promise<BitgetTicker> {
    const res = await this.request("GET", "/api/v2/spot/market/tickers", { symbol }, false);
    const rows = Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
    const first = rows[0];
    if (!first || typeof first !== "object") {
      throw new Error(`Unexpected ticker payload for ${symbol}: ${JSON.stringify(res.raw)}`);
    }
    return TickerSchema.parse(first);
  }
}
