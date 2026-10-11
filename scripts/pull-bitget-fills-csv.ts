/**
 * PULL BITGET FILLS & EXPORT TO CSV
 *
 * Implements two ingestion pathways for trading history reconciliation:
 *
 * Pathway A (API Pull with Read-Only Key):
 *   Calls Bitget API v2 private endpoints:
 *     - Futures: GET /api/v2/mix/order/fills (USDT-FUTURES)
 *     - Spot:    GET /api/v2/spot/trade/fills
 *   Paginates through 60 to 90 days of execution history using HMAC-SHA256 signing.
 *   Credentials are used in-memory only and never persisted to disk.
 *
 * Pathway B (CSV Ingestion & Normalization):
 *   Parses Bitget Web/App CSV exports (supporting both English and Chinese headers),
 *   normalizes column schemas, computes summary statistics, and exports standardized CSV.
 *
 * Usage:
 *   # API Pull:
 *   pnpm exec tsx scripts/pull-bitget-fills-csv.ts \
 *     --api-key <key> --secret-key <secret> --passphrase <pass> \
 *     --days 90 --out foundry/data/jason_trades_90d.csv
 *
 *   # Or via environment variables:
 *   BITGET_API_KEY=... BITGET_SECRET_KEY=... BITGET_PASSPHRASE=... \
 *     pnpm exec tsx scripts/pull-bitget-fills-csv.ts --days 90
 *
 *   # Ingest existing CSV:
 *   pnpm exec tsx scripts/pull-bitget-fills-csv.ts --csv path/to/bitget_export.csv
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { BitgetClient } from "../packages/engine/src/bitget/client.js";

export interface NormalizedFill {
  fillId: string;
  orderId: string;
  symbol: string;
  side: "buy" | "sell" | string;
  price: number;
  size: number;
  fee: number;
  feeCoin: string;
  tradeRole: "maker" | "taker" | string;
  pnl: number;
  timestampMs: number;
  datetimeIso: string;
}

function parseCliArgs(): {
  apiKey?: string;
  secretKey?: string;
  passphrase?: string;
  days: number;
  outPath: string;
  csvPath?: string;
  productType: "USDT-FUTURES" | "SPOT" | "ALL";
} {
  const args = process.argv.slice(2);
  let apiKey = process.env.BITGET_API_KEY;
  let secretKey = process.env.BITGET_SECRET_KEY;
  let passphrase = process.env.BITGET_PASSPHRASE;
  let days = 90;
  let outPath = join(process.cwd(), "foundry", "data", `bitget_fills_${Date.now()}.csv`);
  let csvPath: string | undefined;
  let productType: "USDT-FUTURES" | "SPOT" | "ALL" = "ALL";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--api-key" && args[i + 1]) apiKey = args[++i];
    else if (arg === "--secret-key" && args[i + 1]) secretKey = args[++i];
    else if (arg === "--passphrase" && args[i + 1]) passphrase = args[++i];
    else if (arg === "--days" && args[i + 1]) days = parseInt(args[++i]!, 10) || 90;
    else if (arg === "--out" && args[i + 1]) outPath = args[++i]!;
    else if (arg === "--csv" && args[i + 1]) csvPath = args[++i]!;
    else if (arg === "--product" && args[i + 1]) {
      const p = args[++i]!.toUpperCase();
      if (p === "SPOT" || p === "USDT-FUTURES" || p === "ALL") productType = p;
    }
  }

  return { apiKey, secretKey, passphrase, days, outPath, csvPath, productType };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Paginates backwards in time from now to startTimeMs to retrieve all fills.
 */
