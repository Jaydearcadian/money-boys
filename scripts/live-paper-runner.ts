/**
 * Live Bitget Demo Trading Daemon (TESTNET mode — REAL signed orders).
 *
 * Loops forever: each tick runs one council deliberation cycle per symbol
 * using fail-closed TradFi benchmarks (BenchmarkFeedUnavailableError ->
 * HARD_VETO, no dispatch) and live Bitget public tickers, seals receipts,
 * transmits APPROVED decisions as REAL signed orders to the Bitget Demo
 * matching engine (POST /api/v2/mix/order/place-order via OrderDispatcher
 * TESTNET), and appends:
 *   - per-tick deliberation JSONL to foundry/evidence/paper-trading/live_paper_daemon.jsonl
 *   - authentic Bitget responses to foundry/evidence/paper-trading/live_bitget_demo_orders.jsonl
 *     (orderId, clientOid, fill details, HTTP status, response times).
 *
 * Run under PM2:
 *   pm2 start "pnpm exec tsx scripts/live-paper-runner.ts" --name money-boys-demo
 *
 * Env (ALL REQUIRED — fail-closed on boot, no simulation):
 *   BITGET_API_KEY, BITGET_SECRET_KEY, BITGET_PASSPHRASE
 *   BITGET_ENV=testnet (routes to Bitget Demo Trading endpoints)
 *   BITGET_BASE_URL (optional override; default https://api.bitget.com)
 *   PAPER_INTERVAL_MS (default 60000), PAPER_EQUITY_USD (default 20000),
 *   PAPER_ORDER_USD (default 2500)
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BitgetClient } from "../packages/engine/src/bitget/client.js";
import { OrderDispatcher } from "../packages/engine/src/bitget/dispatcher.js";
import {
  executeDeliberationCycle,
  FAIL_CLOSED_BENCHMARK_RATIONALE,
} from "../packages/engine/src/council/adapter.js";
import { verifyReceipt } from "../packages/engine/src/council/receipts.js";
import { fetchCatalystProposal, fallbackToNeutral } from "../packages/engine/src/agents/macro.js";
import {
  BenchmarkFeedUnavailableError,
  fetchTradFiBenchmark,
} from "../packages/engine/src/agents/benchmarks.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "foundry/evidence/paper-trading");
const LOG_FILE = join(OUT_DIR, "live_paper_daemon.jsonl");
const DEMO_ORDERS_FILE = join(OUT_DIR, "live_bitget_demo_orders.jsonl");

const SYMBOLS = ["rNVDAUSDT", "rTSLAUSDT", "rAAPLUSDT"] as const;
const INTERVAL_MS = Number(process.env["PAPER_INTERVAL_MS"] ?? 60000);
const START_EQUITY = Number(process.env["PAPER_EQUITY_USD"] ?? 20000);
const ORDER_USD = Number(process.env["PAPER_ORDER_USD"] ?? 2500);

// ---- Fail-closed boot: credentials required, no simulation. ----
const BITGET_API_KEY = process.env["BITGET_API_KEY"] ?? "";
const BITGET_SECRET_KEY = process.env["BITGET_SECRET_KEY"] ?? "";
const BITGET_PASSPHRASE = process.env["BITGET_PASSPHRASE"] ?? "";
const BITGET_ENV = (process.env["BITGET_ENV"] ?? "testnet").toLowerCase();

function requireCred(name: string, value: string): string {
  if (!value || value.trim() === "" || value.startsWith("your-bitget-demo-")) {
    throw new Error(
      `[live-paper-runner] Missing ${name}. Set BITGET_API_KEY, BITGET_SECRET_KEY, BITGET_PASSPHRASE (BITGET_ENV=testnet) — refusing to simulate.`,
    );
  }
  return value;
}

const apiKey = requireCred("BITGET_API_KEY", BITGET_API_KEY);
const secretKey = requireCred("BITGET_SECRET_KEY", BITGET_SECRET_KEY);
const passphrase = requireCred("BITGET_PASSPHRASE", BITGET_PASSPHRASE);
if (BITGET_ENV !== "testnet" && BITGET_ENV !== "demo") {
  console.warn(`[live-paper-runner] BITGET_ENV=${BITGET_ENV} (expected "testnet" for Demo Trading)`);
}
const BITGET_BASE_URL = process.env["BITGET_BASE_URL"] ?? "https://api.bitget.com";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function buildDepth(mid: number) {
  const lvl = 750;
  const bids = Array.from({ length: 10 }, (_, i) => {
    const price = Math.round(mid * (1 - 0.0002 * (i + 1)) * 100) / 100;
    return { price, quantity: Math.round((lvl / price) * 1e4) / 1e4 };
  });
  const asks = Array.from({ length: 10 }, (_, i) => {
    const price = Math.round(mid * (1 + 0.0002 * (i + 1)) * 100) / 100;
    return { price, quantity: Math.round((lvl / price) * 1e4) / 1e4 };
  });
  return { bids, asks };
}

async function resolveTokenPrice(
  client: BitgetClient,
  symbol: string,
): Promise<{ tokenPrice: number; close: number; source: string }> {
  // STRICT FAIL-CLOSED: live benchmark only (allowFallback=false default).
  // Unreachable feed throws BenchmarkFeedUnavailableError -> caller HARD_VETOs.
  const bench = await fetchTradFiBenchmark(symbol);
  const proxy = symbol === "rNVDAUSDT" ? "NVDAUSDT" : symbol === "rTSLAUSDT" ? "TSLAUSDT" : "AAPLUSDT";
  const t = await client.getTicker(proxy);
  const px = parseFloat(t.lastPr);
  if (!Number.isFinite(px) || px <= 0) {
    throw new Error(`Live ticker for ${proxy} returned invalid price: ${t.lastPr}`);
  }
  return { tokenPrice: px, close: bench.closePriceUsd, source: "BITGET_LIVE" };
}

async function tick(
  equity: { usd: number },
  client: BitgetClient,
  dispatcher: OrderDispatcher,
): Promise<void> {
  for (const symbol of SYMBOLS) {
    const ts = new Date().toISOString();
    try {
      let tokenPrice: number;
      let close: number;
      let source: string;
      try {
        ({ tokenPrice, close, source } = await resolveTokenPrice(client, symbol));
      } catch (err) {
        if (err instanceof BenchmarkFeedUnavailableError) {
          const msg = FAIL_CLOSED_BENCHMARK_RATIONALE;
          appendFileSync(
            LOG_FILE,
            JSON.stringify({
              timestamp: ts, daemon: "money-boys-demo", mode: "TESTNET", symbol,
              status: "HARD_VETO", decision: "VETOED", rationale: msg,
              receiptHash: null, verified: false, equityUsd: equity.usd,
            }) + "\n",
          );
          console.error(`[${ts}] ${symbol} HARD_VETO: ${msg}`);
          continue;
        }
        throw err;
      }
      const side: "buy" | "sell" = tokenPrice >= close ? "sell" : "buy";
      const quantity = Math.floor((ORDER_USD / tokenPrice) * 1e4) / 1e4;
      let catalyst = fallbackToNeutral(symbol, "demo daemon heartbeat: no live headline");
      try {
        const headline = `Demo session heartbeat for ${symbol} (${source})`;
        const live = await fetchCatalystProposal(symbol, headline);
        catalyst = live;
      } catch { /* keep neutral fallback */ }
      const account = { equityUsd: equity.usd, usedMarginUsd: 1000, freeMarginUsd: Math.max(0, equity.usd - 1000), openOrders: [] as Array<{ orderId: string; symbol: string }> };
      const depth = buildDepth(tokenPrice);
      const httpStart = Date.now();
      const cycle = (await executeDeliberationCycle(
        catalyst,
        depth,
        account,
        { symbol, side, quantity, priceUsd: tokenPrice, tokenPrice, tradFiClosePrice: close, orderSizeUsd: Math.round(quantity * tokenPrice * 100) / 100, fundingRate8h: 0.0001, hoursToClose: 40, takerFee: 0.0006 },
        dispatcher,
      )) as Awaited<ReturnType<typeof executeDeliberationCycle>>;
      const httpMs = Date.now() - httpStart;
      const verified = verifyReceipt(cycle.receipt);
      appendFileSync(LOG_FILE, JSON.stringify({
        timestamp: ts, daemon: "money-boys-demo", mode: "TESTNET", symbol, side,
        tokenPrice, tradFiClose: close, priceSource: source,
        catalyst: { direction: catalyst.direction, score: catalyst.score, modelId: catalyst.modelId },
        compositeScore: cycle.deliberation.compositeScore, status: cycle.deliberation.status,
        decision: cycle.receipt.decision, passNumber: cycle.passNumber,
        orderId: cycle.executionRecord?.orderId ?? null,
        executionStatus: cycle.executionRecord?.status ?? null,
        receiptHash: cycle.receipt.receiptHash, verified,
        equityUsd: equity.usd,
      }) + "\n");
      // Authentic Bitget Demo response evidence (every APPROVED dispatch).
      if (cycle.executionRecord) {
        const rec = cycle.executionRecord;
        appendFileSync(DEMO_ORDERS_FILE, JSON.stringify({
          timestamp: ts,
          daemon: "money-boys-demo",
          env: BITGET_ENV,
          venue: "bitget-demo",
          endpoint: "POST /api/v2/mix/order/place-order",
          symbol,
          venueSymbol: rec.symbol,
          side,
          quantity: rec.quantity,
          orderId: rec.orderId,
          clientOid: rec.clientOid,
          fillPriceUsd: rec.fillPriceUsd,
          feeUsd: rec.feeUsd,
          status: rec.status,
          error: (rec as { error?: string }).error ?? null,
          receiptHash: rec.receiptHash,
          httpMs,
          dispatchLatencyMs: rec.latencyMs,
          venueResponse: (rec as { venueResponse?: unknown }).venueResponse ?? null,
        }) + "\n");
        console.log(`[${ts}] ${symbol} ${side} px=${tokenPrice} S=${cycle.deliberation.compositeScore} ${cycle.deliberation.status}->${cycle.receipt.decision} order=${rec.orderId} status=${rec.status} httpMs=${httpMs} verified=${verified}`);
      } else {
        console.log(`[${ts}] ${symbol} ${side} px=${tokenPrice} S=${cycle.deliberation.compositeScore} ${cycle.deliberation.status}->${cycle.receipt.decision} (no dispatch) verified=${verified}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendFileSync(LOG_FILE, JSON.stringify({ timestamp: ts, daemon: "money-boys-demo", mode: "TESTNET", symbol, error: msg }) + "\n");
      console.error(`[${ts}] ${symbol} tick error: ${msg}`);
    }
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  // Fail-closed boot: throws immediately when creds are missing (no simulation).
  // Demo Trading = same base URL + same HMAC signing + `paptrading: 1` header
  // (sent by BitgetClient when demoTrading is true). Demo-scoped keys 40099
  // without it. BITGET_ENV=testnet|demo -> demo route; anything else -> live.
  const demoTrading = BITGET_ENV === "testnet" || BITGET_ENV === "demo";
  const client = new BitgetClient({ apiKey, secretKey, passphrase, baseUrl: BITGET_BASE_URL, demoTrading });
  const dispatcher = new OrderDispatcher("TESTNET", client);
  let running = true;
  process.on("SIGTERM", () => { running = false; });
  process.on("SIGINT", () => { running = false; });
  const equity = { usd: START_EQUITY };
  console.log(`[demo-daemon] starting TESTNET loop interval=${INTERVAL_MS}ms equity=${START_EQUITY} env=${BITGET_ENV} base=${BITGET_BASE_URL} log=${LOG_FILE} orders=${DEMO_ORDERS_FILE}`);
  while (running) {
    await tick(equity, client, dispatcher);
    const waited = Date.now();
    void waited;
    await sleep(Math.max(5000, INTERVAL_MS));
  }
  console.log("[demo-daemon] stopped cleanly");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
