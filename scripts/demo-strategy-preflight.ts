/**
 * Bounded Demo strategy pre-flight (Stage 3).
 *
 * Builds the exact pre-write packet for a single bounded Demo campaign and
 * STOPS. It submits nothing. There is deliberately no call to
 * OrderDispatcher.dispatch or closePosition in this file.
 *
 * Two gates must both pass before a packet is marked executable:
 *   1. positive net edge (Quant Boy must not return NEUTRAL)
 *   2. venue-compliant sizing (multiplier, minQty AND minNotional together)
 *
 * Sizes via BitgetClient.sizeToVenueCompliance rather than a hardcoded
 * quantity. The bare minTradeNum for a tokenized equity is NOT placeable:
 * 0.01 NVDA at $228.56 is $2.29 against a $5 venue minimum (GAP-016).
 *
 * Usage:
 *   set -a; . .env; set +a; BITGET_ENV=testnet \
 *     node --import tsx scripts/demo-strategy-preflight.ts [rNVDAUSDT] [targetUsd]
 *
 * Credentials are read from the process environment only and never printed.
 */
import { BitgetClient, type MixContractConfig } from "../packages/engine/src/bitget/client.js";
import { mapToVenueSymbol } from "../packages/engine/src/bitget/dispatcher.js";
import { evaluateBasisSpread } from "../packages/engine/src/agents/quant.js";
import { buildPacket, sealIntents } from "../packages/engine/src/bitget/strategy-packet.js";
import {
  assessBenchmarkFreshness,
  requiredBenchmarkSourceFor,
  resolveRegime,
  type BenchmarkEvidence,
} from "../packages/engine/src/agents/market-regime.js";

import {
  REPO_SYMBOL,
  VENUE_SYMBOL,
  BENCHMARK_TICKER,
  PRODUCT_TYPE,
} from "../packages/engine/src/bitget/strategy-packet.js";


// ---------------------------------------------------------------------------
// Live pre-flight (network). Only runs when invoked directly.
// ---------------------------------------------------------------------------

/**
 * Fetch a benchmark quote.
 *
 * Returns the price AND the upstream source timestamp. The Bitget
 * equity_price_quote entry publishes NO timestamp field, so `sourceAsOf` is
 * null for it — which makes freshness UNPROVABLE and must fail closed rather
 * than being papered over with the local fetch time (GAP-015/GAP-018).
 */
async function mcpQuote(ticker: string): Promise<{ price: number; sourceAsOf: string | null }> {
  const { execFileSync } = await import("node:child_process");
  const H = ["-H", "Content-Type: application/json", "-H", "Accept: application/json, text/event-stream"];
  execFileSync("curl", ["-sS", "-D", "/tmp/mb-mcp-hdr.txt", "-X", "POST",
    "https://agent.bitget.com/mcp", ...H,
    "-d", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "mb-preflight", version: "0" } } })],
    { encoding: "utf8" });
  const sid = execFileSync("grep", ["-i", "mcp-session-id", "/tmp/mb-mcp-hdr.txt"], { encoding: "utf8" })
    .split("\n")[0]?.trim().split(/\s+/).pop();
  execFileSync("curl", ["-sS", "-X", "POST", "https://agent.bitget.com/mcp", ...H, "-H", `Mcp-Session-Id: ${sid}`,
    "-d", JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })], { encoding: "utf8" });
  const raw = execFileSync("curl", ["-sS", "-X", "POST", "https://agent.bitget.com/mcp", ...H,
    "-H", `Mcp-Session-Id: ${sid}`,
    "-d", JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "do_query", arguments: { entry_id: "equity_price_quote", params: { symbol: ticker } } } })],
    { encoding: "utf8" });
  for (const line of raw.split("\n")) {
    const t = line.startsWith("data:") ? line.slice(5).trim() : "";
    if (!t.startsWith("{")) continue;
    const parsed = JSON.parse(t) as { result?: { content?: { text?: string }[] } };
    const text = parsed.result?.content?.[0]?.text;
    if (!text) continue;
    const body = JSON.parse(text) as {
      data?: { results?: Record<string, unknown>[] };
    };
    const row = body.data?.results?.[0] ?? {};
    const price = row["last_price"];
    if (typeof price !== "number") continue;
    // Look for any upstream timestamp this entry might publish.
    for (const k of ["ts", "timestamp", "as_of", "asOf", "trade_time", "update_time"]) {
      const v = row[k];
      if (typeof v === "string" || typeof v === "number") {
        const ms = typeof v === "number" && v < 1e12 ? v * 1000 : Number(v);
        if (Number.isFinite(ms)) return { price, sourceAsOf: new Date(ms).toISOString() };
      }
    }
    return { price, sourceAsOf: null };
  }
  throw new Error("MCP returned no benchmark price — FAIL CLOSED");
}

