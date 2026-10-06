/**
 * LIVE ORDERBOOK DEPTH WALK — venue evidence for GAP-014.
 *
 * WHAT THIS PROVES
 *   GAP-014's residual was: "No orderbook read has driven a real VWAP/slippage
 *   calculation on venue." Every previous orderbook use was a unit test against
 *   a fixture book. This reads the LIVE Bitget v2 orderbook and drives it
 *   through the real evaluateBasisSpread depth walk, so the VWAP, slippage and
 *   depth-coverage figures come from venue data rather than authored levels.
 *
 * WHAT IT IS NOT
 *   Not a backtest, not performance evidence, not a claim about profitability.
 *   It is an INTEGRATION artefact: proof that /api/v2/mix/market/orderbook is
 *   reached with the bare futures symbol and that its levels drive the engine.
 *   Deliberately carries no syntheticFixture/validAsPerformanceEvidence stamp,
 *   because those fields mean "backtest result" and this is not one.
 *
 * Usage: node --import tsx scripts/capture-orderbook-depth-evidence.ts
 */
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BitgetClient } from "../packages/engine/src/bitget/client.js";
import { PRODUCT_TYPE } from "../packages/engine/src/bitget/strategy-packet.js";
import { evaluateBasisSpread } from "../packages/engine/src/agents/quant.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "foundry", "evidence", "p13");

const PAIRS: ReadonlyArray<{ token: string; equity: string }> = [
  { token: "NVDAUSDT", equity: "NVDA" },
  { token: "TSLAUSDT", equity: "TSLA" },
  { token: "AAPLUSDT", equity: "AAPL" },
  { token: "MSFTUSDT", equity: "MSFT" },
  { token: "GOOGLUSDT", equity: "GOOGL" },
];

const ORDER_SIZE_USD = 50;

async function main(): Promise<void> {
  const client = new BitgetClient({
    apiKey: process.env["BITGET_API_KEY"] ?? "",
    secretKey: process.env["BITGET_SECRET_KEY"] ?? "",
    passphrase: process.env["BITGET_PASSPHRASE"] ?? "",
    demoTrading: true,
  });

  const reads: Array<Record<string, unknown>> = [];
  for (const { token, equity } of PAIRS) {
    const [ticker, book] = await Promise.all([
      client.getMixTicker(token, PRODUCT_TYPE),
      client.getMixOrderbook(token, 100, PRODUCT_TYPE),
    ]);
    const tokenPrice = Number(ticker.lastPr ?? ticker.last ?? "0");
    // Depth walk over the REAL venue levels. Side walked is chosen by the sign
    // of a reference dislocation so both sides get exercised across pairs.
    const reference = tokenPrice * (token === "NVDAUSDT" ? 0.9995 : 1.0005);
    const quant = evaluateBasisSpread({
      tokenPrice,
      tradFiClosePrice: reference,
      orderSizeUsd: ORDER_SIZE_USD,
      depth: {
        bids: book.bids.map(([p, s]) => ({ price: Number(p), quantity: Number(s) })),
        asks: book.asks.map(([p, s]) => ({ price: Number(p), quantity: Number(s) })),
      },
      fundingRate8h: Number(ticker.fundingRate ?? 0),
      hoursToClose: 1,
      takerFee: 0.0006,
      executionStyle: "aggressive",
    });
    const bestBid = Number(book.bids[0]?.[0] ?? 0);
    const bestAsk = Number(book.asks[0]?.[0] ?? 0);

    reads.push({
      tokenSymbol: token,
      underlyingEquity: equity,
      endpoint: `/api/v2/mix/market/orderbook?symbol=${token}&productType=${USDT_PRODUCT}&granularity`,
      bookLevelsReturned: { bids: book.bids.length, asks: book.asks.length },
      topOfBook: { bestBid, bestAsk, spread: Number((bestAsk - bestBid).toFixed(4)) },
      tokenPrice,
      orderSizeUsd: ORDER_SIZE_USD,
      depthWalk: {
        sideWalked: quant.sideWalked,
        filledUsd: quant.filledUsd,
        completeFill: quant.completeFill,
        vwapPrice: quant.vwapPrice,
        vwapSlippagePct: quant.vwapSlippagePct,
        availableDepthUsd: quant.availableDepthUsd,
        depthCoverage: quant.depthCoverage,
        rawBasisPct: quant.rawBasisPct,
        hurdleRatePct: quant.hurdleRatePct,
        netEdgePct: quant.netEdgePct,
        quantScore: quant.quantScore,
        action: quant.action,
      },
    });
    process.stdout.write(
      `  ${token.padEnd(10)} book ${book.bids.length}b/${book.asks.length}a  ` +
        `vwapSlip=${quant.vwapSlippagePct}%  netEdge=${quant.netEdgePct}%  ` +
        `depthCov=${(quant.depthCoverage * 100).toFixed(0)}%  ${quant.action}\n`,
    );
  }

  const payload = {
    claimId: "GAP-014",
    kind: "LIVE_VENUE_ORDERBOOK_DEPTH_WALK",
    capturedAt: new Date().toISOString(),
    source: {
      endpoint: "https://api.bitget.com/api/v2/mix/market/orderbook",
      productType: PRODUCT_TYPE,
      granularity: "step0",
      authenticated: false,
      note: "Public market-data route. Uses the BARE futures symbol, which is the corrected behaviour GAP-014 records.",
    },
    engine: "packages/engine/src/agents/quant.ts :: evaluateBasisSpread",
    notPerformanceEvidence:
      "This is an INTEGRATION artefact proving the orderbook route reaches the engine with venue levels. " +
      "It is not a backtest, not a Sharpe record, and carries no profitability claim.",
    pairsRead: PAIRS.length,
    reads,
  };

  mkdirSync(OUT, { recursive: true });
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  const file = join(OUT, "orderbook_depth_evidence.json");
  writeFileSync(file, text);
  process.stdout.write(`\nevidence: ${file}\nsha256: ${createHash("sha256").update(text).digest("hex")}\n`);
}

const USDT_PRODUCT = PRODUCT_TYPE;

main().catch((e: unknown) => {
  process.stdout.write(`FAILED: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});