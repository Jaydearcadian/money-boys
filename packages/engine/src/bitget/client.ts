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

// ---------------------------------------------------------------------------
// USDT-MIX (futures) market data.
//
// Kept strictly separate from the spot ticker. On this venue the `r` prefix
// is SPOT-only and USDT-FUTURES uses the bare ticker, so the two symbol spaces
// are inverses of each other. Reusing getTicker() for a futures symbol fails
// with 40034 (GAP-013).
// ---------------------------------------------------------------------------

export const MIX_TICKER_PATH = "/api/v2/mix/market/ticker";
/** `/api/v2/mix/market/depth` 404s on this venue; orderbook is correct (GAP-014). */
export const MIX_ORDERBOOK_PATH = "/api/v2/mix/market/orderbook";
export const MIX_CONTRACTS_PATH = "/api/v2/mix/market/contracts";

export const MixTickerSchema = z.object({
  symbol: z.string().optional(),
  lastPr: z.string(),
  askPr: z.string().optional(),
  bidPr: z.string().optional(),
  markPrice: z.string().optional(),
  indexPrice: z.string().optional(),
  fundingRate: z.string().optional(),
  ts: z.string().optional(),
});
export type MixTicker = z.infer<typeof MixTickerSchema>;

export const MixOrderbookSchema = z.object({
  symbol: z.string().optional(),
  /** [price, size] pairs, venue sends strings. */
  asks: z.array(z.tuple([z.string(), z.string()])),
  bids: z.array(z.tuple([z.string(), z.string()])),
});
export type MixOrderbook = z.infer<typeof MixOrderbookSchema>;

export const MixContractConfigSchema = z.object({
  symbol: z.string().min(1),
  baseCoin: z.string().optional(),
  quoteCoin: z.string().optional(),
  symbolType: z.string().optional(),
  sizeMultiplier: z.string(),
  minTradeNum: z.string(),
  minTradeUSDT: z.string().optional(),
  pricePlace: z.string().optional(),
  volumePlace: z.string().optional(),
  makerFeeRate: z.string().optional(),
  takerFeeRate: z.string().optional(),
  supportMarginCoins: z.array(z.string()).optional(),
  /** Not a venue field; carried by the caller so notional can be checked. */
  referencePriceUsd: z.number().positive().optional(),
});
export type MixContractConfig = z.infer<typeof MixContractConfigSchema>;

