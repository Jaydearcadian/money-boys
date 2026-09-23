import { createHash } from "node:crypto";
import type { SealedReasoningReceipt } from "../council/receipts.js";

export type DispatcherMode = "PAPER" | "TESTNET" | "DEMO" | "LIVE";

export interface ExecutionRecord {
  orderId: string;
  clientOid: string;
  symbol: string;
  side: "BUY" | "SELL";
  mode: DispatcherMode;
  quantity: number;
  fillPriceUsd: number;
  feeUsd: number;
  status: "FILLED" | "REJECTED";
  receiptHash: string;
  executedAt: string;
  latencyMs: number;
  /** Present on REJECTED (venue error code / message). */
  error?: string;
  /** Raw venue payload for evidence (orderId, fill details, HTTP status). */
  venueResponse?: unknown;
}

export interface BitgetOrderClient {
  apiKey?: string;
  secretKey?: string;
  passphrase?: string;
  placeOrder?: (args: {
    symbol: string;
    side: "BUY" | "SELL";
    quantity: number;
    priceUsd: number;
  }) => Promise<{ orderId: string; clientOid?: string; fillPriceUsd?: number; feeUsd?: number }>;
  request?: (
    method: "GET" | "POST",
    path: string,
    query?: Record<string, string>,
    auth?: boolean,
    bodyObj?: unknown,
  ) => Promise<{ code: string; msg?: string; data?: unknown; raw?: unknown }>;
}

export const PAPER_TAKER_FEE = 0.0006;

/** Bitget v2 futures order endpoint used for Demo/Testnet paper execution. */
export const DEMO_MIX_ORDER_PATH = "/api/v2/mix/order/place-order";

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Map internal symbols to venue symbols: rNVDAUSDT -> NVDAUSDT, BTCUSDT passthrough. */
export function mapToVenueSymbol(symbol: string): string {
  const m = /^r([A-Z0-9]+)USDT$/i.exec(symbol.trim());
  if (m?.[1]) return `${m[1]!.toUpperCase()}USDT`;
  return symbol.trim().toUpperCase();
}

