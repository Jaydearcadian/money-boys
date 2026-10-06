/**
 * LIVE RWA (TOKENIZED ASSET) DISPATCHER LIFECYCLE DRIVER.
 *
 * PROVES:
 *   1. VETO PRE-CHECK: Unapproved receipt rejected with ZERO network calls.
 *   2. LIVE OPEN: Real Bitget Demo order for rNVDAUSDT (mapped to NVDAUSDT).
 *   3. POSITION READ-BACK: Reads back position from venue (holdSide=long, size=0.11).
 *   4. LIVE CLOSE: Closes position through receipt-gated closePosition().
 *   5. FLAT ASSERTION: Asserts residual position count is exactly 0.
 *
 * Usage:
 *   set -a; . ./.env; set +a; BITGET_ENV=testnet \
 *     node --import tsx scripts/demo-rwa-lifecycle.ts
 */
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BitgetClient } from "../packages/engine/src/bitget/client.js";
import { PRODUCT_TYPE } from "../packages/engine/src/bitget/strategy-packet.js";
import { OrderDispatcher, mapToVenueSymbol } from "../packages/engine/src/bitget/dispatcher.js";
import { sealReceipt, verifyReceipt, type SealedReasoningReceipt } from "../packages/engine/src/council/receipts.js";
import { StructuralChangeGuard, toBlastRadiusReport } from "../packages/engine/src/skills/igraph-guard/security.js";
import { evaluateBasisSpread } from "../packages/engine/src/agents/quant.js";

const W = 74;
const line = (ch = "─") => ch.repeat(W);
function box(title: string): void {
  process.stdout.write(`\n┌${line()}┐\n│ ${title.padEnd(W - 2)} │\n├${line()}┤\n`);
}
function row(label: string, value: unknown): void {
  process.stdout.write(`│ ${label.padEnd(26)} ${String(value).slice(0, W - 29).padEnd(W - 29)} │\n`);
}
function endBox(): void {
  process.stdout.write(`└${line()}┘\n`);
}
function step(n: number, title: string): void {
  process.stdout.write(`\n${line("═")}\n STEP ${n} — ${title}\n${line("═")}\n`);
}
function ok(msg: string): void {
  process.stdout.write(`  ✓ ${msg}\n`);
}
function bad(msg: string): void {
  process.stdout.write(`  ✗ ${msg}\n`);
}

const SYMBOL = "rNVDAUSDT";
const VENUE_SYMBOL = mapToVenueSymbol(SYMBOL); // NVDAUSDT
const QUANTITY = 0.11; // Compliant with venue minTradeUSDT=5 and minTradeNum=0.01 ($26.45 notional)

function mintReceipt(fillPriceUsd: number, approved: boolean, accountEquity = 9300): SealedReasoningReceipt {
  const quant = evaluateBasisSpread({
    tokenPrice: fillPriceUsd,
    tradFiClosePrice: fillPriceUsd * 0.99,
    orderSizeUsd: QUANTITY * fillPriceUsd,
    depth: {
      bids: [{ price: fillPriceUsd * 0.999, quantity: 100 }],
      asks: [{ price: fillPriceUsd * 1.001, quantity: 100 }],
    },
    fundingRate8h: 0.0001,
    hoursToClose: 4,
    takerFee: 0.0006,
  });

  const risk = StructuralChangeGuard.evaluateBlastRadius(
    { symbol: SYMBOL, side: "buy", quantity: QUANTITY, priceUsd: fillPriceUsd },
    { equityUsd: accountEquity, usedMarginUsd: 0, freeMarginUsd: accountEquity, openOrders: [] },
  );

  return sealReceipt({
    symbol: SYMBOL,
    action: "BUY_BASIS",
    quantMetrics: quant,
    riskReport: toBlastRadiusReport(risk),
    councilScores: { compositeScore: approved ? 85 : 45, macro: approved ? 80 : 40, quant: quant.quantScore, risk: approved ? 90 : 0, exec: 85 },
    decision: approved && risk.decision === "APPROVED" ? "APPROVED" : "VETOED",
    rationale: approved ? "RWA live demo lifecycle test: basis positive and margin safe" : "Veto probe: rejected before venue call",
    metadata: { passNumber: 1, originalQuantity: QUANTITY, executedQuantity: QUANTITY },
  });
}

