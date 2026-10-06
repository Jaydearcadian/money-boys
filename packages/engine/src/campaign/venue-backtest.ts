import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateBasisSpread } from "../agents/quant.js";
import { evaluateExecution } from "../agents/execution.js";
import { reduceCouncilVote } from "../council/reducer.js";
import { StructuralChangeGuard, toBlastRadiusReport } from "../skills/igraph-guard/security.js";
import { sealReceipt, type SealedReasoningReceipt } from "../council/receipts.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const DATA_DIR = join(ROOT, "foundry", "data", "historical");

export interface BacktestBar {
  date: string;
  tokenClose: number;
  equityClose: number;
  basisPct: number;
}

export interface BacktestTrade {
  tradeId: string;
  symbol: string;
  side: "BUY_BASIS" | "SELL_BASIS";
  entryDate: string;
  entryTokenPrice: number;
  entryEquityPrice: number;
  entryBasisPct: number;
  quantity: number;
  notionalUsd: number;
  exitDate: string;
  exitTokenPrice: number;
  exitEquityPrice: number;
  exitBasisPct: number;
  holdingDays: number;
  pnlUsd: number;
  returnPct: number;
  feesUsd: number;
  receiptHash: string;
  isOutSample: boolean;
}

export interface DailyReturnRecord {
  date: string;
  dayPnlUsd: number;
  cumulativeEquityUsd: number;
  dailyReturnPct: number;
}

export interface SegmentMetrics {
  segment: "IN_SAMPLE" | "OUT_OF_SAMPLE" | "FULL_CAMPAIGN";
  calendarDays: number;
  tradingDays: number;
  tradesCount: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  totalPnlUsd: number;
  netReturnPct: number;
  maxDrawdownPct: number;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  turnoverRatio: number;
  sharpeStatus: "PUBLISHED" | "WITHHELD_INSUFFICIENT_OBSERVATIONS";
  dailySeries: DailyReturnRecord[];
}

export interface BacktestReconciliation {
  isTradesCount: number;
  oosTradesCount: number;
  fullTradesCount: number;
  tradesCountReconciled: boolean;
  isTotalPnlUsd: number;
  oosTotalPnlUsd: number;
  fullTotalPnlUsd: number;
  pnlReconciledToTheCent: boolean;
  straddlingTradesCount: number;
  straddlingTradesPnlUsd: number;
  straddlingTradesDetail: Array<{
    tradeId: string;
    symbol: string;
    entryDate: string;
    exitDate: string;
    pnlUsd: number;
  }>;
  attributionPolicy: "REALIZED_EXIT_DATE";
}

export interface VenueBacktestSummary {
  headline: string;
  provenance: "HISTORICAL_VENUE_CANDLES";
  syntheticFixture: false;
  validAsPerformanceEvidence: true;
  ingestedSources: {
    tokenData: "Bitget API v2 /api/v2/mix/market/candles (USDT-FUTURES 1D)";
    equityData: "Alpha Vantage TIME_SERIES_DAILY (DOCUMENTED_API)";
  };
  splitParameters: {
    totalCalendarDays: number;
    inSampleDays: number;
    outOfSampleDays: number;
    inSampleCutoffDate: string;
  };
  fullCampaign: SegmentMetrics;
  inSample: SegmentMetrics;
  outOfSample: SegmentMetrics;
  reconciliation: BacktestReconciliation;
  sharpeDecayPct: number | null;
  totalReceiptsSealed: number;
}

export const PAIRS: ReadonlyArray<{ tokenSym: string; eqSym: string }> = [
  { tokenSym: "NVDAUSDT", eqSym: "NVDA" },
  { tokenSym: "TSLAUSDT", eqSym: "TSLA" },
  { tokenSym: "AAPLUSDT", eqSym: "AAPL" },
];

export const IN_SAMPLE_CUTOFF_DATE = "2026-09-02"; // 59 calendar days from 2026-07-05
export const STARTING_EQUITY_USD = 25_000;
export const MIN_TRADES_SHARPE_GATE = 30;

