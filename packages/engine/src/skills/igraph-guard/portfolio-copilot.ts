import { z } from "zod";

export const OrderSideSchema = z.enum(["buy", "sell"]);
export type OrderSide = z.infer<typeof OrderSideSchema>;

/**
 * PORTFOLIO COPILOT — Factor, Correlation & Concentration Risk Model.
 *
 * Expands Risk Boy's blast-radius defense with portfolio-level intelligence:
 *   R4: Single-asset concentration limit <= 40.0% of portfolio equity.
 *   R5: Sector/theme concentration limit <= 60.0% of portfolio equity.
 *   R6: Projected net market beta magnitude <= 2.50.
 *   C1: Correlation-cluster monitoring (surfaces pairs with rho >= 0.70).
 *
 * De-risking trades (trades reducing exposure or beta in an over-allocated
 * asset/sector) are permitted to assist portfolio healing.
 *
 * Pure TypeScript + Zod. Zero external dependencies, no LLM, deterministic math.
 */

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const SectorSchema = z.enum([
  "SEMICONDUCTORS",
  "AUTOMOTIVE_TECH",
  "CONSUMER_TECH",
  "ENTERPRISE_SOFTWARE",
  "E_COMMERCE_CLOUD",
  "DIGITAL_ASSET",
  "BROAD_MARKET",
  "UNASSIGNED",
]);
export type Sector = z.infer<typeof SectorSchema>;

export const AssetFactorProfileSchema = z.object({
  symbol: z.string().min(1),
  sector: SectorSchema,
  beta: z.number().finite(),
  description: z.string().optional(),
});
export type AssetFactorProfile = z.infer<typeof AssetFactorProfileSchema>;

export const PortfolioPositionSchema = z.object({
  symbol: z.string().min(1),
  side: OrderSideSchema,
  quantity: z.number().positive(),
  priceUsd: z.number().positive(),
});
export type PortfolioPosition = z.infer<typeof PortfolioPositionSchema>;

export const PortfolioStateSchema = z.object({
  equityUsd: z.number().positive(),
  positions: z.array(PortfolioPositionSchema).default([]),
});
export type PortfolioState = z.infer<typeof PortfolioStateSchema>;

export const TradeImpactRequestSchema = z.object({
  symbol: z.string().min(1),
  side: OrderSideSchema,
  quantity: z.number().positive(),
  priceUsd: z.number().positive(),
});
export type TradeImpactRequest = z.infer<typeof TradeImpactRequestSchema>;

export const PortfolioMetricsSchema = z.object({
  netBeta: z.number().finite(),
  totalGrossExposureUsd: z.number().nonnegative(),
  grossLeverage: z.number().nonnegative(),
  assetWeights: z.record(z.string(), z.number()),
  sectorWeights: z.record(SectorSchema, z.number()),
  correlatedExposureUsd: z.number().nonnegative(),
  correlatedPairs: z.array(z.string()),
});
export type PortfolioMetrics = z.infer<typeof PortfolioMetricsSchema>;

export const PortfolioRiskAssessmentSchema = z.object({
  decision: z.enum(["APPROVED", "HARD_VETO"]),
  reasons: z.array(z.string()),
  warnings: z.array(z.string()),
  currentMetrics: PortfolioMetricsSchema,
  projectedMetrics: PortfolioMetricsSchema,
  deltas: z.object({
    netBetaDelta: z.number().finite(),
    exposureDeltaUsd: z.number().finite(),
  }),
});
export type PortfolioRiskAssessment = z.infer<typeof PortfolioRiskAssessmentSchema>;

// ---------------------------------------------------------------------------
// Constants & Defaults
// ---------------------------------------------------------------------------

export const MAX_SINGLE_ASSET_CONCENTRATION = 0.40; // 40%
export const MAX_SECTOR_CONCENTRATION = 0.60;        // 60%
export const MAX_PORTFOLIO_NET_BETA = 2.50;          // |beta| <= 2.50
export const CORRELATION_ALERT_THRESHOLD = 0.70;     // rho >= 0.70

/**
 * Standard asset universe taxonomy and benchmark equity beta.
 */