export type BitgetClientConfig = {
  apiKey: string;
  secretKey: string;
  passphrase: string;
  baseUrl?: string;
  /**
   * Transport override. Defaults to the global `fetch`.
   *
   * Exists so PUBLIC, unauthenticated market reads can be exercised against a
   * deterministic stub with zero network access. It carries no credentials and
   * grants no capability: a private route still signs with the configured keys
   * and still talks to `baseUrl`. Do not use it to reach a different venue.
   */
  fetchImpl?: typeof fetch;
  /**
   * Bitget Demo Trading routes to the SAME base URL (https://api.bitget.com)
   * with the SAME HMAC signing — the only wire difference is the extra
   * `paptrading: 1` request header plus a Demo-scoped API key.
   * (https://www.bitget.com/api-doc/common/demotrading/restapi)
   * Default false so the live path is byte-identical to before.
   */
  demoTrading?: boolean;
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
  readonly demoTrading: boolean;
  /** Undefined means "use the current global fetch", resolved per call. */
  private readonly fetchOverride?: typeof fetch;

  constructor(cfg: BitgetClientConfig) {
    this.apiKey = cfg.apiKey;
    this.secretKey = cfg.secretKey;
    this.passphrase = cfg.passphrase;
    this.baseUrl = (cfg.baseUrl ?? "https://api.bitget.com").replace(/\/$/, "");
    this.demoTrading = cfg.demoTrading ?? false;
    this.fetchOverride = cfg.fetchImpl;
  }

  /**
   * Pre-flight audit vs 0-infinity (`src/testnet/index.ts`):
   *  - Query serialization matches upstream `queryString` exactly: sorted
   *    keys, `encodeURIComponent(k)=encodeURIComponent(v)` joined with "&".
   *  - Signing is HMAC-SHA256 in both. Prehash/message and digest encoding
   *    are venue-specific: upstream Binance testnet signs the query string
   *    (hex digest, `X-MBX-APIKEY` header); Bitget v2 signs
   *    `timestamp + METHOD + pathWithQuery + body` (base64 digest,
   *    `ACCESS-*` header casing below, per Bitget API v2 docs).
   */
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
      // Demo Trading routing: same base URL + same signing, plus this header.
      // Without it a Demo-scoped key hits the live matcher and the venue
      // answers 40099 "exchange environment is incorrect".
      if (this.demoTrading) {
        headers["paptrading"] = "1";
      }
    }
    // Resolved per call, not captured at construction: callers that swap
    // globalThis.fetch (test doubles, instrumented transports) must still work.
    const doFetch = this.fetchOverride ?? globalThis.fetch;
    const res = await doFetch(`${this.baseUrl}${pathWithQuery}`, {
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

  /**
   * SPOT ticker. Requires the r-prefixed venue symbol (rNVDAUSDT).
   *
   * SPOT ONLY: the spot market endpoint serves r-prefixed symbols and rejects
   * bare ones with 40034. For USDT-FUTURES use `getMixTicker` with the bare
   * symbol (NVDAUSDT). Mixing these up is GAP-013.
   */
  async getTicker(symbol: string): Promise<BitgetTicker> {
    const res = await this.request("GET", "/api/v2/spot/market/tickers", { symbol }, false);
    const rows = Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
    const first = rows[0];
    if (!first || typeof first !== "object") {
      throw new Error(`Unexpected ticker payload for ${symbol}: ${JSON.stringify(res.raw)}`);
    }
    return TickerSchema.parse(first);
  }

  /**
   * USDT-MIX (futures) ticker. Requires the BARE venue symbol (NVDAUSDT) and
   * a productType.
   *
   * Distinct from `getTicker` on purpose. The futures market serves bare
   * symbols and has no r-prefixed contracts at all, while the spot market is
   * the inverse. `GET /api/v2/mix/market/ticker` also REQUIRES productType;
   * omitting it yields 400172. Fails closed by throwing.
   */
  async getMixTicker(
    symbol: string,
    productType: string = "USDT-FUTURES",
  ): Promise<MixTicker> {
    const res = await this.request(
      "GET",
      MIX_TICKER_PATH,
      { symbol, productType },
      false,
    );
    if (String(res.code) !== "0" && String(res.code) !== "00000") {
      throw new Error(`Bitget mix ticker rejected ${symbol} (code=${res.code} msg=${res.msg ?? "n/a"})`);
    }
    const rows = Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
    const first = rows[0];
    if (!first || typeof first !== "object") {
      throw new Error(`Unexpected mix ticker payload for ${symbol}: ${JSON.stringify(res.raw)}`);
    }
    return MixTickerSchema.parse(first);
  }

  /**
   * USDT-MIX order book. Bare venue symbol + productType.
   *
   * Endpoint is `/api/v2/mix/market/orderbook`. The conventional-looking
   * `/api/v2/mix/market/depth` returns 404 on this venue (GAP-014).
   * Fails closed by throwing.
   */
  async getMixOrderbook(
    symbol: string,
    limit: number = 20,
    productType: string = "USDT-FUTURES",
  ): Promise<MixOrderbook> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new Error(`mix orderbook limit out of range: ${limit}`);
    }
    const res = await this.request(
      "GET",
      MIX_ORDERBOOK_PATH,
      { symbol, productType, limit: String(limit), type: "step0" },
      false,
    );
    if (String(res.code) !== "0" && String(res.code) !== "00000") {
      throw new Error(`Bitget mix orderbook rejected ${symbol} (code=${res.code} msg=${res.msg ?? "n/a"})`);
    }
    const rows = Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
    const first = rows[0];
    if (!first || typeof first !== "object") {
      throw new Error(`Unexpected mix orderbook payload for ${symbol}: ${JSON.stringify(res.raw)}`);
    }
    const parsed = MixOrderbookSchema.safeParse(first);
    if (!parsed.success) {
      throw new Error(`Malformed mix orderbook for ${symbol}: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  /**
   * Futures contract config. Bare venue symbol + productType.
   *
   * Validates the fields a bounded order needs: size multiplier, minimum
   * quantity, minimum notional, and price/quantity precision. Throws if the
   * symbol is not a tradable contract (venue answers 40034).
   */
  async getMixContractConfig(
    symbol: string,
    productType: string = "USDT-FUTURES",
  ): Promise<MixContractConfig> {
    const res = await this.request(
      "GET",
      MIX_CONTRACTS_PATH,
      { symbol, productType },
      false,
    );
    const rows = Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
    const first = rows[0];
    if (!first || typeof first !== "object") {
      throw new Error(
        `Futures contract ${symbol} (${productType}) is not tradable on this venue: ${JSON.stringify(res.raw)}`,
      );
    }
    return MixContractConfigSchema.parse(first);
  }

  /**
   * Assert a quantity is placeable under a contract config.
   *
   * Returns the validation result rather than throwing so a caller can record
   * a deterministic decline. Throws only on a malformed config.
   */
  /**
   * Smallest venue-compliant quantity for a target notional.
   *
   * `minTradeNum` and `minTradeUSDT` are INDEPENDENT constraints and can
   * conflict: 0.01 NVDA at $228.56 satisfies minTradeNum (0.01) but is only
   * $2.29 notional against a $5 minimum. Naively taking minTradeNum would
   * produce an order the venue rejects on size.
   *
   * Resolution order, each step rounded UP to a whole multiplier:
   *   1. start from max(target, minQty)
   *   2. if that still misses minNotional, step up by whole multipliers
   *   3. snap to the contract's volumePlace precision
   *   4. REVALIDATE the result through validateQuantity
   *
   * Returns null when no compliant quantity exists (bad config, or the size
   * ceiling is unreachable) so the caller fails closed rather than guessing.
   */
  static sizeToVenueCompliance(
    config: MixContractConfig,
    targetNotionalUsd: number,
    freeMarginUsd?: number,
    maxQuantityUsd?: number,
  ): {
    ok: boolean;
    quantity: number | null;
    notionalUsd: number | null;
    reasons: string[];
    steps: string[];
  } {
    const reasons: string[] = [];
    const steps: string[] = [];
    const multiplier = Number(config.sizeMultiplier);
    const minQty = Number(config.minTradeNum);
    const minUsdt = Number(config.minTradeUSDT);
    const price = Number(config.referencePriceUsd ?? 0);

    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      throw new Error(`Contract ${config.symbol} has an invalid sizeMultiplier`);
    }
    if (!Number.isFinite(price) || price <= 0) {
      reasons.push("a positive referencePriceUsd is required to size against notional");
      return { ok: false, quantity: null, notionalUsd: null, reasons, steps };
    }
    if (!Number.isFinite(minUsdt) || minUsdt <= 0) {
      reasons.push("contract has no usable minTradeUSDT; cannot guarantee a compliant size");
      return { ok: false, quantity: null, notionalUsd: null, reasons, steps };
    }

    const precision = config.volumePlace !== undefined ? Number(config.volumePlace) : NaN;
    if (Number.isFinite(precision) && (precision < 0 || !Number.isInteger(precision))) {
      reasons.push(`contract volumePlace ${config.volumePlace} is not a valid decimal precision`);
      return { ok: false, quantity: null, notionalUsd: null, reasons, steps };
    }

    const ceilToMultiplier = (q: number): number =>
      Math.ceil(q / multiplier - 1e-9) * multiplier;

    // Step 1: the larger of the caller's target and the minimum quantity.
    // Honouring the target matters — silently shrinking a $100 request down to
    // the venue minimum would be a wrong-sized order, not a safe one.
    if (!Number.isFinite(targetNotionalUsd) || targetNotionalUsd <= 0) {
      reasons.push("targetNotionalUsd must be a positive finite number");
      return { ok: false, quantity: null, notionalUsd: null, reasons, steps };
    }
    const targetQty = ceilToMultiplier(targetNotionalUsd / price);
    const minQtyFloor = Number.isFinite(minQty) && minQty > 0 ? minQty : multiplier;
    let qty = Math.max(targetQty, minQtyFloor);
    steps.push(
      `target $${targetNotionalUsd} -> ${targetQty}; minQty floor ${minQtyFloor}; chose ${qty}`,
    );

    // Step 2: raise until notional clears the venue minimum.
    const needQty = minUsdt / price;
    if (qty < needQty) {
      qty = ceilToMultiplier(needQty);
      steps.push(`minNotional ${minUsdt} USD requires >= ${needQty.toFixed(6)}; rounded up to ${qty}`);
    }
    // Floating point can leave us a hair under after ceil; nudge whole steps.
    let guard = 0;
    while (qty * price < minUsdt - 1e-9 && guard < 10_000) {
      qty = ceilToMultiplier(qty + multiplier);
      guard += 1;
    }
    if (guard > 0) steps.push(`nudged up ${guard} multiplier step(s) to clear minNotional`);
    if (guard >= 10_000) {
      reasons.push("could not reach minTradeUSDT within 10000 multiplier steps");
      return { ok: false, quantity: null, notionalUsd: null, reasons, steps };
    }

    // Step 3: snap to the contract's quantity precision.
    if (Number.isFinite(precision)) {
      const factor = 10 ** precision;
      const snapped = Math.round(qty * factor) / factor;
      // Rounding must never take us back under the minimum.
      const safe = snapped >= minQty ? snapped : ceilToMultiplier(minQty);
      if (safe !== snapped) steps.push(`precision snap would break minQty; kept ${safe}`);
      if (safe !== qty) steps.push(`snapped to volumePlace ${precision}dp: ${qty} -> ${safe}`);
      qty = safe;
    }

    const notional = Number((qty * price).toFixed(8));

    if (maxQuantityUsd !== undefined && Number.isFinite(maxQuantityUsd) && notional > maxQuantityUsd) {
      reasons.push(
        `compliant size notional $${notional.toFixed(2)} exceeds the caller's cap $${maxQuantityUsd}`,
      );
      return { ok: false, quantity: null, notionalUsd: null, reasons, steps };
    }

    // Step 4: revalidate rather than trusting the arithmetic above.
    const check = BitgetClient.validateQuantity({ ...config, referencePriceUsd: price }, qty);
    if (!check.ok) {
      reasons.push(...check.reasons);
      return { ok: false, quantity: null, notionalUsd: null, reasons, steps };
    }

    if (freeMarginUsd !== undefined && Number.isFinite(freeMarginUsd) && notional > freeMarginUsd) {
      reasons.push(
        `compliant size notional $${notional.toFixed(2)} exceeds free margin $${freeMarginUsd}`,
      );
      return { ok: false, quantity: null, notionalUsd: null, reasons, steps };
    }

    return { ok: true, quantity: qty, notionalUsd: notional, reasons, steps };
  }

  static validateQuantity(
    config: MixContractConfig,
    quantity: number,
  ): { ok: boolean; reasons: string[] } {
    const reasons: string[] = [];
    const multiplier = Number(config.sizeMultiplier);
    const minQty = Number(config.minTradeNum);
    const minUsdt = Number(config.minTradeUSDT);
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      throw new Error(`Contract ${config.symbol} has an invalid sizeMultiplier`);
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, reasons: ["quantity must be positive"] };
    }
    const steps = quantity / multiplier;
    if (Math.abs(steps - Math.round(steps)) > 1e-9) {
      reasons.push(
        `quantity ${quantity} is not a multiple of sizeMultiplier ${multiplier}`,
      );
    }
    if (Number.isFinite(minQty) && quantity < minQty) {
      reasons.push(`quantity ${quantity} is below minTradeNum ${minQty}`);
    }
    const price = Number(config.referencePriceUsd ?? 0);
    if (Number.isFinite(minUsdt) && minUsdt > 0 && Number.isFinite(price) && price > 0) {
      const notional = quantity * price;
      if (notional < minUsdt) {
        reasons.push(
          `notional $${notional.toFixed(2)} is below minTradeUSDT ${minUsdt}`,
        );
      }
    }
    return { ok: reasons.length === 0, reasons };
  }
}