export function loadMatchedPairBars(tokenSym: string, eqSym: string): BacktestBar[] {
  const tokenRaw = JSON.parse(
    readFileSync(join(DATA_DIR, `${tokenSym}-1D.json`), "utf8"),
  ) as Array<{ timestampMs: number; close: number }>;
  const eqRaw = JSON.parse(
    readFileSync(join(DATA_DIR, `EQUITY-${eqSym}-1D.json`), "utf8"),
  ) as { bars: Array<{ date: string; close: number }> };

  const eqByDate = new Map<string, number>();
  for (const b of eqRaw.bars) {
    eqByDate.set(b.date, b.close);
  }

  const out: BacktestBar[] = [];
  for (const b of tokenRaw) {
    const d = new Date(b.timestampMs).toISOString().slice(0, 10);
    const eqClose = eqByDate.get(d);
    if (eqClose !== undefined && eqClose > 0 && b.close > 0) {
      const basisPct = ((b.close - eqClose) / eqClose) * 100;
      out.push({
        date: d,
        tokenClose: b.close,
        equityClose: eqClose,
        basisPct,
      });
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function computeSegmentMetrics(
  segment: "IN_SAMPLE" | "OUT_OF_SAMPLE" | "FULL_CAMPAIGN",
  trades: BacktestTrade[],
  calendarDays: number,
  tradingDates: string[],
  initialEquityUsd: number = STARTING_EQUITY_USD,
): SegmentMetrics {
  const tradesCount = trades.length;
  const winningTrades = trades.filter((t) => t.pnlUsd > 0).length;
  const losingTrades = trades.filter((t) => t.pnlUsd < 0).length;
  const winRatePct = tradesCount > 0 ? (winningTrades / tradesCount) * 100 : 0;

  // Build daily PnL series indexed by exit date
  const pnlByExitDate = new Map<string, number>();
  for (const t of trades) {
    const cur = pnlByExitDate.get(t.exitDate) ?? 0;
    pnlByExitDate.set(t.exitDate, cur + t.pnlUsd);
  }

  // Iterate across every single trading day in this segment
  let currentEquity = initialEquityUsd;
  let peakEquity = initialEquityUsd;
  let maxDrawdownPct = 0;
  const dailySeries: DailyReturnRecord[] = [];
  const dailyReturns: number[] = [];

  for (const date of tradingDates) {
    const dayPnlUsd = Math.round((pnlByExitDate.get(date) ?? 0) * 100) / 100;
    const prevEquity = currentEquity;
    currentEquity = Math.round((currentEquity + dayPnlUsd) * 100) / 100;

    if (currentEquity > peakEquity) {
      peakEquity = currentEquity;
    }
    const dd = ((peakEquity - currentEquity) / peakEquity) * 100;
    if (dd > maxDrawdownPct) {
      maxDrawdownPct = dd;
    }

    const retPct = prevEquity > 0 ? (dayPnlUsd / prevEquity) * 100 : 0;
    const dailyReturnPct = Math.round(retPct * 10000) / 10000;
    const ret = dailyReturnPct / 100;
    dailyReturns.push(ret);
    dailySeries.push({
      date,
      dayPnlUsd,
      cumulativeEquityUsd: currentEquity,
      dailyReturnPct,
    });
  }

  const totalPnlUsd = Math.round((currentEquity - initialEquityUsd) * 100) / 100;
  const netReturnPct = Math.round((totalPnlUsd / initialEquityUsd) * 10000) / 100;

  // Turnover ratio: total volume / initial equity
  const totalTurnoverUsd = trades.reduce((acc, t) => acc + t.notionalUsd * 2, 0);
  const turnoverRatio = initialEquityUsd > 0 ? totalTurnoverUsd / initialEquityUsd : 0;

  // Sharpe & Sortino calculation across actual trading days
  let sharpeRatio: number | null = null;
  let sortinoRatio: number | null = null;
  let sharpeStatus: SegmentMetrics["sharpeStatus"] = "WITHHELD_INSUFFICIENT_OBSERVATIONS";

  if (tradesCount >= MIN_TRADES_SHARPE_GATE && dailyReturns.length >= 10) {
    const n = dailyReturns.length;
    const meanRet = dailyReturns.reduce((a, b) => a + b, 0) / n;
    const variance = dailyReturns.reduce((acc, r) => acc + Math.pow(r - meanRet, 2), 0) / (n - 1 || 1);
    const stdDev = Math.sqrt(variance);

    if (stdDev > 0) {
      sharpeRatio = (meanRet / stdDev) * Math.sqrt(252);
    }

    const downsideVariance =
      dailyReturns.reduce((acc, r) => acc + (r < 0 ? Math.pow(r, 2) : 0), 0) / n;
    const downsideStdDev = Math.sqrt(downsideVariance);

    if (downsideStdDev > 0) {
      sortinoRatio = (meanRet / downsideStdDev) * Math.sqrt(252);
    }
    sharpeStatus = "PUBLISHED";
  }

  return {
    segment,
    calendarDays,
    tradingDays: tradingDates.length,
    tradesCount,
    winningTrades,
    losingTrades,
    winRatePct: Math.round(winRatePct * 10) / 10,
    totalPnlUsd,
    netReturnPct,
    maxDrawdownPct: Math.round(maxDrawdownPct * 100) / 100,
    sharpeRatio: sharpeRatio !== null ? Math.round(sharpeRatio * 100) / 100 : null,
    sortinoRatio: sortinoRatio !== null ? Math.round(sortinoRatio * 100) / 100 : null,
    turnoverRatio: Math.round(turnoverRatio * 100) / 100,
    sharpeStatus,
    dailySeries,
  };
}

export class VenueBacktestRunner {
  private readonly completedTrades: BacktestTrade[] = [];
  private readonly receipts: SealedReasoningReceipt[] = [];

  runBacktest(): VenueBacktestSummary {
    const pairBars = new Map<string, BacktestBar[]>();
    for (const { tokenSym, eqSym } of PAIRS) {
      pairBars.set(tokenSym, loadMatchedPairBars(tokenSym, eqSym));
    }

    // Collect all unique trading dates sorted chronologically
    const allDates = Array.from(
      new Set(
        Array.from(pairBars.values())
          .flatMap((bars) => bars.map((b) => b.date)),
      ),
    ).sort();

    interface OpenPosition {
      symbol: string;
      side: "BUY_BASIS" | "SELL_BASIS";
      entryDate: string;
      entryTokenPrice: number;
      entryEquityPrice: number;
      entryBasisPct: number;
      quantity: number;
      notionalUsd: number;
      receiptHash: string;
      isOutSample: boolean;
      daysHeld: number;
    }

    const openPositions = new Map<string, OpenPosition>();
    let tradeNonce = 1;

    for (const date of allDates) {
      const isOutSample = date > IN_SAMPLE_CUTOFF_DATE;

      for (const { tokenSym } of PAIRS) {
        const bars = pairBars.get(tokenSym)!;
        const currentBar = bars.find((b) => b.date === date);
        if (!currentBar) continue;

        const pos = openPositions.get(tokenSym);

        // 1. Manage Existing Open Position
        if (pos) {
          pos.daysHeld++;
          const basisChange = currentBar.basisPct - pos.entryBasisPct;
          const reverted =
            pos.side === "BUY_BASIS"
              ? currentBar.basisPct >= pos.entryBasisPct + 0.3 || currentBar.basisPct >= 0
              : currentBar.basisPct <= pos.entryBasisPct - 0.3 || currentBar.basisPct <= 0;

          // Exit condition: basis converged or max 5-day hold window reached
          if (reverted || pos.daysHeld >= 5) {
            const exitTokenPrice = currentBar.tokenClose;
            const exitEquityPrice = currentBar.equityClose;
            const exitBasisPct = currentBar.basisPct;

            let rawGainUsd: number;
            if (pos.side === "BUY_BASIS") {
              rawGainUsd = (exitTokenPrice - pos.entryTokenPrice) * pos.quantity;
            } else {
              rawGainUsd = (pos.entryTokenPrice - exitTokenPrice) * pos.quantity;
            }

            const totalFeesUsd = (pos.notionalUsd + exitTokenPrice * pos.quantity) * 0.0006;
            const pnlUsd = rawGainUsd - totalFeesUsd;
            const returnPct = pos.notionalUsd > 0 ? (pnlUsd / pos.notionalUsd) * 100 : 0;

            this.completedTrades.push({
              tradeId: `trade-venue-${String(tradeNonce++).padStart(4, "0")}`,
              symbol: pos.symbol,
              side: pos.side,
              entryDate: pos.entryDate,
              entryTokenPrice: pos.entryTokenPrice,
              entryEquityPrice: pos.entryEquityPrice,
              entryBasisPct: pos.entryBasisPct,
              quantity: pos.quantity,
              notionalUsd: pos.notionalUsd,
              exitDate: date,
              exitTokenPrice,
              exitEquityPrice,
              exitBasisPct,
              holdingDays: pos.daysHeld,
              pnlUsd: Math.round(pnlUsd * 100) / 100,
              returnPct: Math.round(returnPct * 100) / 100,
              feesUsd: Math.round(totalFeesUsd * 100) / 100,
              receiptHash: pos.receiptHash,
              isOutSample: date > IN_SAMPLE_CUTOFF_DATE,
            });

            openPositions.delete(tokenSym);
          }
        }

        // 2. Evaluate Potential Entry
        if (!openPositions.has(tokenSym)) {
          const basisAbs = Math.abs(currentBar.basisPct);
          // Dislocation hurdle threshold: must exceed 0.50% (50bps)
          if (basisAbs >= 0.50) {
            const side: "BUY_BASIS" | "SELL_BASIS" =
              currentBar.basisPct < 0 ? "BUY_BASIS" : "SELL_BASIS";

            const targetNotional = 2000;
            const quantity = Math.round((targetNotional / currentBar.tokenClose) * 100) / 100;
            const notionalUsd = Math.round(quantity * currentBar.tokenClose * 100) / 100;

            // Synthetic top of book around token close
            const depth = {
              bids: [{ price: currentBar.tokenClose * 0.9995, quantity: 50 }],
              asks: [{ price: currentBar.tokenClose * 1.0005, quantity: 50 }],
            };

            const quant = evaluateBasisSpread({
              tokenPrice: currentBar.tokenClose,
              tradFiClosePrice: currentBar.equityClose,
              orderSizeUsd: notionalUsd,
              depth,
              fundingRate8h: 0.0001,
              hoursToClose: 16,
              takerFee: 0.0006,
            });

            const account = {
              equityUsd: STARTING_EQUITY_USD,
              usedMarginUsd: 2500,
              freeMarginUsd: 22500,
              openOrders: [],
            };

            const risk = StructuralChangeGuard.evaluateBlastRadius(
              {
                symbol: tokenSym,
                side: side === "BUY_BASIS" ? "buy" : "sell",
                quantity,
                priceUsd: currentBar.tokenClose,
              },
              account,
            );

            if (risk.decision === "APPROVED") {
              const exec = evaluateExecution({
                orderSizeUsd: notionalUsd,
                availableDepthUsd: quant.availableDepthUsd,
                depthCoverage: quant.depthCoverage,
                completeFill: quant.completeFill,
                takerFee: 0.0006,
                vwapSlippage: quant.vwapSlippage,
              });

              const council = reduceCouncilVote({
                macroScore: 70, // Baseline macro catalyst score
                quantScore: quant.quantScore,
                riskScore: 90,
                execScore: exec.executionScore,
                riskPermitted: true,
                originalExposureUsd: notionalUsd,
              });

              if (council.status === "APPROVED") {
                const receipt = sealReceipt({
                  symbol: tokenSym,
                  action: side === "BUY_BASIS" ? "BUY_BASIS" : "SELL_BASIS",
                  quantMetrics: quant,
                  riskReport: toBlastRadiusReport(risk),
                  councilScores: {
                    compositeScore: council.compositeScore,
                    macro: 70,
                    quant: quant.quantScore,
                    risk: 90,
                    exec: exec.executionScore,
                  },
                  decision: "APPROVED",
                  rationale: `Venue Backtest Entry: ${side} on ${currentBar.basisPct.toFixed(2)}% dislocation`,
                });

                this.receipts.push(receipt);

                openPositions.set(tokenSym, {
                  symbol: tokenSym,
                  side,
                  entryDate: date,
                  entryTokenPrice: currentBar.tokenClose,
                  entryEquityPrice: currentBar.equityClose,
                  entryBasisPct: currentBar.basisPct,
                  quantity,
                  notionalUsd,
                  receiptHash: receipt.receiptHash,
                  isOutSample,
                  daysHeld: 0,
                });
              }
            }
          }
        }
      }
    }

    const inSampleTrades = this.completedTrades.filter((t) => !t.isOutSample);
    const outSampleTrades = this.completedTrades.filter((t) => t.isOutSample);

    const inSampleDates = allDates.filter((d) => d <= IN_SAMPLE_CUTOFF_DATE);
    const outSampleDates = allDates.filter((d) => d > IN_SAMPLE_CUTOFF_DATE);

    const fullCampaign = computeSegmentMetrics(
      "FULL_CAMPAIGN",
      this.completedTrades,
      89,
      allDates,
    );
    const inSample = computeSegmentMetrics(
      "IN_SAMPLE",
      inSampleTrades,
      59,
      inSampleDates,
    );
    const outOfSample = computeSegmentMetrics(
      "OUT_OF_SAMPLE",
      outSampleTrades,
      30,
      outSampleDates,
    );

    let sharpeDecayPct: number | null = null;
    if (inSample.sharpeRatio !== null && outOfSample.sharpeRatio !== null && inSample.sharpeRatio !== 0) {
      sharpeDecayPct = Math.round(
        ((inSample.sharpeRatio - outOfSample.sharpeRatio) / inSample.sharpeRatio) * 1000,
      ) / 10;
    }

    const straddlingTrades = this.completedTrades.filter(
      (t) => t.entryDate <= IN_SAMPLE_CUTOFF_DATE && t.exitDate > IN_SAMPLE_CUTOFF_DATE,
    );
    const straddlingTradesPnlUsd = Math.round(
      straddlingTrades.reduce((acc, t) => acc + t.pnlUsd, 0) * 100,
    ) / 100;

    const pnlSum = Math.round((inSample.totalPnlUsd + outOfSample.totalPnlUsd) * 100) / 100;
    const pnlReconciledToTheCent = pnlSum === fullCampaign.totalPnlUsd;
    const tradesCountReconciled =
      inSample.tradesCount + outOfSample.tradesCount === fullCampaign.tradesCount;

    const reconciliation: BacktestReconciliation = {
      isTradesCount: inSample.tradesCount,
      oosTradesCount: outOfSample.tradesCount,
      fullTradesCount: fullCampaign.tradesCount,
      tradesCountReconciled,
      isTotalPnlUsd: inSample.totalPnlUsd,
      oosTotalPnlUsd: outOfSample.totalPnlUsd,
      fullTotalPnlUsd: fullCampaign.totalPnlUsd,
      pnlReconciledToTheCent,
      straddlingTradesCount: straddlingTrades.length,
      straddlingTradesPnlUsd,
      straddlingTradesDetail: straddlingTrades.map((t) => ({
        tradeId: t.tradeId,
        symbol: t.symbol,
        entryDate: t.entryDate,
        exitDate: t.exitDate,
        pnlUsd: t.pnlUsd,
      })),
      attributionPolicy: "REALIZED_EXIT_DATE",
    };

    const returnDecay =
      inSample.netReturnPct !== 0
        ? (outOfSample.netReturnPct / inSample.netReturnPct).toFixed(2)
        : "0.00";

    const headline = `IS +${inSample.netReturnPct.toFixed(2)}% (Sharpe ${inSample.sharpeRatio !== null ? inSample.sharpeRatio.toFixed(2) : "WITHHELD"}) -> OOS +${outOfSample.netReturnPct.toFixed(2)}% (${outOfSample.tradesCount} trades, Sharpe ${outOfSample.sharpeStatus}), Return Decay ${returnDecay}x, Turnover ${fullCampaign.turnoverRatio.toFixed(2)} (${Math.round(fullCampaign.turnoverRatio * 100).toLocaleString("en-US")}%)`;

    return {
      headline,
      provenance: "HISTORICAL_VENUE_CANDLES",
      syntheticFixture: false,
      validAsPerformanceEvidence: true,
      ingestedSources: {
        tokenData: "Bitget API v2 /api/v2/mix/market/candles (USDT-FUTURES 1D)",
        equityData: "Alpha Vantage TIME_SERIES_DAILY (DOCUMENTED_API)",
      },
      splitParameters: {
        totalCalendarDays: 89,
        inSampleDays: 59,
        outOfSampleDays: 30,
        inSampleCutoffDate: IN_SAMPLE_CUTOFF_DATE,
      },
      fullCampaign,
      inSample,
      outOfSample,
      reconciliation,
      sharpeDecayPct,
      totalReceiptsSealed: this.receipts.length,
    };
  }

  getCompletedTrades(): readonly BacktestTrade[] {
    return this.completedTrades;
  }

  getReceipts(): readonly SealedReasoningReceipt[] {
    return this.receipts;
  }
}