export const DEFAULT_ASSET_PROFILES: Record<string, AssetFactorProfile> = {
  rNVDAUSDT: { symbol: "rNVDAUSDT", sector: "SEMICONDUCTORS", beta: 1.75, description: "NVIDIA Tokenized Equity" },
  NVDAUSDT: { symbol: "NVDAUSDT", sector: "SEMICONDUCTORS", beta: 1.75, description: "NVIDIA Futures" },
  rTSLAUSDT: { symbol: "rTSLAUSDT", sector: "AUTOMOTIVE_TECH", beta: 2.05, description: "Tesla Tokenized Equity" },
  TSLAUSDT: { symbol: "TSLAUSDT", sector: "AUTOMOTIVE_TECH", beta: 2.05, description: "Tesla Futures" },
  rAAPLUSDT: { symbol: "rAAPLUSDT", sector: "CONSUMER_TECH", beta: 1.05, description: "Apple Tokenized Equity" },
  AAPLUSDT: { symbol: "AAPLUSDT", sector: "CONSUMER_TECH", beta: 1.05, description: "Apple Futures" },
  rMSFTUSDT: { symbol: "rMSFTUSDT", sector: "ENTERPRISE_SOFTWARE", beta: 1.15, description: "Microsoft Tokenized Equity" },
  MSFTUSDT: { symbol: "MSFTUSDT", sector: "ENTERPRISE_SOFTWARE", beta: 1.15, description: "Microsoft Futures" },
  rAMZNUSDT: { symbol: "rAMZNUSDT", sector: "E_COMMERCE_CLOUD", beta: 1.25, description: "Amazon Tokenized Equity" },
  AMZNUSDT: { symbol: "AMZNUSDT", sector: "E_COMMERCE_CLOUD", beta: 1.25, description: "Amazon Futures" },
  BTCUSDT: { symbol: "BTCUSDT", sector: "DIGITAL_ASSET", beta: 0.40, description: "Bitcoin Perpetual Futures" },
};

/**
 * Canonical empirical correlation matrix between universe assets.
 * Symmetric, bounded [-1, 1]. Defaults to 0.50 for unlisted cross pairs.
 */
export const DEFAULT_CORRELATION_MATRIX: Record<string, Record<string, number>> = {
  NVDA: { NVDA: 1.0, TSLA: 0.52, AAPL: 0.62, MSFT: 0.68, AMZN: 0.65, BTC: 0.35 },
  TSLA: { NVDA: 0.52, TSLA: 1.0, AAPL: 0.45, MSFT: 0.48, AMZN: 0.50, BTC: 0.38 },
  AAPL: { NVDA: 0.62, TSLA: 0.45, AAPL: 1.0, MSFT: 0.70, AMZN: 0.68, BTC: 0.30 },
  MSFT: { NVDA: 0.68, TSLA: 0.48, AAPL: 0.70, MSFT: 1.0, AMZN: 0.74, BTC: 0.32 },
  AMZN: { NVDA: 0.65, TSLA: 0.50, AAPL: 0.68, MSFT: 0.74, AMZN: 1.0, BTC: 0.33 },
  BTC:  { NVDA: 0.35, TSLA: 0.38, AAPL: 0.30, MSFT: 0.32, AMZN: 0.33, BTC: 1.0 },
};

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

function normalizeBaseSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  const m = /^R?([A-Z0-9]+)USDT$/i.exec(s);
  return m?.[1] ?? s;
}

export function getAssetProfile(
  symbol: string,
  customProfiles?: Record<string, AssetFactorProfile>,
): AssetFactorProfile {
  const norm = normalizeBaseSymbol(symbol);
  if (customProfiles?.[symbol]) return customProfiles[symbol];
  if (customProfiles?.[norm]) return customProfiles[norm];

  const matched =
    DEFAULT_ASSET_PROFILES[symbol] ??
    DEFAULT_ASSET_PROFILES[`r${norm}USDT`] ??
    DEFAULT_ASSET_PROFILES[`${norm}USDT`];
  if (matched) return matched;

  return {
    symbol,
    sector: "UNASSIGNED",
    beta: 1.0,
    description: `Generic factor profile for ${symbol}`,
  };
}

