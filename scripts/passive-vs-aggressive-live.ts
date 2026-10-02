/**
 * PASSIVE vs AGGRESSIVE — one live session, two cost models, one read.
 *
 * WHY THIS EXISTS
 *   The passive cost model (see quant.ts executionStyle) was derived from two
 *   recorded NEUTRAL reads and has never been evaluated against a live book.
 *   Comparing the two models requires the SAME market snapshot, otherwise the
 *   difference between them is indistinguishable from the market moving.
 *
 * WHAT THIS DOES
 *   ONE Robinhood benchmark read, ONE Bitget orderbook, ONE ticker. Both
 *   execution styles are then evaluated locally from those identical inputs,
 *   so the only variable is the cost model.
 *
 * WHAT THIS DOES NOT DO
 *   - No scheduler, no polling loop, no retry. One pass, then exit.
 *   - No dispatcher, no order route, no order of any kind. GET reads only.
 *   - No gap or claim edit. Evidence only.
 *   - Does not choose a style or recommend one. It reports both and lets the
 *     decision be made deliberately.
 *
 * Usage:
 *   set -a; . ./.env; set +a; BITGET_ENV=testnet \
 *     node --import tsx scripts/passive-vs-aggressive-live.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BitgetClient } from "../packages/engine/src/bitget/client.js";
import { PRODUCT_TYPE } from "../packages/engine/src/bitget/strategy-packet.js";
import { fetchRobinhoodBenchmark, toUnderlyingReferenceSymbol } from "../packages/engine/src/integrations/robinhood/benchmark.js";
import { evaluateBasisSpread } from "../packages/engine/src/agents/quant.js";
import { computeInventoryQuote } from "../packages/engine/src/agents/inventory-quote.js";
import { computeFillProbability } from "../packages/engine/src/agents/fill-probability.js";
import { etDateKey, resolveSession, type CalendarDay, type TradingCalendar } from "../packages/engine/src/agents/session-calendar.js";
import { admitCalendarForDate, type CalendarDatasetV1 } from "../packages/engine/src/agents/calendar-dataset.js";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "foundry", "evidence", "p13");
const CALENDAR = join(HERE, "..", "foundry", "evidence", "p11", "calendar", "nasdaq-2026.operator-reviewed.json");

const REPO_SYMBOL = "rNVDAUSDT";
const VENUE_SYMBOL = "NVDAUSDT";
const ORDER_SIZE_USD = 50;
const EFFECTIVE_GATE_MS = 15000;

let robinhoodReadCount = 0;

async function main(): Promise<void> {
  const now = new Date();
  const ds = JSON.parse(readFileSync(CALENDAR, "utf8")) as CalendarDatasetV1;
  const days: Record<string, CalendarDay> = {};
  for (const e of ds.entries) {
    days[e.date] = {
      date: e.date,
      type: e.status === "OPEN" ? "REGULAR" : e.status === "CLOSED" ? "HOLIDAY" : "EARLY_CLOSE",
      ...(e.closeMinute !== undefined ? { closeMinute: e.closeMinute } : {}),
      note: e.note ?? "",
    };
  }
  const calendar: TradingCalendar = { id: ds.datasetId, exchange: ds.exchange, days };
  const datasetId = ds.datasetId;
  const admission = admitCalendarForDate({ dataset: ds, date: etDateKey(now), now });
  if (!admission.ok) throw new Error(`calendar not admitted: ${admission.code} ${admission.detail}`);
  const session = resolveSession({ now, calendar });
  const sessionLabel = session.tradable ? `TRADABLE ${session.type}` : `NOT_TRADABLE ${session.code}`;
  process.stdout.write(`session: ${sessionLabel} calendar=${datasetId}\n`);

  const client = new BitgetClient({
    apiKey: process.env["BITGET_API_KEY"]!,
    secretKey: process.env["BITGET_SECRET_KEY"]!,
    passphrase: process.env["BITGET_PASSPHRASE"]!,
    demoTrading: process.env["BITGET_ENV"] === "testnet",
  });

  // ---- ONE benchmark read ------------------------------------------------
  const reference = toUnderlyingReferenceSymbol(REPO_SYMBOL);
  const bench = await fetchRobinhoodBenchmark({
    symbol: reference,
    fetchImpl: (u: string) => fetch(u),
  });
  robinhoodReadCount += 1;
  const ageMs = Date.now() - Date.parse(bench.sourceAsOf);
  process.stdout.write(`benchmark: ${reference} sourceAsOf=${bench.sourceAsOf} age=${ageMs}ms\n`);
  if (ageMs > EFFECTIVE_GATE_MS) {
    throw new Error(`quote older than the ${EFFECTIVE_GATE_MS}ms effective gate: ${ageMs}ms`);
  }

  // ---- ONE book, ONE ticker, ONE contract -------------------------------
  const [ticker, book, contract] = await Promise.all([
    client.getMixTicker(VENUE_SYMBOL, PRODUCT_TYPE),
    client.getMixOrderbook(VENUE_SYMBOL, 20, PRODUCT_TYPE),
    client.getMixContractConfig(VENUE_SYMBOL, PRODUCT_TYPE),
  ]);
  const tokenPrice = Number(ticker.lastPr ?? ticker.last ?? "0");
  const depth = {
    bids: book.bids.map(([p, s]) => ({ price: Number(p), quantity: Number(s) })),
    asks: book.asks.map(([p, s]) => ({ price: Number(p), quantity: Number(s) })),
  };
  const takerFee = Number(contract.takerFeeRate ?? 0.0006);
  const makerFee = Number(contract.makerFeeRate ?? 0);
  const funding = Number(ticker.fundingRate ?? 0);
  process.stdout.write(`token=${tokenPrice} takerFee=${takerFee} makerFee=${makerFee} funding8h=${funding}\n`);

  const shared = {
    tokenPrice,
    tradFiClosePrice: bench.midpoint,
    orderSizeUsd: ORDER_SIZE_USD,
    depth,
    fundingRate8h: funding,
    hoursToClose: 1,
  };

  // ---- SAME inputs, two cost models --------------------------------------
  const aggressive = evaluateBasisSpread({ ...shared, takerFee, executionStyle: "aggressive" });
  const passive = evaluateBasisSpread({ ...shared, takerFee, makerFee, executionStyle: "passive" });

  // ---- slices 2 and 3 on the same snapshot ------------------------------
  const mid = passive.midPrice;
  const volPerSqrtSec = 0.0001;
  const flat = computeInventoryQuote({
    fairPrice: mid, inventoryBase: 0, volatilityPerSqrtSecond: volPerSqrtSec,
    riskAversion: 0.1, horizonSeconds: 3600, baseSpread: 0.0016, maxInventoryBase: 1,
  });
  const longInv = computeInventoryQuote({
    fairPrice: mid, inventoryBase: 0.5, volatilityPerSqrtSecond: volPerSqrtSec,
    riskAversion: 0.1, horizonSeconds: 3600, baseSpread: 0.0016, maxInventoryBase: 1,
  });
  const fill = computeFillProbability({
    orderSizeBase: ORDER_SIZE_USD / mid,
    queueAheadBase: Number(book.bids[0]?.[1] ?? 0),
    meanInterarrivalSeconds: 30,
    timeInMarketSeconds: 300,
    arrivalRateBasePerSecond: 0.5,
    adverseFillProbability: 0.5,
    capturedSpread: passive.halfSpreadPct / 100,
    foregoneEdgeOnNoFill: Math.abs(passive.rawBasis),
  });

  const evidence = {
    campaign: "p13-passive-vs-aggressive",
    stage: "single live snapshot, both cost models",
    oneShot: true, scheduler: false, pollingLoop: false, retryLoop: false,
    dispatcherInvoked: false, orderSubmitted: false, robinhoodReads: robinhoodReadCount,
    session: { label: sessionLabel, etDate: etDateKey(now), calendarDataset: datasetId },
    provenance: { sourceAsOf: bench.sourceAsOf, sourceAsOfVerbatim: bench.sourceAsOfVerbatim, timestampType: bench.timestampType, fetchedAt: bench.fetchedAt, provider: "robinhood_stock_token_api", symbol: reference },
    freshness: { ageMs, effectiveGateMs: EFFECTIVE_GATE_MS, status: ageMs <= EFFECTIVE_GATE_MS ? "within_effective_gate" : "STALE", basis: "receipt-relative" },
    inputs: { tokenPrice, benchmarkPrice: bench.midpoint, orderSizeUsd: ORDER_SIZE_USD, takerFee, makerFee, fundingRate8h: funding, hoursToClose: shared.hoursToClose, topOfBook: depth.bids[0], bestAsk: depth.asks[0] },
    models: {
      aggressive: { action: aggressive.action, rawBasisPct: aggressive.rawBasisPct, hurdleRatePct: aggressive.hurdleRatePct, executionFeeRate: aggressive.executionFeeRate, executionFrictionRate: aggressive.executionFrictionRate, netEdgePct: aggressive.netEdgePct, quantScore: aggressive.quantScore },
      passive: { action: passive.action, rawBasisPct: passive.rawBasisPct, hurdleRatePct: passive.hurdleRatePct, executionFeeRate: passive.executionFeeRate, executionFrictionRate: passive.executionFrictionRate, netEdgePct: passive.netEdgePct, quantScore: passive.quantScore, adverseSelection: 0.5 },
    },
    delta: {
      hurdleReductionPct: Number(((aggressive.hurdleRatePct - passive.hurdleRatePct)).toFixed(4)),
      verdictChanged: aggressive.action !== passive.action,
      feeShareOfAggressiveHurdlePct: Number(((aggressive.executionFeeRate / aggressive.hurdleRate) * 100).toFixed(2)),
    },
    inventoryQuote: { flat, longHalf: longInv, reservationSkewDelta: Number((longInv.reservationSkew - flat.reservationSkew).toFixed(8)) },
    fillProbability: fill,
    noRecommendation: "Both models are reported. This evidence does not select an execution style; that decision requires a mandate, not a script.",
  };

  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `passive_vs_aggressive_${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`\nAGGRESSIVE  hurdle=${aggressive.hurdleRatePct}%  net=${aggressive.netEdgePct}%  -> ${aggressive.action}\n`);
  process.stdout.write(`PASSIVE     hurdle=${passive.hurdleRatePct}%  net=${passive.netEdgePct}%  -> ${passive.action}\n`);
  process.stdout.write(`fee share of aggressive hurdle: ${evidence.delta.feeShareOfAggressiveHurdlePct}%\n`);
  process.stdout.write(`verdictChanged=${evidence.delta.verdictChanged}\n`);
  process.stdout.write(`P(fill)=${fill.fillProbability} riskAdjustedEdge=${fill.riskAdjustedEdge}\n`);
  process.stdout.write(`evidence: ${file}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    process.stdout.write(`RUN ABORTED: ${String(e instanceof Error ? e.message : e)}\n`);
    process.exit(1);
  });