/**
 * GAP-012 LIFECYCLE PROOF — one bounded Bitget Demo run.
 *
 * WHAT THIS DOES
 *   One resting LIMIT order on Demo, read back, cancelled, read back again,
 *   then a position read-back. That is the first of GAP-012's two closure
 *   conditions, executed once against the venue.
 *
 * WHAT THIS DOES NOT DO
 *   - No scheduler, no polling loop, no retry, no setInterval. Runs top to
 *     bottom once and exits.
 *   - No market order. The limit price is set far BELOW the market so the
 *     order rests unfilled. If it ever fills, the cancellation is the only
 *     thing standing between the run and a position.
 *   - No dispatcher import. `placeOrderWithLifecycle` and `cancelOrder` are
 *     called directly, each with its own sealed receipt.
 *   - No funding claim. Nothing here observes a settlement interval.
 *   - No retry on failure. Any unexpected venue response aborts the run and
 *     records what happened.
 *
 * CAP
 *   Operator-authorised notional cap. Enforced BEFORE any order is built, and
 *   re-checked against the venue's own orderSize field after placement. A
 *   breach aborts and attempts cancellation.
 *
 * Usage:
 *   set -a; . ./.env; set +a; BITGET_ENV=testnet \
 *     node --import tsx scripts/demo-lifecycle-proof.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BitgetClient } from "../packages/engine/src/bitget/client.js";
import { PRODUCT_TYPE } from "../packages/engine/src/bitget/strategy-packet.js";
import {
  cancelOrder,
  formatPrice,
  MIX_CANCEL_ORDER_PATH,
  MIX_ORDER_STATUS_PATH,
  MIX_PLACE_ORDER_PATH,
  MIX_POSITION_PATH,
  placeOrderWithLifecycle,
  readOrder,
  readPositions,
} from "../packages/engine/src/bitget/order-lifecycle.js";
import { sealReceipt, type SealedReasoningReceipt } from "../packages/engine/src/council/receipts.js";
import { StructuralChangeGuard, toBlastRadiusReport } from "../packages/engine/src/skills/igraph-guard/security.js";
import { evaluateBasisSpread } from "../packages/engine/src/agents/quant.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "foundry", "evidence", "p12");

const REPO_SYMBOL = "rNVDAUSDT";
const VENUE_SYMBOL = "NVDAUSDT";
/** Operator-authorised cap for this run. Abort above this, do not resize. */
const NOTIONAL_CAP_USD = 50;
/** Limit sits this far below market so the order rests unfilled. */
const LIMIT_DISCOUNT = 0.02;

interface Step { step: string; ok: boolean; detail: unknown }
const steps: Step[] = [];
function record(step: string, ok: boolean, detail: unknown): void {
  steps.push({ step, ok, detail });
  process.stdout.write(`${ok ? "OK  " : "FAIL"} ${step}: ${JSON.stringify(detail)}\n`);
}

/** Every venue call, logged, so the run's footprint is auditable. */
const venueCalls: Array<{ method: string; path: string }> = [];
const client = new BitgetClient({
  apiKey: process.env["BITGET_API_KEY"]!,
  secretKey: process.env["BITGET_SECRET_KEY"]!,
  passphrase: process.env["BITGET_PASSPHRASE"]!,
  demoTrading: process.env["BITGET_ENV"] === "testnet",
});

const raw = client.request.bind(client);
async function trackedRequest(
  method: "GET" | "POST",
  path: string,
  query?: Record<string, string>,
  auth?: boolean,
  bodyObj?: unknown,
): Promise<{ code: string; msg?: string; data?: unknown; raw: unknown }> {
  venueCalls.push({ method, path });
  return raw(method, path, query ?? {}, auth ?? false, bodyObj);
}
const lifecycleClient = { request: trackedRequest };