async function main(): Promise<void> {
  const repoSymbol = process.argv[2] ?? REPO_SYMBOL;
  const targetUsd = Number(process.argv[3] ?? 25);
  const env = (process.env.BITGET_ENV ?? "").toLowerCase();

  const client = new BitgetClient({
    apiKey: process.env.BITGET_API_KEY ?? "",
    secretKey: process.env.BITGET_SECRET_KEY ?? "",
    passphrase: process.env.BITGET_PASSPHRASE ?? "",
    demoTrading: env === "testnet" || env === "demo",
  });

  const venueSymbol = mapToVenueSymbol(repoSymbol);
  const spot = await client.request("GET", "/api/v2/spot/account/assets", {}, true);
  const acct = await client.request("GET", "/api/v2/mix/account/accounts", { productType: PRODUCT_TYPE }, true);
  const row = (Array.isArray(acct.data) ? acct.data[0] : acct.data) as Record<string, unknown>;
  const positions = await client.request("GET", "/api/v2/mix/position/all-position", { productType: PRODUCT_TYPE, marginCoin: "USDT" }, true);

  const contractRaw = await client.getMixContractConfig(venueSymbol, PRODUCT_TYPE);
  const ticker = await client.getMixTicker(venueSymbol, PRODUCT_TYPE);
  const referencePriceUsd = Number(ticker.lastPr);
  const book = await client.getMixOrderbook(venueSymbol, 20, PRODUCT_TYPE);

  const quote = await mcpQuote(BENCHMARK_TICKER);
  const regime = resolveRegime();
  const benchmark: BenchmarkEvidence = assessBenchmarkFreshness({
    price: quote.price,
    source: requiredBenchmarkSourceFor(regime.regime) === "EXPLICIT_TS_SOURCE"
      ? "EXPLICIT_TS_SOURCE"
      : "BITGET_MCP_QUOTE",
    provider: "bitget_data",
    sourceAsOf: quote.sourceAsOf,
    fetchedAt: new Date().toISOString(),
    maxAgeMs: 96 * 60 * 60 * 1000,
  });

  const config: MixContractConfig = {
    ...contractRaw,
    symbol: venueSymbol,
    referencePriceUsd,
  };

  const quant = evaluateBasisSpread({
    tokenPrice: referencePriceUsd,
    tradFiClosePrice: benchmark.price,
    orderSizeUsd: targetUsd,
    depth: {
      bids: book.bids.map(([p, s]) => ({ price: Number(p), quantity: Number(s) })),
      asks: book.asks.map(([p, s]) => ({ price: Number(p), quantity: Number(s) })),
    },
    fundingRate8h: Number(ticker.fundingRate ?? 0),
    // Carry horizon is regime-derived, never hardcoded: 0 while TradFi is
    // open, the true hours to the next 09:30 ET reopen while it is closed
    // (~65.5h across a Friday-to-Monday weekend).
    hoursToClose: regime.hoursToNextReopen,
    takerFee: Number(contractRaw.takerFeeRate ?? 0.0006),
  });

  const base = buildPacket({
    config,
    quant,
    account: { equityUsd: Number(row["accountEquity"]), freeMarginUsd: Number(row["available"]) },
    targetNotionalUsd: targetUsd,
    benchmark,
    regime: regime.regime,
    hoursToNextReopen: regime.hoursToNextReopen,
  });

  const intents = sealIntents({
    quant,
    repositorySymbol: repoSymbol,
    sizing: base.sizing,
    projectedLiquidationPrice: referencePriceUsd * 0.98,
    councilScores: { compositeScore: 80, macro: 70, quant: quant.quantScore, risk: 80, exec: 75 },
    rationale: "Bounded Demo strategy pre-flight packet. Not submitted.",
  });

  const packet = {
    stage: 3,
    submitted: false,
    environment: { BITGET_ENV: env, demoTradingHeaderSent: client.demoTrading, positionMode: "hedge", marginMode: "isolated" },
    account: {
      spot_auth_code: String(spot.code),
      equityUsd: Number(row["accountEquity"]),
      freeMarginUsd: Number(row["available"]),
      position_count: ((positions.data as unknown[]) ?? []).length,
      ACCOUNT_FLAT: ((positions.data as unknown[]) ?? []).length === 0,
    },
    venueContract: contractRaw,
    marketRegime: {
      regime: regime.regime,
      etNow: regime.etNowIso,
      hoursToNextReopen: regime.hoursToNextReopen,
      nextReopenAtIso: regime.nextReopenAtIso,
      requiredBenchmarkSource: regime.requiredBenchmarkSource,
      holidayCalendarSupported: regime.holidayCalendarSupported,
      limitation: regime.limitation,
    },
    tokenPrice: referencePriceUsd,
    ...base,
    receiptHash: intents.receiptHash,
    clientOidOpen: intents.clientOidOpen,
    clientOidClose: intents.clientOidClose,
    clientOidsDistinct: intents.clientOidOpen !== intents.clientOidClose,
  };

  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
  if (!packet.executable) {
    process.exitCode = 2;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1].includes("demo-strategy-preflight");
if (invokedDirectly) {
  main().catch((e) => {
    process.stdout.write(`${JSON.stringify({ stage: 3, submitted: false, fatal: String(e) }, null, 2)}\n`);
    process.exit(1);
  });
}