async function main(): Promise<void> {
  const env = (process.env["BITGET_ENV"] ?? "").toLowerCase();
  if (env !== "testnet" && env !== "demo") {
    bad(`BITGET_ENV must be 'testnet' or 'demo' (observed: '${env}'). Aborting.`);
    process.exit(2);
  }

  const apiKey = process.env["BITGET_API_KEY"];
  const secretKey = process.env["BITGET_SECRET_KEY"];
  const passphrase = process.env["BITGET_PASSPHRASE"];

  if (!apiKey || !secretKey || !passphrase) {
    bad("Missing Bitget credentials. Set BITGET_API_KEY, BITGET_SECRET_KEY, BITGET_PASSPHRASE.");
    process.exit(2);
  }

  box("MONEY BOYS // RWA VENUE LIFECYCLE (rNVDAUSDT)");
  row("Environment", env);
  row("Symbol (Internal)", SYMBOL);
  row("Symbol (Venue Futures)", VENUE_SYMBOL);
  row("Quantity", QUANTITY);
  row("Routing Header", "paptrading: 1");
  endBox();

  const realClient = new BitgetClient({
    apiKey,
    secretKey,
    passphrase,
    demoTrading: true,
  });

  // Fetch real market price
  const ticker = await realClient.getMixTicker(VENUE_SYMBOL, PRODUCT_TYPE);
  const markPrice = Number(ticker.lastPr);
  ok(`Fetched live venue ticker for ${VENUE_SYMBOL}: $${markPrice.toFixed(2)}`);

  // Step 1: VETO PRE-CHECK
  step(1, "VETO PRE-CHECK — ZERO NETWORK CALLS");
  let networkCalls = 0;
  const spyClient = {
    apiKey,
    secretKey,
    passphrase,
    request: async (...args: Parameters<typeof realClient.request>) => {
      networkCalls++;
      return realClient.request(...args);
    },
  };
  const vetoDispatcher = new OrderDispatcher("DEMO", spyClient, "hedge");
  const vetoReceipt = mintReceipt(markPrice, false);

  let vetoBlocked = false;
  try {
    await vetoDispatcher.dispatch(vetoReceipt, {
      symbol: SYMBOL,
      side: "BUY",
      quantity: QUANTITY,
      fillPriceUsd: markPrice,
    });
  } catch (err) {
    vetoBlocked = true;
    ok(`Dispatcher rejected unapproved receipt: ${(err as Error).message}`);
  }

  if (!vetoBlocked || networkCalls !== 0) {
    bad(`Veto pre-check failed: blocked=${vetoBlocked}, calls=${networkCalls}`);
    process.exit(1);
  }
  ok(`Network calls during veto: ${networkCalls} (expected: 0)`);

  // Step 2: LIVE OPEN
  step(2, `LIVE OPEN — ${VENUE_SYMBOL} ${QUANTITY}`);
  const approvedReceipt = mintReceipt(markPrice, true);
  ok(`ReasoningReceipt sealed: ${approvedReceipt.receiptHash.slice(0, 16)}...`);
  const receiptVerified = verifyReceipt(approvedReceipt);
  if (!receiptVerified) {
    bad("Receipt verification failed before dispatch!");
    process.exit(1);
  }
  ok("Receipt untampered and verified (SHA-256 canonical JSON)");

  const liveDispatcher = new OrderDispatcher("DEMO", realClient, "hedge");
  const openRec = await liveDispatcher.dispatch(approvedReceipt, {
    symbol: SYMBOL,
    side: "BUY",
    quantity: QUANTITY,
    fillPriceUsd: markPrice,
  });

  if (openRec.status !== "FILLED") {
    bad(`Live open failed: ${openRec.error ?? "Unknown error"}`);
    process.exit(1);
  }
  ok(`Order placed and FILLED on Bitget Demo: ${openRec.orderId} (${openRec.latencyMs.toFixed(1)}ms)`);

  // Step 3: POSITION READ-BACK
  step(3, "POSITION READ-BACK FROM VENUE");
  const posRes = await realClient.request(
    "GET",
    "/api/v2/mix/position/all-position",
    { productType: PRODUCT_TYPE, marginCoin: "USDT" },
    true,
  );
  const positions = Array.isArray(posRes.data) ? posRes.data : [];
  const openPos = positions.find((p: Record<string, unknown>) => p["symbol"] === VENUE_SYMBOL) as Record<string, unknown> | undefined;

  if (!openPos) {
    bad(`Position not found on venue read-back!`);
    process.exit(1);
  }
  const holdSide = String(openPos["holdSide"] ?? "long").toLowerCase();
  const total = Number(openPos["total"] ?? openPos["available"] ?? 0);
  ok(`Venue confirmed position: ${VENUE_SYMBOL} size=${total} holdSide=${holdSide}`);

  // Step 4: LIVE CLOSE
  step(4, `LIVE CLOSE — REDUCE TO FLAT`);
  const closeRec = await liveDispatcher.closePosition(approvedReceipt, {
    symbol: SYMBOL,
    side: holdSide === "short" ? "SELL" : "BUY", // In hedge mode, BUY closes long
    quantity: total > 0 ? total : QUANTITY,
    fillPriceUsd: markPrice,
  });

  if (closeRec.status !== "FILLED") {
    bad(`Close order rejected: ${closeRec.error ?? "Unknown error"}`);
    process.exit(1);
  }
  ok(`Close order FILLED on Bitget Demo: ${closeRec.orderId} (${closeRec.latencyMs.toFixed(1)}ms)`);

  // Step 5: FLAT ASSERTION
  step(5, "ASSERT ACCOUNT IS 100% FLAT");
  const flatRes = await realClient.request(
    "GET",
    "/api/v2/mix/position/all-position",
    { productType: PRODUCT_TYPE, marginCoin: "USDT" },
    true,
  );
  const remaining = (Array.isArray(flatRes.data) ? flatRes.data : []).filter(
    (p: Record<string, unknown>) => p["symbol"] === VENUE_SYMBOL,
  );

  if (remaining.length > 0) {
    bad(`Account NOT flat! Residual position(s): ${JSON.stringify(remaining)}`);
    process.exit(1);
  }
  ok("Zero residual positions. ACCOUNT IS 100% FLAT.");

  // Save evidence artifact
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = join(here, "..", "foundry", "evidence", "p13");
  mkdirSync(outDir, { recursive: true });

  const evidence = {
    test: "RWA_TOKEN_VENUE_LIFECYCLE",
    symbol: SYMBOL,
    venueSymbol: VENUE_SYMBOL,
    executedAt: new Date().toISOString(),
    environment: env,
    vetoCheck: {
      blocked: vetoBlocked,
      networkCalls,
    },
    openOrder: {
      orderId: openRec.orderId,
      status: openRec.status,
      quantity: openRec.quantity,
      fillPriceUsd: openRec.fillPriceUsd,
      latencyMs: openRec.latencyMs,
      receiptHash: approvedReceipt.receiptHash,
    },
    positionReadBack: {
      symbol: VENUE_SYMBOL,
      size: total,
      holdSide,
    },
    closeOrder: {
      orderId: closeRec.orderId,
      status: closeRec.status,
      quantity: closeRec.quantity,
      latencyMs: closeRec.latencyMs,
    },
    accountFlat: remaining.length === 0,
    proofDigest: createHash("sha256")
      .update(`${openRec.orderId}:${closeRec.orderId}:${approvedReceipt.receiptHash}`)
      .digest("hex"),
  };

  const evidencePath = join(outDir, "rwa_trade_lifecycle.json");
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  ok(`Evidence written to ${evidencePath}`);

  box("RWA VENUE LIFECYCLE: DEMONSTRATED & PROVEN");
  row("Open Order", openRec.orderId);
  row("Close Order", closeRec.orderId);
  row("Proof Digest", evidence.proofDigest.slice(0, 24) + "...");
  row("Account Status", "100% FLAT");
  endBox();
}

main().catch((err) => {
  bad(`Execution error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