function isMissing(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

/**
 * OrderDispatcher — event -> decision -> execution bridge.
 * PAPER mode is pure/deterministic (no network, no keys).
 * TESTNET/DEMO execute REAL signed orders against the Bitget Demo
 * matching engine via HMAC-SHA256 authenticated REST
 * (POST /api/v2/mix/order/place-order). LIVE is the production venue.
 * Fail-closed: missing credentials throw on boot; venue errors return
 * REJECTED records (never silently simulated).
 */
export class OrderDispatcher {
  readonly mode: DispatcherMode;
  private readonly bitgetClient?: BitgetOrderClient;

  constructor(mode: DispatcherMode = "PAPER", bitgetClient?: BitgetOrderClient) {
    const normalized = mode.toUpperCase() as DispatcherMode;
    this.mode = normalized;
    // Fail-closed on boot: TESTNET/DEMO/LIVE require a signed client.
    if (normalized === "TESTNET" || normalized === "DEMO" || normalized === "LIVE") {
      if (!bitgetClient) {
        throw new Error(
          `Cannot initialize OrderDispatcher in ${normalized} mode without bitgetClient (BITGET_API_KEY/SECRET/PASSPHRASE required). Do not simulate.`,
        );
      }
      const c = bitgetClient as BitgetOrderClient & {
        apiKey?: unknown;
        secretKey?: unknown;
        passphrase?: unknown;
      };
      // When the client exposes credential fields, they must be non-empty.
      if (
        ("apiKey" in c || "secretKey" in c || "passphrase" in c) &&
        (isMissing(c.apiKey) || isMissing(c.secretKey) || isMissing(c.passphrase))
      ) {
        throw new Error(
          `Cannot initialize OrderDispatcher in ${normalized} mode with missing/empty Bitget credentials (BITGET_API_KEY, BITGET_SECRET_KEY, BITGET_PASSPHRASE required). Do not simulate.`,
        );
      }
      if (typeof c.placeOrder !== "function" && typeof c.request !== "function") {
        throw new Error(`bitgetClient supports neither placeOrder nor request`);
      }
    }
    this.bitgetClient = bitgetClient;
  }

  async dispatch(
    receipt: SealedReasoningReceipt,
    params: { symbol: string; side: "BUY" | "SELL"; quantity: number; fillPriceUsd: number },
  ): Promise<ExecutionRecord> {
    const decision = (receipt as unknown as { decision?: string }).decision ??
      (receipt as unknown as { payload?: { decision?: string } }).payload?.decision;
    if (decision !== "APPROVED") {
      throw new Error("Cannot dispatch unapproved receipt");
    }
    const t0 = performance.now();
    if (this.mode === "PAPER") {
      const feeUsd = round2(params.quantity * params.fillPriceUsd * PAPER_TAKER_FEE);
      const orderId =
        "bg-paper-" +
        createHash("sha256")
          .update(receipt.receiptHash + Date.now().toString())
          .digest("hex")
          .slice(0, 16);
      const latencyMs = performance.now() - t0;
      return {
        orderId,
        clientOid: orderId,
        symbol: params.symbol,
        side: params.side,
        mode: this.mode,
        quantity: round4(params.quantity),
        fillPriceUsd: params.fillPriceUsd,
        feeUsd,
        status: "FILLED",
        receiptHash: receipt.receiptHash,
        executedAt: new Date().toISOString(),
        latencyMs,
      };
    }
    // TESTNET | DEMO | LIVE — real signed venue dispatch.
    if (!this.bitgetClient) {
      throw new Error(`Cannot dispatch in ${this.mode} mode without bitgetClient`);
    }

    const mappedSymbol = mapToVenueSymbol(params.symbol);
    const clientOid = receipt.receiptHash.slice(0, 32);
    const mixBody = {
      symbol: mappedSymbol,
      productType: "USDT-FUTURES",
      marginMode: "isolated",
      marginCoin: "USDT",
      size: params.quantity.toString(),
      side: params.side.toLowerCase(),
      orderType: "market",
      clientOid,
    };

    // Preferred path: signed generic request (HMAC-SHA256 inside BitgetClient.request).
    if (typeof this.bitgetClient.request === "function") {
      let res: { code: string; msg?: string; data?: unknown; raw?: unknown };
      try {
        res = await this.bitgetClient.request("POST", DEMO_MIX_ORDER_PATH, {}, true, mixBody);
      } catch (err) {
        const latencyMs = performance.now() - t0;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[dispatcher:${this.mode}] Bitget order REJECTED ${mappedSymbol}: ${msg}`);
        return {
          orderId: `bg-${this.mode.toLowerCase()}-rejected-${createHash("sha256")
            .update(receipt.receiptHash + Date.now().toString())
            .digest("hex")
            .slice(0, 12)}`,
          clientOid,
          symbol: params.symbol,
          side: params.side,
          mode: this.mode,
          quantity: round4(params.quantity),
          fillPriceUsd: params.fillPriceUsd,
          feeUsd: 0,
          status: "REJECTED",
          error: msg,
          venueResponse: { path: DEMO_MIX_ORDER_PATH, body: mixBody },
          receiptHash: receipt.receiptHash,
          executedAt: new Date().toISOString(),
          latencyMs,
        };
      }
      const latencyMs = performance.now() - t0;
      // Bitget v2: code "0" (or "00000" on some routes) = success.
      const code = String(res.code ?? "");
      const ok = code === "0" || code === "00000" || code === "200";
      const data = res.data as Record<string, unknown> | undefined;
      const nested = (data?.["data"] ?? data) as Record<string, unknown> | undefined;
      const orderId =
        (typeof data?.["orderId"] === "string" && (data["orderId"] as string)) ||
        (typeof nested?.["orderId"] === "string" && (nested["orderId"] as string)) ||
        (typeof data?.["order_id"] === "string" && (data["order_id"] as string)) ||
        "";
      if (!ok || !orderId) {
        const msg = `Bitget venue rejected order (code=${code} msg=${res.msg ?? "n/a"} data=${JSON.stringify(res.data ?? res.raw)})`;
        console.error(`[dispatcher:${this.mode}] ${msg}`);
        return {
          orderId: orderId || `bg-${this.mode.toLowerCase()}-rejected-${clientOid.slice(0, 12)}`,
          clientOid:
            (typeof data?.["clientOid"] === "string" && (data["clientOid"] as string)) || clientOid,
          symbol: params.symbol,
          side: params.side,
          mode: this.mode,
          quantity: round4(params.quantity),
          fillPriceUsd: params.fillPriceUsd,
          feeUsd: 0,
          status: "REJECTED",
          error: msg,
          venueResponse: res.raw ?? res,
          receiptHash: receipt.receiptHash,
          executedAt: new Date().toISOString(),
          latencyMs,
        };
      }
      const feeRaw = data?.["fee"] ?? nested?.["fee"] ?? data?.["feeUsd"] ?? nested?.["feeUsd"];
      const feeUsd =
        typeof feeRaw === "number" && Number.isFinite(feeRaw)
          ? feeRaw
          : typeof feeRaw === "string" && Number.isFinite(Number(feeRaw))
            ? Number(feeRaw)
            : round2(params.quantity * params.fillPriceUsd * PAPER_TAKER_FEE);
      const fillRaw = data?.["fillPrice"] ?? nested?.["fillPrice"] ?? data?.["price"] ?? nested?.["price"];
      const fillPriceUsd =
        typeof fillRaw === "number" && Number.isFinite(fillRaw) && fillRaw > 0
          ? fillRaw
          : typeof fillRaw === "string" && Number.isFinite(Number(fillRaw)) && Number(fillRaw) > 0
            ? Number(fillRaw)
            : params.fillPriceUsd;
      return {
        orderId,
        clientOid: (typeof data?.["clientOid"] === "string" && (data["clientOid"] as string)) || clientOid,
        symbol: params.symbol,
        side: params.side,
        mode: this.mode,
        quantity: round4(params.quantity),
        fillPriceUsd,
        feeUsd,
        status: "FILLED",
        venueResponse: res.raw ?? res,
        receiptHash: receipt.receiptHash,
        executedAt: new Date().toISOString(),
        latencyMs,
      };
    }

    // Legacy placeOrder path (agentic sub-account wrapper).
    if (typeof this.bitgetClient.placeOrder === "function") {
      try {
        const out = await this.bitgetClient.placeOrder({
          symbol: mappedSymbol,
          side: params.side,
          quantity: params.quantity,
          priceUsd: params.fillPriceUsd,
        });
        const latencyMs = performance.now() - t0;
        if (!out?.orderId) {
          const msg = `Bitget venue rejected order (empty orderId: ${JSON.stringify(out)})`;
          console.error(`[dispatcher:${this.mode}] ${msg}`);
          return {
            orderId: `bg-${this.mode.toLowerCase()}-rejected-${clientOid.slice(0, 12)}`,
            clientOid: out?.clientOid ?? clientOid,
            symbol: params.symbol,
            side: params.side,
            mode: this.mode,
            quantity: round4(params.quantity),
            fillPriceUsd: params.fillPriceUsd,
            feeUsd: 0,
            status: "REJECTED",
            error: msg,
            receiptHash: receipt.receiptHash,
            executedAt: new Date().toISOString(),
            latencyMs,
          };
        }
        const latencyMs2 = performance.now() - t0;
        return {
          orderId: out.orderId,
          clientOid: out.clientOid ?? clientOid,
          symbol: params.symbol,
          side: params.side,
          mode: this.mode,
          quantity: round4(params.quantity),
          fillPriceUsd: out.fillPriceUsd ?? params.fillPriceUsd,
          feeUsd: out.feeUsd ?? round2(params.quantity * params.fillPriceUsd * PAPER_TAKER_FEE),
          status: "FILLED",
          receiptHash: receipt.receiptHash,
          executedAt: new Date().toISOString(),
          latencyMs: latencyMs2,
        };
      } catch (err) {
        const latencyMs = performance.now() - t0;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[dispatcher:${this.mode}] Bitget order REJECTED ${mappedSymbol}: ${msg}`);
        return {
          orderId: `bg-${this.mode.toLowerCase()}-rejected-${clientOid.slice(0, 12)}`,
          clientOid,
          symbol: params.symbol,
          side: params.side,
          mode: this.mode,
          quantity: round4(params.quantity),
          fillPriceUsd: params.fillPriceUsd,
          feeUsd: 0,
          status: "REJECTED",
          error: msg,
          receiptHash: receipt.receiptHash,
          executedAt: new Date().toISOString(),
          latencyMs,
        };
      }
    }
    throw new Error(`bitgetClient supports neither placeOrder nor request`);
  }
}
