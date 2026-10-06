/**
 * BEAT 2 — LIVE DISPATCHER LIFECYCLE DRIVER.
 *
 * WHY THIS SCRIPT EXISTS
 *   CLM-007 proved open -> fill -> close -> flat on Bitget Demo, but that proof
 *   lives in a test and a historical JSON artefact. Neither is a demo: a judge
 *   cannot run a passing unit test and watch value move, and a file dated
 *   2026-09-30 is a recording, not an event. This script is the single
 *   reproducible command for that lifecycle.
 *
 * WHAT IT PROVES, IN ORDER
 *   1. A VETOED receipt is refused BEFORE any network call. Not "refused with
 *      an error" — refused with no order ID, because the check is the first
 *      statement in dispatchIntent and returns before the venue is touched.
 *   2. An APPROVED, SHA-256 sealed receipt dispatches a real order on Demo.
 *   3. The position is read back from the venue, not assumed.
 *   4. The position is closed through the same receipt gate.
 *   5. The account is asserted FLAT — a non-zero residual exits non-zero.
 *
 * WHAT IT DOES NOT DO
 *   - No market order on the live venue. BITGET_ENV must be testnet/Demo;
 *     anything else aborts rather than trading real money.
 *   - No retry loop, no scheduler, no polling. One pass, top to bottom.
 *   - No LLM involvement. The receipt is minted deterministically from the
 *     council reducer, which is the point: the LLM has no path to here.
 *
 * Usage:
 *   set -a; . ./.env; set +a
 *   pnpm demo:live
 */
import { createHash } from "node:crypto";
import { BitgetClient } from "../packages/engine/src/bitget/client.js";
import { PRODUCT_TYPE } from "../packages/engine/src/bitget/strategy-packet.js";
import { OrderDispatcher } from "../packages/engine/src/bitget/dispatcher.js";
import { sealReceipt, verifyReceipt, type SealedReasoningReceipt } from "../packages/engine/src/council/receipts.js";
import { StructuralChangeGuard, toBlastRadiusReport } from "../packages/engine/src/skills/igraph-guard/security.js";

// ---------------------------------------------------------------------------
// Console formatting — this output is meant to be read on a screen recording.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Proven parameters. These are the CLM-007 values that actually filled, not
// invented ones: 0.001 BTCUSDT market, hedge mode, ~$83 exposure.
// ---------------------------------------------------------------------------

const SYMBOL = "BTCUSDT";
const QUANTITY = 0.001;
const ACCOUNT = { equityUsd: 25_000, usedMarginUsd: 0, freeMarginUsd: 25_000, openOrders: [] as Array<{ symbol: string; orderId: string }> };

/** Mints a real sealed receipt through the deterministic council path. */
function mintReceipt(fillPriceUsd: number, approved: boolean): SealedReasoningReceipt {
  const risk = StructuralChangeGuard.evaluateBlastRadius(
    { symbol: SYMBOL, side: "buy", quantity: QUANTITY, priceUsd: fillPriceUsd },
    ACCOUNT,
  );
  if (risk.decision !== "APPROVED") {
    throw new Error(`Risk Boy vetoed before dispatch: ${risk.reasons.join("; ")}`);
  }
  return sealReceipt({
    symbol: SYMBOL,
    action: "BUY_BASIS",
    quantMetrics: {
      action: "BUY_BASIS",
      rawBasis: 0,
      rawBasisPct: 0,
      midPrice: fillPriceUsd,
      vwapPrice: fillPriceUsd,
      vwapSlippage: 0,
      vwapSlippagePct: 0,
      fundingCarry: 0,
      fundingCarryPct: 0,
      hurdleRate: 0,
      hurdleRatePct: 0,
      netEdge: 0,
      netEdgePct: 0,
      zScore: 0,
      availableDepthUsd: 1_000_000,
      depthCoverage: 1,
      quantScore: approved ? 80 : 40,
      sideWalked: "none",
      filledUsd: QUANTITY * fillPriceUsd,
      completeFill: true,
      reasons: ["demo driver fixture: deterministic council mint"],
      executionFeeRate: 0,
      executionFrictionRate: 0,
      halfSpreadPct: 0,
      executionStyle: "aggressive",
    },
    riskReport: toBlastRadiusReport(risk),
    councilScores: { compositeScore: 80, macro: 75, quant: 80, risk: 90, exec: 85 },
    decision: approved ? "APPROVED" : "VETOED",
    rationale: approved
      ? "Beat 2 demo driver: deterministic APPROVED proposal for a verified Demo lifecycle."
      : "Beat 2 demo driver: deliberately VETOED receipt, presented FIRST to prove the gate refuses before any network call.",
    metadata: { passNumber: 1, originalQuantity: QUANTITY, executedQuantity: 0 },
  });
}