async function pullMixFuturesFills(
  client: BitgetClient,
  startTimeMs: number,
  endTimeMs: number,
): Promise<NormalizedFill[]> {
  const fills: NormalizedFill[] = [];
  let currentEndTime = endTimeMs;
  let idLessThan: string | undefined;
  const maxIterations = 200;
  let iter = 0;

  console.log(`[Futures] Querying USDT-FUTURES fills from ${new Date(startTimeMs).toISOString()} to ${new Date(endTimeMs).toISOString()}...`);

  while (iter++ < maxIterations) {
    const query: Record<string, string> = {
      productType: "USDT-FUTURES",
      limit: "100",
      startTime: String(startTimeMs),
      endTime: String(currentEndTime),
    };
    if (idLessThan) {
      query.idLessThan = idLessThan;
    }

    try {
      const res = await client.request("GET", "/api/v2/mix/order/fills", query, true);
      if (res.code !== "00000" && res.code !== "0") {
        console.warn(`[Futures] Venue returned code ${res.code}: ${res.msg}`);
        break;
      }

      const rawList = Array.isArray(res.data)
        ? res.data
        : typeof res.data === "object" && res.data !== null && Array.isArray((res.data as any).fillList)
          ? (res.data as any).fillList
          : [];

      if (rawList.length === 0) {
        break;
      }

      for (const item of rawList) {
        const ts = Number(item.cTime || item.uTime || 0);
        fills.push({
          fillId: String(item.tradeId || item.fillId || item.orderId || ""),
          orderId: String(item.orderId || ""),
          symbol: String(item.symbol || ""),
          side: String(item.side || "").toLowerCase(),
          price: Number(item.price || 0),
          size: Number(item.baseVolume || item.size || item.tradeQty || 0),
          fee: Math.abs(Number(item.fee || 0)),
          feeCoin: String(item.feeCoin || item.feeDetail?.[0]?.feeCoin || "USDT"),
          tradeRole: String(item.tradeRole || "taker").toLowerCase(),
          pnl: Number(item.profit || 0),
          timestampMs: ts,
          datetimeIso: ts > 0 ? new Date(ts).toISOString() : "",
        });
      }

      const oldest = rawList[rawList.length - 1];
      const oldestId = String(oldest.tradeId || oldest.fillId || "");
      const oldestTs = Number(oldest.cTime || oldest.uTime || 0);

      if (!oldestId || oldestId === idLessThan || oldestTs <= startTimeMs) {
        break;
      }

      idLessThan = oldestId;
      currentEndTime = oldestTs;
      await sleep(150); // respect rate limit
    } catch (err) {
      console.error(`[Futures] Fetch error on iteration ${iter}:`, err instanceof Error ? err.message : err);
      break;
    }
  }

  return fills;
}

/**
 * Paginates spot fills.
 */
async function pullSpotFills(
  client: BitgetClient,
  startTimeMs: number,
  endTimeMs: number,
): Promise<NormalizedFill[]> {
  const fills: NormalizedFill[] = [];
  let currentEndTime = endTimeMs;
  let idLessThan: string | undefined;
  const maxIterations = 200;
  let iter = 0;

  console.log(`[Spot] Querying SPOT fills from ${new Date(startTimeMs).toISOString()} to ${new Date(endTimeMs).toISOString()}...`);

  while (iter++ < maxIterations) {
    const query: Record<string, string> = {
      limit: "100",
      startTime: String(startTimeMs),
      endTime: String(currentEndTime),
    };
    if (idLessThan) {
      query.idLessThan = idLessThan;
    }

    try {
      const res = await client.request("GET", "/api/v2/spot/trade/fills", query, true);
      if (res.code !== "00000" && res.code !== "0") {
        console.warn(`[Spot] Venue returned code ${res.code}: ${res.msg}`);
        break;
      }

      const rawList = Array.isArray(res.data)
        ? res.data
        : typeof res.data === "object" && res.data !== null && Array.isArray((res.data as any).fillList)
          ? (res.data as any).fillList
          : [];

      if (rawList.length === 0) {
        break;
      }

      for (const item of rawList) {
        const ts = Number(item.cTime || item.uTime || 0);
        fills.push({
          fillId: String(item.tradeId || item.fillId || item.orderId || ""),
          orderId: String(item.orderId || ""),
          symbol: String(item.symbol || ""),
          side: String(item.side || "").toLowerCase(),
          price: Number(item.price || 0),
          size: Number(item.size || item.baseVolume || 0),
          fee: Math.abs(Number(item.fee || item.feeDetail?.[0]?.fee || 0)),
          feeCoin: String(item.feeDetail?.[0]?.feeCoin || "USDT"),
          tradeRole: String(item.tradeRole || "taker").toLowerCase(),
          pnl: 0,
          timestampMs: ts,
          datetimeIso: ts > 0 ? new Date(ts).toISOString() : "",
        });
      }

      const oldest = rawList[rawList.length - 1];
      const oldestId = String(oldest.tradeId || oldest.fillId || "");
      const oldestTs = Number(oldest.cTime || oldest.uTime || 0);

      if (!oldestId || oldestId === idLessThan || oldestTs <= startTimeMs) {
        break;
      }

      idLessThan = oldestId;
      currentEndTime = oldestTs;
      await sleep(150);
    } catch (err) {
      console.error(`[Spot] Fetch error on iteration ${iter}:`, err instanceof Error ? err.message : err);
      break;
    }
  }

  return fills;
}

