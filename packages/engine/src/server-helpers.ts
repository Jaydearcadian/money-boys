/**
 * Phase 05 Batch 2 — part 2a: fixture + HTTP helpers.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { hashCatalystPayload } from "./skills/noema-qa/provenance.js";
import { state } from "./server-state.js";

export function fixture() {
  const tokenPrice = 132.71;
  const tradFiClosePrice = 128.8;
  const quantity = 18.84;
  const orderSizeUsd = Math.round(quantity * tokenPrice * 100) / 100;
  const bids = Array.from({ length: 10 }, (_, i) => ({ price: tokenPrice * (1 - 0.0002 * (i + 1)), quantity: 50 }));
  const asks = Array.from({ length: 10 }, (_, i) => ({ price: tokenPrice * (1 + 0.0002 * (i + 1)), quantity: 50 }));
  const symbol = "rNVDAUSDT";
  const catalyst = {
    symbol, direction: "BULLISH" as const, score: 85, confidence: 0.8,
    catalysts: [{ title: "TSMC CoWoS capacity expansion", detail: "AI hardware catalyst.", sentiment: "BULLISH" as const, confidence: 0.8 }],
    evidenceHash: hashCatalystPayload({ symbol, catalyst: "TSMC CoWoS capacity expansion" }),
    rationale: "Operator simulate-cycle fixture.", modelId: "qwen3.8-max",
  };
  const account = {
    equityUsd: state.account.equityUsd,
    usedMarginUsd: state.account.usedMarginUsd,
    freeMarginUsd: state.account.freeMarginUsd,
    openOrders: [] as { orderId: string; symbol: string }[],
  };
  const params = {
    symbol, side: "buy" as const, quantity, priceUsd: tokenPrice, tokenPrice,
    tradFiClosePrice, orderSizeUsd, fundingRate8h: 0.0001, hoursToClose: 8, takerFee: 0.0006,
  };
  return { catalyst, depth: { bids, asks }, account, params };
}

export function setCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export function json(res: ServerResponse, code: number, body: unknown): void {
  setCors(res);
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => { data += String(c); if (data.length > 1_000_000) req.destroy(); });
    req.on("end", () => resolve(data));
  });
}