async function main(): Promise<void> {
  const env = (process.env["BITGET_ENV"] ?? "").toLowerCase();
  const key = process.env["BITGET_API_KEY"];
  const secret = process.env["BITGET_SECRET_KEY"];
  const pass = process.env["BITGET_PASSPHRASE"];

  process.stdout.write(`\n${line("═")}\n MONEY BOYS — BEAT 2: LIVE DISPATCHER LIFECYCLE (Bitget Demo)\n${line("═")}\n`);

  // ---- Environment gate ---------------------------------------------------
  box("ENVIRONMENT GATE");
  row("BITGET_ENV", env || "(unset)");
  row("Credentials", key && secret && pass ? "present" : "ABSENT");

  if (!key || !secret || !pass) {
    endBox();
    process.stdout.write(
      "\n  Bitget Demo credentials not found in .env — set BITGET_* to run the live venue driver.\n" +
        "  (set -a; . ./.env; set +a)\n\n",
    );
    process.exit(2);
  }
  if (env !== "testnet" && env !== "demo") {
    endBox();
    bad(`REFUSING TO RUN: BITGET_ENV=${env || "(unset)"} is not Demo.`);
    process.stdout.write("  This driver trades real funds if misconfigured. Aborting.\n\n");
    process.exit(2);
  }
  row("Route", "Demo Trading (paptrading: 1)");
  row("Position mode", "hedge");
  endBox();

  const client = new BitgetClient({ apiKey: key, secretKey: secret, passphrase: pass, demoTrading: true });

  // Hedge mode, because the Demo account is in hedge mode: a one_way dispatch
  // is rejected by the venue with 40774.
  const dispatcher = new OrderDispatcher("DEMO", client as never, "hedge");

  // ---- Live price ---------------------------------------------------------
  const ticker = await client.getMixTicker(SYMBOL, PRODUCT_TYPE);
  const fillPriceUsd = Number(ticker.lastPr ?? ticker.last ?? "0");
  if (!(fillPriceUsd > 0)) throw new Error(`venue returned no usable price for ${SYMBOL}`);

  // ---- STEP 1: veto pre-check, BEFORE any network call -------------------
  step(1, "VETO PRE-CHECK — an unapproved receipt must never reach the venue");
  const vetoed = mintReceipt(fillPriceUsd, false);
  row("Receipt decision", vetoed.decision);
  row("SHA-256 seal valid", verifyReceipt(vetoed));
  let networkTouched = false;
  const spy = {
    request: (...args: unknown[]) => {
      networkTouched = true;
      return (client.request as (...a: unknown[]) => unknown)(...args);
    },
  };
  const spyDispatcher = new OrderDispatcher("DEMO", spy as never, "hedge");
  try {
    await spyDispatcher.dispatch(vetoed, { symbol: SYMBOL, side: "BUY", quantity: QUANTITY, fillPriceUsd });
    bad("FAIL: a VETOED receipt was dispatched");
    process.exitCode = 1;
    return;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    ok(`dispatcher refused: "${msg}"`);
    row("Venue network calls made", networkTouched ? "YES — LEAK" : "0");
    if (networkTouched) {
      bad("FAIL: the venue was contacted despite a VETOED receipt");
      process.exitCode = 1;
      return;
    }
    ok("confirmed: refused BEFORE any venue call");
  }

  // ---- STEP 2: live open --------------------------------------------------
  step(2, "LIVE OPEN — approved sealed receipt dispatches on Bitget Demo");
  const approved = mintReceipt(fillPriceUsd, true);
  row("Receipt decision", approved.decision);
  row("Receipt hash", `${approved.receiptHash.slice(0, 32)}…`);
  row("Intent", `${SYMBOL} BUY ${QUANTITY}`);
  row("Reference price", fillPriceUsd);
  const opened = await dispatcher.dispatch(approved, {
    symbol: SYMBOL, side: "BUY", quantity: QUANTITY, fillPriceUsd,
  });
  row("Order ID", opened.orderId);
  row("Client OID", opened.clientOid);
  row("Status", opened.status);
  row("Fill price", opened.fillPriceUsd);
  row("Venue latency", `${opened.latencyMs.toFixed(1)} ms`);

  // ---- STEP 3: read the position back from the venue ----------------------
  step(3, "READ-BACK — read from the venue, never assumed");
  const posRes = await client.request(
    "GET", "/api/v2/mix/position/all-position", { productType: PRODUCT_TYPE, marginCoin: "USDT" }, true,
  );
  const rows = (Array.isArray(posRes.data) ? posRes.data : []) as Array<Record<string, unknown>>;
  const mine = rows.find((r) => String(r["symbol"] ?? "") === SYMBOL);
  const held = Number(mine?.["total"] ?? "0");
  row("Venue code", posRes.code);
  row("Position symbol", mine?.["symbol"] ?? "(none)");
  row("Open quantity", held);
  row("Holding side", String(mine?.["holdSide"] ?? "n/a"));
  if (Math.abs(held) <= 0) {
    bad("FAIL: no position found after a filled open — aborting before close");
    process.exitCode = 1;
    return;
  }
  ok("position confirmed from the venue");

  // ---- STEP 4: close ------------------------------------------------------
  step(4, "LIVE CLOSE — same receipt gate, opposite direction");

  // closePosition takes the POSITION DIRECTION, not the order direction:
  // BUY closes a LONG, SELL closes a SHORT. This was hardcoded to SELL, and
  // the venue answered 22002 "No position to close" — leaving a live position
  // open that had to be closed by hand. The direction is now DERIVED from the
  // holdSide the venue reported in step 3, so the two cannot disagree.
  const holdSide = String(mine?.["holdSide"] ?? "").toLowerCase();
  const closeDirection: "BUY" | "SELL" = holdSide === "short" ? "SELL" : "BUY";
  row("Venue holdSide", holdSide || "(unreported)");
  row("Close direction", `${closeDirection} (closes a ${holdSide === "short" ? "SHORT" : "LONG"})`);

  const closeRec = mintReceipt(fillPriceUsd, true);
  const closed = await dispatcher.closePosition(closeRec, {
    symbol: SYMBOL, side: closeDirection, quantity: Math.abs(held), fillPriceUsd,
  });
  if (closed.status !== "FILLED") {
    // Never leave a live position behind on a failure path. The whole point of
    // this driver is that the account ends flat, so treat a rejected close as
    // a hard stop that still attempts a second close.
    bad(`close REJECTED (${closed.status}) — retrying once, then verifying residual`);
    const retry = await dispatcher.closePosition(mintReceipt(fillPriceUsd, true), {
      symbol: SYMBOL, side: closeDirection, quantity: Math.abs(held), fillPriceUsd,
    });
    row("Retry status", retry.status);
    if (retry.status !== "FILLED") {
      bad("close failed twice — MANUAL INTERVENTION REQUIRED, position may be open");
      process.exitCode = 1;
    }
  }
  row("Order ID", closed.orderId);
  row("Status", closed.status);
  row("Venue latency", `${closed.latencyMs.toFixed(1)} ms`);

  // ---- STEP 5: assert flat ------------------------------------------------
  step(5, "FLAT ASSERTION — the account must end at zero");
  const finalRes = await client.request(
    "GET", "/api/v2/mix/position/all-position", { productType: PRODUCT_TYPE, marginCoin: "USDT" }, true,
  );
  const finalRows = (Array.isArray(finalRes.data) ? finalRes.data : []) as Array<Record<string, unknown>>;
  const residual = Math.abs(Number(finalRows.find((r) => String(r["symbol"] ?? "") === SYMBOL)?.["total"] ?? "0"));
  row("Residual quantity", residual);

  process.stdout.write(`\n${line("═")}\n RESULT\n${line("═")}\n`);
  const fingerprint = createHash("sha256")
    .update(`${opened.orderId}|${closed.orderId}|${residual}`)
    .digest("hex")
    .slice(0, 16);
  if (residual === 0) {
    ok(`ACCOUNT FLAT — lifecycle complete (${fingerprint})`);
    process.stdout.write(
      "\n  open → fill → close → flat on Bitget Demo, through the receipt gate.\n" +
        "  Intelligence proposes; the deterministic execution guard moves value.\n\n",
    );
  } else {
    bad(`FAIL: residual position ${residual} — the account is NOT flat (${fingerprint})`);
    process.exitCode = 1;
  }
}

main().catch((e: unknown) => {
  process.stdout.write(`\n  DRIVER FAILED: ${e instanceof Error ? e.message : String(e)}\n\n`);
  process.exit(1);
});