export function getPairwiseCorrelation(
  symA: string,
  symB: string,
  customMatrix?: Record<string, Record<string, number>>,
): number {
  const a = normalizeBaseSymbol(symA);
  const b = normalizeBaseSymbol(symB);
  if (a === b) return 1.0;

  const matrix = customMatrix ?? DEFAULT_CORRELATION_MATRIX;
  if (matrix[a]?.[b] !== undefined) return matrix[a][b];
  if (matrix[b]?.[a] !== undefined) return matrix[b][a];
  return 0.50; // Neutral default
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Calculates current or projected portfolio metrics.
 */
export function calculatePortfolioMetrics(
  positions: PortfolioPosition[],
  equityUsd: number,
  customProfiles?: Record<string, AssetFactorProfile>,
  customMatrix?: Record<string, Record<string, number>>,
): PortfolioMetrics {
  let netBetaWeightedSum = 0;
  let totalGrossExposureUsd = 0;
  const assetWeights: Record<string, number> = {};
  const sectorGrossMap: Record<Sector, number> = {
    SEMICONDUCTORS: 0,
    AUTOMOTIVE_TECH: 0,
    CONSUMER_TECH: 0,
    ENTERPRISE_SOFTWARE: 0,
    E_COMMERCE_CLOUD: 0,
    DIGITAL_ASSET: 0,
    BROAD_MARKET: 0,
    UNASSIGNED: 0,
  };

  // Tally positions
  for (const pos of positions) {
    const notional = pos.quantity * pos.priceUsd;
    totalGrossExposureUsd += notional;

    const currentWeight = (assetWeights[pos.symbol] ?? 0) + notional / equityUsd;
    assetWeights[pos.symbol] = round4(currentWeight);

    const profile = getAssetProfile(pos.symbol, customProfiles);
    sectorGrossMap[profile.sector] += notional;

    const dir = pos.side === "buy" ? 1 : -1;
    netBetaWeightedSum += dir * (notional / equityUsd) * profile.beta;
  }

  const sectorWeights: Record<Sector, number> = {
    SEMICONDUCTORS: round4(sectorGrossMap.SEMICONDUCTORS / equityUsd),
    AUTOMOTIVE_TECH: round4(sectorGrossMap.AUTOMOTIVE_TECH / equityUsd),
    CONSUMER_TECH: round4(sectorGrossMap.CONSUMER_TECH / equityUsd),
    ENTERPRISE_SOFTWARE: round4(sectorGrossMap.ENTERPRISE_SOFTWARE / equityUsd),
    E_COMMERCE_CLOUD: round4(sectorGrossMap.E_COMMERCE_CLOUD / equityUsd),
    DIGITAL_ASSET: round4(sectorGrossMap.DIGITAL_ASSET / equityUsd),
    BROAD_MARKET: round4(sectorGrossMap.BROAD_MARKET / equityUsd),
    UNASSIGNED: round4(sectorGrossMap.UNASSIGNED / equityUsd),
  };

  // Tally pairwise correlation exposure (rho >= 0.70 in same direction)
  let correlatedExposureUsd = 0;
  const correlatedPairs: string[] = [];
  const activePositions = positions.filter((p) => p.quantity > 0);

  for (let i = 0; i < activePositions.length; i++) {
    for (let j = i + 1; j < activePositions.length; j++) {
      const p1 = activePositions[i]!;
      const p2 = activePositions[j]!;
      if (p1.symbol === p2.symbol) continue;
      // High correlation matters primarily when pointing in the same direction
      if (p1.side === p2.side) {
        const rho = getPairwiseCorrelation(p1.symbol, p2.symbol, customMatrix);
        if (rho >= CORRELATION_ALERT_THRESHOLD) {
          const pairKey = `${p1.symbol}+${p2.symbol} (rho=${rho.toFixed(2)})`;
          correlatedPairs.push(pairKey);
          correlatedExposureUsd += (p1.quantity * p1.priceUsd) + (p2.quantity * p2.priceUsd);
        }
      }
    }
  }

  return {
    netBeta: round2(netBetaWeightedSum),
    totalGrossExposureUsd: round2(totalGrossExposureUsd),
    grossLeverage: round2(totalGrossExposureUsd / equityUsd),
    assetWeights,
    sectorWeights,
    correlatedExposureUsd: round2(correlatedExposureUsd),
    correlatedPairs,
  };
}

/**
 * Computes projected positions resulting from a trade.
 * Handles adding to existing exposure, reducing exposure, or reversing position.
 */
export function projectPositions(
  currentPositions: PortfolioPosition[],
  trade: TradeImpactRequest,
): PortfolioPosition[] {
  const result: PortfolioPosition[] = [];
  let found = false;

  for (const pos of currentPositions) {
    if (pos.symbol !== trade.symbol) {
      result.push({ ...pos });
      continue;
    }

    found = true;
    if (pos.side === trade.side) {
      // Adding in same direction
      const newQty = round4(pos.quantity + trade.quantity);
      result.push({
        symbol: pos.symbol,
        side: pos.side,
        quantity: newQty,
        priceUsd: trade.priceUsd,
      });
    } else {
      // Opposite side: reduction or reversal
      if (trade.quantity < pos.quantity) {
        // Partial reduction
        const remainingQty = round4(pos.quantity - trade.quantity);
        result.push({
          symbol: pos.symbol,
          side: pos.side,
          quantity: remainingQty,
          priceUsd: trade.priceUsd,
        });
      } else if (trade.quantity > pos.quantity) {
        // Position reversal
        const flipQty = round4(trade.quantity - pos.quantity);
        result.push({
          symbol: pos.symbol,
          side: trade.side,
          quantity: flipQty,
          priceUsd: trade.priceUsd,
        });
      }
      // If trade.quantity === pos.quantity, position is closed (flattened, omitted)
    }
  }

  if (!found) {
    result.push({
      symbol: trade.symbol,
      side: trade.side,
      quantity: trade.quantity,
      priceUsd: trade.priceUsd,
    });
  }

  return result.filter((p) => p.quantity > 0);
}

// ---------------------------------------------------------------------------
// Main Evaluation Entrypoint
// ---------------------------------------------------------------------------

export interface PortfolioCopilotLimits {
  maxSingleAssetConcentration?: number;
  maxSectorConcentration?: number;
  maxPortfolioNetBeta?: number;
}

export const PortfolioCopilot = {
  /**
   * Evaluates the portfolio-level factor, sector, and concentration blast radius
   * of a proposed trade. Returns deterministic APPROVED or HARD_VETO.
   */
  evaluateImpact(
    tradeRequest: TradeImpactRequest,
    portfolioState: PortfolioState,
    limits?: PortfolioCopilotLimits,
    customProfiles?: Record<string, AssetFactorProfile>,
    customMatrix?: Record<string, Record<string, number>>,
  ): PortfolioRiskAssessment {
    const trade = TradeImpactRequestSchema.parse(tradeRequest);
    const portfolio = PortfolioStateSchema.parse(portfolioState);

    const maxAssetLimit = limits?.maxSingleAssetConcentration ?? MAX_SINGLE_ASSET_CONCENTRATION;
    const maxSectorLimit = limits?.maxSectorConcentration ?? MAX_SECTOR_CONCENTRATION;
    const maxBetaLimit = limits?.maxPortfolioNetBeta ?? MAX_PORTFOLIO_NET_BETA;

    const currentMetrics = calculatePortfolioMetrics(
      portfolio.positions,
      portfolio.equityUsd,
      customProfiles,
      customMatrix,
    );

    const projectedPositionsList = projectPositions(portfolio.positions, trade);
    const projectedMetrics = calculatePortfolioMetrics(
      projectedPositionsList,
      portfolio.equityUsd,
      customProfiles,
      customMatrix,
    );

    const reasons: string[] = [];
    const warnings: string[] = [];

    // Helper: is this trade de-risking the target asset?
    const currentAssetWeight = currentMetrics.assetWeights[trade.symbol] ?? 0;
    const projectedAssetWeight = projectedMetrics.assetWeights[trade.symbol] ?? 0;
    const isReducingAsset = projectedAssetWeight < currentAssetWeight;

    // R4: Single-asset concentration check
    if (projectedAssetWeight > maxAssetLimit) {
      if (!isReducingAsset) {
        reasons.push(
          `HARD_VETO: projected single-asset concentration ${(projectedAssetWeight * 100).toFixed(1)}% ` +
            `in ${trade.symbol} exceeds ${(maxAssetLimit * 100).toFixed(1)}% ceiling`,
        );
      } else {
        warnings.push(
          `DE_RISKING: ${trade.symbol} concentration remains high (${(projectedAssetWeight * 100).toFixed(1)}%), ` +
            `but trade reduced exposure from ${(currentAssetWeight * 100).toFixed(1)}%. Permitted.`,
        );
      }
    } else if (projectedAssetWeight >= maxAssetLimit * 0.75) {
      warnings.push(
        `CONCENTRATION_WARNING: ${trade.symbol} projected at ${(projectedAssetWeight * 100).toFixed(1)}% ` +
          `(approaching ${(maxAssetLimit * 100).toFixed(1)}% ceiling).`,
      );
    }

    // R5: Sector concentration check
    const tradeProfile = getAssetProfile(trade.symbol, customProfiles);
    const currentSectorWeight = currentMetrics.sectorWeights[tradeProfile.sector] ?? 0;
    const projectedSectorWeight = projectedMetrics.sectorWeights[tradeProfile.sector] ?? 0;
    const isReducingSector = projectedSectorWeight < currentSectorWeight;

    if (projectedSectorWeight > maxSectorLimit) {
      if (!isReducingSector) {
        reasons.push(
          `HARD_VETO: projected sector concentration ${(projectedSectorWeight * 100).toFixed(1)}% ` +
            `in ${tradeProfile.sector} exceeds ${(maxSectorLimit * 100).toFixed(1)}% ceiling`,
        );
      } else {
        warnings.push(
          `DE_RISKING: ${tradeProfile.sector} sector concentration remains elevated (${(projectedSectorWeight * 100).toFixed(1)}%), ` +
            `but trade reduced sector exposure from ${(currentSectorWeight * 100).toFixed(1)}%. Permitted.`,
        );
      }
    }

    // R6: Net beta ceiling check
    const currentBetaAbs = Math.abs(currentMetrics.netBeta);
    const projectedBetaAbs = Math.abs(projectedMetrics.netBeta);
    const isReducingBeta = projectedBetaAbs < currentBetaAbs;

    if (projectedBetaAbs > maxBetaLimit) {
      if (!isReducingBeta) {
        reasons.push(
          `HARD_VETO: projected net market beta magnitude ${projectedBetaAbs.toFixed(2)} ` +
            `exceeds ${maxBetaLimit.toFixed(2)} ceiling`,
        );
      } else {
        warnings.push(
          `DE_RISKING: net beta magnitude remains high (${projectedBetaAbs.toFixed(2)}), ` +
            `but trade reduced beta from ${currentBetaAbs.toFixed(2)}. Permitted.`,
        );
      }
    }

    // C1: Correlation alerts
    if (projectedMetrics.correlatedPairs.length > 0) {
      warnings.push(
        `CORRELATION_ALERT: high pairwise correlation detected across holdings: ` +
          projectedMetrics.correlatedPairs.join(", ") +
          ` ($${projectedMetrics.correlatedExposureUsd.toFixed(2)} correlated notional).`,
      );
    }

    const decision = reasons.length > 0 ? "HARD_VETO" : "APPROVED";

    return PortfolioRiskAssessmentSchema.parse({
      decision,
      reasons,
      warnings,
      currentMetrics,
      projectedMetrics,
      deltas: {
        netBetaDelta: round2(projectedMetrics.netBeta - currentMetrics.netBeta),
        exposureDeltaUsd: round2(projectedMetrics.totalGrossExposureUsd - currentMetrics.totalGrossExposureUsd),
      },
    });
  },
};