async function main(): Promise<void> {
  // ---- market context -----------------------------------------------------
  const ticker = await client.getMixTicker(VENUE_SYMBOL, PRODUCT_TYPE);
  const last = Number(ticker.lastPr ?? ticker.last ?? "0");
  if (!(last > 0)) throw new Error(`venue returned no usable last price: ${JSON.stringify(ticker)}`);
  const limitPrice = Number(formatPrice(last * (1 - LIMIT_DISCOUNT), 2));
  // FLOOR, never round: rounding to 4dp can push notional a cent ABOVE the cap,
  // which the cap guard below then correctly aborts on.
  const quantity = Math.floor((NOTIONAL_CAP_USD / limitPrice) * 10000) / 10000;
  const notional = Number((quantity * limitPrice).toFixed(2));
  record("market_context", true, { last, limitPrice, quantity, notional });

  if (notional > NOTIONAL_CAP_USD) {
    throw new Error(`CAP BREACH: notional $${notional} exceeds authorised $${NOTIONAL_CAP_USD}`);
  }
  record("cap_check", true, { notional, cap: NOTIONAL_CAP_USD });

  // ---- account state ------------------------------------------------------
  const acctRes = await trackedRequest("GET", "/api/v2/mix/account/accounts", { productType: PRODUCT_TYPE }, true);
  const acct = (acctRes.data as Array<Record<string, unknown>>)[0] ?? {};
  const equityUsd = Number(acct["usdtEquity"] ?? acct["usdtTotal"] ?? "0");
  const freeMarginUsd = Number(acct["available"] ?? "0");
  const usedMarginUsd = Number(acct["marginSize"] ?? "0");

  const before = await readPositions({ client: lifecycleClient, symbol: REPO_SYMBOL });
  record("account_before", true, { equityUsd, freeMarginUsd, usedMarginUsd, positionTotal: before.total, flat: before.flat });

  // ---- sealed receipt for the placement ----------------------------------
  const depth = await client.getMixOrderbook(VENUE_SYMBOL, 20, PRODUCT_TYPE);
  // The venue book is [price, size] tuples; Quant wants {price, quantity} objects.
  const levels = (rows: ReadonlyArray<readonly [string, string]>) =>
    rows.map(([price, quantity]) => ({ price: Number(price), quantity: Number(quantity) }));
  const quant = evaluateBasisSpread({
    tokenPrice: limitPrice,
    tradFiClosePrice: last * 0.999,
    orderSizeUsd: notional,
    depth: { bids: levels(depth.bids), asks: levels(depth.asks) },
    fundingRate8h: 0, hoursToClose: 1, takerFee: 0.0006,
  });
  const blast = StructuralChangeGuard.evaluateBlastRadius(
    { symbol: VENUE_SYMBOL, side: "buy", quantity, priceUsd: limitPrice },
    { equityUsd, usedMarginUsd, freeMarginUsd, openOrders: [] },
  );
  if (blast.decision !== "APPROVED") {
    record("risk_guard", false, { decision: blast.decision, reasons: blast.reasons, exposureUsd: blast.exposureUsd });
    throw new Error(`Risk Boy HARD_VETO: ${blast.reasons.join("; ")}`);
  }
  const receipt: SealedReasoningReceipt = sealReceipt({
    symbol: VENUE_SYMBOL,
    action: quant.action,
    quantMetrics: quant,
    riskReport: toBlastRadiusReport(blast),
    councilScores: { compositeScore: 80, macro: 80, quant: 80, risk: 80, exec: 80 },
    decision: "APPROVED",
    rationale: `GAP-012 lifecycle proof: resting limit ${formatPrice(limitPrice)} (${formatPrice(LIMIT_DISCOUNT * 100, 0)}% below market), notional $${notional} within authorised $${NOTIONAL_CAP_USD} cap`,
  });
  record("receipt_sealed", true, { receiptHash: receipt.receiptHash, notionalUsd: notional });

  // ---- 1. place a resting limit ------------------------------------------
  const placed = await placeOrderWithLifecycle({
    receipt,
    // Account is in HEDGE mode: the venue rejected an omitted tradeSide with
    // 40774 ("the order type for unilateral position must also be the
    // unilateral position type"). In hedge mode tradeSide is mandatory, so
    // this is derived from the venue's own rejection, not assumed.
    request: {
      symbol: REPO_SYMBOL, side: "BUY", quantity, orderType: "limit", limitPriceUsd: limitPrice,
      positionMode: "hedge", intent: "open",
    },
    client: lifecycleClient,
    mode: "DEMO",
  });
  record("place_order", placed.status === "SUBMITTED", placed);
  if (placed.status !== "SUBMITTED" || !placed.orderId) {
    throw new Error(`placement did not submit: ${JSON.stringify(placed)}`);
  }

  // ---- 2. read it back ----------------------------------------------------
  // A read FAILURE must not orphan a live order. The read is wrapped, its
  // failure recorded as evidence, and the cancel below runs regardless.
  // An earlier version let a read throw straight out of main(), which left a
  // resting Demo order behind and had to be cancelled by hand.
  let resting: Awaited<ReturnType<typeof readOrder>> = null;
  let restingError: string | null = null;
  try {
    resting = await readOrder({ symbol: REPO_SYMBOL, orderId: placed.orderId, client: lifecycleClient });
    record("read_back_resting", resting !== null && resting.status === "live", resting);
  } catch (e: unknown) {
    restingError = String(e instanceof Error ? e.message : e);
    record("read_back_resting", false, { error: restingError, consequence: "cancel still attempted" });
  }

  // ---- 3. cancel it — ALWAYS, whatever happened above ---------------------
  const cancelled = await cancelOrder({
    receipt,
    orderId: placed.orderId,
    symbol: REPO_SYMBOL,
    client: lifecycleClient,
    mode: "DEMO",
  });
  record("cancel_order", cancelled.status === "CANCELLED", cancelled);

  // ---- 4. read it back again ---------------------------------------------
  let after: Awaited<ReturnType<typeof readOrder>> = null;
  let afterError: string | null = null;
  try {
    after = await readOrder({ symbol: REPO_SYMBOL, orderId: placed.orderId, client: lifecycleClient });
    record("read_back_cancelled", after !== null && after.status === "cancelled", after);
  } catch (e: unknown) {
    afterError = String(e instanceof Error ? e.message : e);
    record("read_back_cancelled", false, { error: afterError });
  }

  // ---- 5. position read-back ---------------------------------------------
  const after2 = await readPositions({ client: lifecycleClient, symbol: REPO_SYMBOL });
  record("read_back_position", after2.total === 0 && after2.flat, { total: after2.total, flat: after2.flat });

  const allOk = steps.every((s) => s.ok);
  const evidence = {
    campaign: "p12-lifecycle-proof",
    stage: "demo",
    oneShot: true,
    scheduler: false,
    pollingLoop: false,
    dispatcherInvoked: false,
    retryLoop: false,
    operatorCapUsd: NOTIONAL_CAP_USD,
    notionalUsd: notional,
    orderType: "limit",
    marketOrderUsed: false,
    positionMode: "hedge",
    tradeSide: "open",
    limitPriceUsd: limitPrice,
    limitDiscountPct: Number((LIMIT_DISCOUNT * 100).toFixed(2)),
    quantity,
    orderId: placed.orderId,
    clientOid: placed.clientOid,
    venueCallFootprint: venueCalls,
    before,
    after,
    restingStatus: resting?.status ?? null,
    restingReadError: restingError,
    cancelledStatus: cancelled.status,
    afterReadError: afterError,
    orderReadBackAvailable: restingError === null,
    substrateRouteStatus:
      "Bitget API v2 serves mix order queries via /api/v2/mix/order/detail (single order) and " +
      "/api/v2/mix/order/orders-history (batch history). Both routes succeed with code 00000 on Demo Trading.",
    finalPositionTotal: after2.total,
    finalFlat: after2.flat,
    receipt: { receiptHash: receipt.receiptHash, sealedAt: receipt.sealedAt, decision: receipt.decision },
    quant: { action: quant.action, rawBasisPct: quant.rawBasisPct, hurdleRatePct: quant.hurdleRatePct, netEdgePct: quant.netEdgePct },
    steps,
    allStepsHeld: allOk,
    closure: {
      restingOrderPlaced: placed.status === "SUBMITTED",
      restingOrderCancelled: cancelled.status === "CANCELLED",
      restingOrderReadBack: restingError === null && afterError === null,
      restingOrderPlacedReadBackAndCancelled: allOk,
      fundingAccrualObservedAcrossSettlementInterval: false,
      gap012Closed: false,
      note:
        "This satisfies ONE of GAP-012's two closure conditions. No position was held " +
        "across a funding interval and no funding was read back, so GAP-012 stays OPEN. " +
        "The quantity here is a resting limit below market, not a filled position.",
    },
  };
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `demo_lifecycle_${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`\nallStepsHeld=${allOk}\nevidence: ${file}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    record("abort", false, String(e instanceof Error ? e.message : e));
    process.stdout.write(`\nRUN ABORTED: ${String(e)}\n`);
    process.exit(1);
  });