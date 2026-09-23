import { createHash } from "node:crypto";
import type { SealedReasoningReceipt } from "../council/receipts.js";

export type DispatcherMode = "PAPER" | "TESTNET" | "LIVE";

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
}

export interface BitgetOrderClient {
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
  ) => Promise<{ code: string; data?: unknown; raw?: unknown }>;
}

export const PAPER_TAKER_FEE = 0.0006;

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * OrderDispatcher — event -> decision -> execution bridge.
 * PAPER mode is pure/deterministic (no network, no keys).
 * TESTNET/LIVE delegate to the signed Bitget client (agentic sub-account).
 */
export class OrderDispatcher {
  readonly mode: DispatcherMode;
  private readonly bitgetClient?: BitgetOrderClient;

  constructor(mode: DispatcherMode = "PAPER", bitgetClient?: BitgetOrderClient) {
    this.mode = mode;
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
    // TESTNET | LIVE — signed venue dispatch via agentic sub-account.
    if (!this.bitgetClient) {
      throw new Error(`Cannot dispatch in ${this.mode} mode without bitgetClient`);
    }
    if (typeof this.bitgetClient.placeOrder === "function") {
      const res = await this.bitgetClient.placeOrder({
        symbol: params.symbol,
        side: params.side,
        quantity: params.quantity,
        priceUsd: params.fillPriceUsd,
      });
      const latencyMs = performance.now() - t0;
      return {
        orderId: res.orderId,
        clientOid: res.clientOid ?? res.orderId,
        symbol: params.symbol,
        side: params.side,
        mode: this.mode,
        quantity: round4(params.quantity),
        fillPriceUsd: res.fillPriceUsd ?? params.fillPriceUsd,
        feeUsd: res.feeUsd ?? round2(params.quantity * params.fillPriceUsd * PAPER_TAKER_FEE),
        status: "FILLED",
        receiptHash: receipt.receiptHash,
        executedAt: new Date().toISOString(),
        latencyMs,
      };
    }
    if (typeof this.bitgetClient.request === "function") {
      const side = params.side === "BUY" ? "buy" : "sell";
      const body = {
        symbol: params.symbol,
        side,
        orderType: "market",
        size: String(params.quantity),
      };
      const res = await this.bitgetClient.request("POST", "/api/v2/spot/trade/place-order", {}, true, body);
      const latencyMs = performance.now() - t0;
      const data = res.data as Record<string, unknown> | undefined;
      const orderId =
        typeof data?.["orderId"] === "string"
          ? (data["orderId"] as string)
          : `bg-${this.mode.toLowerCase()}-${createHash("sha256")
              .update(receipt.receiptHash + Date.now().toString())
              .digest("hex")
              .slice(0, 16)}`;
      return {
        orderId,
        clientOid: typeof data?.["clientOid"] === "string" ? (data["clientOid"] as string) : orderId,
        symbol: params.symbol,
        side: params.side,
        mode: this.mode,
        quantity: round4(params.quantity),
        fillPriceUsd: params.fillPriceUsd,
        feeUsd: round2(params.quantity * params.fillPriceUsd * PAPER_TAKER_FEE),
        status: "FILLED",
        receiptHash: receipt.receiptHash,
        executedAt: new Date().toISOString(),
        latencyMs,
      };
    }
    throw new Error(`bitgetClient supports neither placeOrder nor request`);
  }
}