/**
 * Parses Bitget web CSV export file (supports bilingual headers).
 */
export function parseBitgetExportCsv(csvContent: string): NormalizedFill[] {
  const lines = csvContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const rawHeaders = lines[0]!.split(",").map((h) => h.trim().replace(/^["']|["']$/g, ""));
  const headerMap: Record<string, number> = {};
  rawHeaders.forEach((h, idx) => {
    headerMap[h.toLowerCase()] = idx;
  });

  const findIdx = (...keys: string[]): number => {
    for (const k of keys) {
      if (headerMap[k.toLowerCase()] !== undefined) return headerMap[k.toLowerCase()]!;
    }
    return -1;
  };

  const timeIdx = findIdx("time", "trade time", "created time", "cTime", "成交时间", "时间");
  const symIdx = findIdx("symbol", "pair", "contract", "交易对", "合约");
  const sideIdx = findIdx("side", "direction", "type", "方向", "买卖");
  const priceIdx = findIdx("price", "trade price", "fill price", "成交价格", "价格");
  const sizeIdx = findIdx("size", "amount", "volume", "executed", "executed value", "成交量", "成交数量");
  const feeIdx = findIdx("fee", "trading fee", "手续费");
  const feeCoinIdx = findIdx("fee coin", "fee currency", "手续费币种");
  const pnlIdx = findIdx("profit", "realized pnl", "realized profit", "已实现盈亏", "盈亏");
  const orderIdIdx = findIdx("order id", "orderid", "订单id");
  const tradeIdIdx = findIdx("trade id", "fill id", "成交id");

  const results: NormalizedFill[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));
    if (cols.length < 3) continue;

    const timeStr = timeIdx >= 0 ? cols[timeIdx] || "" : "";
    let ts = Number(timeStr);
    if (!Number.isFinite(ts) || ts <= 0) {
      ts = Date.parse(timeStr) || 0;
    }

    const price = priceIdx >= 0 ? Number(cols[priceIdx]) || 0 : 0;
    const size = sizeIdx >= 0 ? Number(cols[sizeIdx]) || 0 : 0;
    const fee = feeIdx >= 0 ? Math.abs(Number(cols[feeIdx]) || 0) : 0;
    const pnl = pnlIdx >= 0 ? Number(cols[pnlIdx]) || 0 : 0;

    results.push({
      fillId: tradeIdIdx >= 0 && cols[tradeIdIdx] ? cols[tradeIdIdx]! : `csv_${i}`,
      orderId: orderIdIdx >= 0 && cols[orderIdIdx] ? cols[orderIdIdx]! : "",
      symbol: symIdx >= 0 ? cols[symIdx] || "" : "UNKNOWN",
      side: (sideIdx >= 0 ? cols[sideIdx] || "" : "").toLowerCase(),
      price,
      size,
      fee,
      feeCoin: feeCoinIdx >= 0 ? cols[feeCoinIdx] || "USDT" : "USDT",
      tradeRole: "unknown",
      pnl,
      timestampMs: ts,
      datetimeIso: ts > 0 ? new Date(ts).toISOString() : "",
    });
  }

  return results;
}

export function exportFillsToCsv(fills: NormalizedFill[], targetPath: string): string {
  const dir = dirname(targetPath);
  mkdirSync(dir, { recursive: true });

  const headers = [
    "fillId",
    "orderId",
    "symbol",
    "side",
    "price",
    "size",
    "fee",
    "feeCoin",
    "tradeRole",
    "pnl",
    "timestampMs",
    "datetimeIso",
  ];

  // Sort chronologically ascending
  fills.sort((a, b) => a.timestampMs - b.timestampMs);

  const rows = fills.map((f) => [
    f.fillId,
    f.orderId,
    f.symbol,
    f.side,
    f.price.toFixed(6),
    f.size.toFixed(6),
    f.fee.toFixed(6),
    f.feeCoin,
    f.tradeRole,
    f.pnl.toFixed(6),
    f.timestampMs,
    f.datetimeIso,
  ].join(","));

  const csvBody = [headers.join(","), ...rows].join("\n") + "\n";
  writeFileSync(targetPath, csvBody, "utf8");

  const sha256 = createHash("sha256").update(csvBody).digest("hex");
  return sha256;
}

async function main(): Promise<void> {
  const opts = parseCliArgs();

  console.log("================================================================================");
  console.log("                 BITGET FILL HISTORY EXTRACTION & CSV EXPORTER                  ");
  console.log("================================================================================");

  let fills: NormalizedFill[] = [];

  if (opts.csvPath) {
    console.log(`[Mode] Ingesting local Bitget CSV export: ${opts.csvPath}`);
    if (!existsSync(opts.csvPath)) {
      console.error(`Error: File not found: ${opts.csvPath}`);
      process.exit(1);
    }
    const rawContent = readFileSync(opts.csvPath, "utf8");
    fills = parseBitgetExportCsv(rawContent);
  } else {
    if (!opts.apiKey || !opts.secretKey || !opts.passphrase) {
      console.log("\n[Notice] No credentials provided. To pull fills from Bitget API:");
      console.log("  Pass credentials via CLI arguments or environment variables:");
      console.log("  --api-key <key> --secret-key <secret> --passphrase <pass>");
      console.log("\nOr ingest an exported CSV directly:");
      console.log("  --csv /path/to/bitget_export.csv\n");
      return;
    }

    console.log(`[Mode] Bitget API v2 Authenticated Extraction (Last ${opts.days} Days)`);
    console.log(`Using API Key: ${opts.apiKey.slice(0, 4)}...${opts.apiKey.slice(-4)} (Read-only)`);

    const client = new BitgetClient({
      apiKey: opts.apiKey,
      secretKey: opts.secretKey,
      passphrase: opts.passphrase,
    });

    const now = Date.now();
    const startTimeMs = now - opts.days * 24 * 60 * 60 * 1000;

    if (opts.productType === "USDT-FUTURES" || opts.productType === "ALL") {
      const futuresFills = await pullMixFuturesFills(client, startTimeMs, now);
      fills.push(...futuresFills);
    }

    if (opts.productType === "SPOT" || opts.productType === "ALL") {
      const spotFills = await pullSpotFills(client, startTimeMs, now);
      fills.push(...spotFills);
    }
  }

  if (fills.length === 0) {
    console.log("\nZero fills found for the specified period.");
    return;
  }

  // Deduplicate fills by fillId
  const uniqueFillsMap = new Map<string, NormalizedFill>();
  for (const f of fills) {
    const key = f.fillId || `${f.symbol}_${f.timestampMs}_${f.price}_${f.size}`;
    if (!uniqueFillsMap.has(key)) {
      uniqueFillsMap.set(key, f);
    }
  }
  const uniqueFills = Array.from(uniqueFillsMap.values());

  const sha256 = exportFillsToCsv(uniqueFills, opts.outPath);

  // Compute summary stats
  const totalTrades = uniqueFills.length;
  const symbols = Array.from(new Set(uniqueFills.map((f) => f.symbol))).filter(Boolean);
  const totalVolumeUsd = uniqueFills.reduce((acc, f) => acc + f.price * f.size, 0);
  const totalFees = uniqueFills.reduce((acc, f) => acc + f.fee, 0);
  const totalPnl = uniqueFills.reduce((acc, f) => acc + f.pnl, 0);
  const minDate = uniqueFills[0]?.datetimeIso ?? "n/a";
  const maxDate = uniqueFills[uniqueFills.length - 1]?.datetimeIso ?? "n/a";

  console.log("\n--------------------------------------------------------------------------------");
  console.log("                           FILL EXTRACTION SUMMARY                              ");
  console.log("--------------------------------------------------------------------------------");
  console.log(`Total Fills Extracted:  ${totalTrades}`);
  console.log(`Date Range:             ${minDate} -> ${maxDate}`);
  console.log(`Symbols Traded:         ${symbols.join(", ")}`);
  console.log(`Total Traded Notional:  $${totalVolumeUsd.toFixed(2)} USD`);
  console.log(`Total Fees Paid:        $${totalFees.toFixed(4)}`);
  console.log(`Realized PnL:           $${totalPnl.toFixed(2)}`);
  console.log(`Output File:            ${opts.outPath}`);
  console.log(`SHA-256 Checksum:       ${sha256}`);
  console.log("--------------------------------------------------------------------------------\n");
}

if (process.argv[1]?.endsWith("pull-bitget-fills-csv.ts")) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
