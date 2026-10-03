import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PortfolioCopilot,
  calculatePortfolioMetrics,
  projectPositions,
  MAX_SINGLE_ASSET_CONCENTRATION,
  MAX_SECTOR_CONCENTRATION,
  MAX_PORTFOLIO_NET_BETA,
} from "../src/skills/igraph-guard/portfolio-copilot.js";
import { StructuralChangeGuard } from "../src/skills/igraph-guard/security.js";

describe("PortfolioCopilot (Track 3 Open Theme)", () => {
  const basePortfolio = {
    equityUsd: 10_000,
    positions: [
      { symbol: "rAAPLUSDT", side: "buy" as const, quantity: 10, priceUsd: 200 }, // $2,000 (20%) Consumer Tech, beta 1.05
      { symbol: "rMSFTUSDT", side: "buy" as const, quantity: 5, priceUsd: 400 },  // $2,000 (20%) Enterprise Software, beta 1.15
    ],
  };

  it("1. approves a safe diversified trade within all concentration and beta limits", () => {
    // Proposing: Buy $1,000 NVDA (10% asset conc, 10% sector conc)
    const result = PortfolioCopilot.evaluateImpact(
      { symbol: "rNVDAUSDT", side: "buy", quantity: 5, priceUsd: 200 },
      basePortfolio,
    );

    assert.equal(result.decision, "APPROVED");
    assert.deepEqual(result.reasons, []);
    assert.equal(result.projectedMetrics.assetWeights["rNVDAUSDT"], 0.1);
    assert.equal(result.projectedMetrics.sectorWeights["SEMICONDUCTORS"], 0.1);
    assert.ok(result.projectedMetrics.netBeta > 0 && result.projectedMetrics.netBeta <= MAX_PORTFOLIO_NET_BETA);
  });

  it("2. vetoes single-asset concentration breaching 40% ceiling (R4)", () => {
    // Proposing: Buy $4,500 NVDA on $10k portfolio -> 45% > 40%
    const result = PortfolioCopilot.evaluateImpact(
      { symbol: "rNVDAUSDT", side: "buy", quantity: 22.5, priceUsd: 200 },
      basePortfolio,
    );

    assert.equal(result.decision, "HARD_VETO");
    assert.ok(result.reasons.some((r) => r.includes("single-asset concentration 45.0%") && r.includes("40.0% ceiling")));
  });

  it("3. vetoes sector concentration breaching 60% ceiling (R5)", () => {
    // Starting portfolio: already has $4,000 in NVDA (Semiconductors)
    const techHeavyPortfolio = {
      equityUsd: 10_000,
      positions: [
        { symbol: "rNVDAUSDT", side: "buy" as const, quantity: 20, priceUsd: 200 }, // $4,000 (40%) Semiconductors
      ],
    };

    // Proposing: Buy another $2,500 in NVDA -> total 65% in Semiconductors > 60% ceiling
    const result = PortfolioCopilot.evaluateImpact(
      { symbol: "rNVDAUSDT", side: "buy", quantity: 12.5, priceUsd: 200 },
      techHeavyPortfolio,
    );

    assert.equal(result.decision, "HARD_VETO");
    assert.ok(result.reasons.some((r) => r.includes("sector concentration 65.0%") && r.includes("SEMICONDUCTORS")));
  });

  it("4. vetoes projected net beta exceeding 2.50 ceiling (R6)", () => {
    // TSLA has beta = 2.05, NVDA has beta = 1.75
    const leveragedPortfolio = {
      equityUsd: 5_000,
      positions: [
        { symbol: "rTSLAUSDT", side: "buy" as const, quantity: 10, priceUsd: 250 }, // $2,500 (50% eq * 2.05 = 1.025 beta contribution)
        { symbol: "rNVDAUSDT", side: "buy" as const, quantity: 10, priceUsd: 200 }, // $2,000 (40% eq * 1.75 = 0.70 beta contribution)
      ],
    };

    // Proposing: Buy $2,500 more TSLA -> pushes net beta to > 2.50
    const result = PortfolioCopilot.evaluateImpact(
      { symbol: "rTSLAUSDT", side: "buy", quantity: 10, priceUsd: 250 },
      leveragedPortfolio,
    );

    assert.equal(result.decision, "HARD_VETO");
    assert.ok(result.reasons.some((r) => r.includes("net market beta magnitude") && r.includes("2.50 ceiling")));
  });

  it("5. permits de-risking trade even if current portfolio is over-concentrated", () => {
    // Already oversized: $5,000 NVDA on $10,000 equity (50% concentration)
    const overAllocatedPortfolio = {
      equityUsd: 10_000,
      positions: [
        { symbol: "rNVDAUSDT", side: "buy" as const, quantity: 25, priceUsd: 200 },
      ],
    };

    // Selling $2,000 NVDA: reduces position to $3,000 (30% <= 40%)
    const result = PortfolioCopilot.evaluateImpact(
      { symbol: "rNVDAUSDT", side: "sell", quantity: 10, priceUsd: 200 },
      overAllocatedPortfolio,
    );

    assert.equal(result.decision, "APPROVED");
    assert.deepEqual(result.reasons, []);
    assert.equal(result.projectedMetrics.assetWeights["rNVDAUSDT"], 0.3);
  });

  it("6. surfaces correlation warning when holding correlated pairs in same direction", () => {
    // MSFT and AMZN have correlation rho = 0.74 >= 0.70
    const portfolioWithMsft = {
      equityUsd: 10_000,
      positions: [
        { symbol: "rMSFTUSDT", side: "buy" as const, quantity: 5, priceUsd: 400 }, // $2,000 MSFT
      ],
    };

    // Proposing: Buy $2,000 AMZN
    const result = PortfolioCopilot.evaluateImpact(
      { symbol: "rAMZNUSDT", side: "buy", quantity: 10, priceUsd: 200 },
      portfolioWithMsft,
    );

    assert.equal(result.decision, "APPROVED"); // Doesn't hard veto on correlation alone, but warns
    assert.ok(result.warnings.some((w) => w.includes("CORRELATION_ALERT") && w.includes("rMSFTUSDT+rAMZNUSDT")));
    assert.equal(result.projectedMetrics.correlatedExposureUsd, 4000);
  });

  it("7. correctly projects position netting and position reversal", () => {
    const positions = [
      { symbol: "BTCUSDT", side: "buy" as const, quantity: 1.0, priceUsd: 50_000 },
    ];

    // Partial close: sell 0.4
    const reduced = projectPositions(positions, { symbol: "BTCUSDT", side: "sell", quantity: 0.4, priceUsd: 50_000 });
    assert.equal(reduced.length, 1);
    assert.equal(reduced[0]!.quantity, 0.6);
    assert.equal(reduced[0]!.side, "buy");

    // Exact close: sell 1.0
    const closed = projectPositions(positions, { symbol: "BTCUSDT", side: "sell", quantity: 1.0, priceUsd: 50_000 });
    assert.equal(closed.length, 0);

    // Reversal: sell 1.5 -> short 0.5
    const reversed = projectPositions(positions, { symbol: "BTCUSDT", side: "sell", quantity: 1.5, priceUsd: 50_000 });
    assert.equal(reversed.length, 1);
    assert.equal(reversed[0]!.quantity, 0.5);
    assert.equal(reversed[0]!.side, "sell");
  });

  it("8. StructuralChangeGuard.evaluateBlastRadiusWithPortfolio unifies R1-R3 with R4-R6", () => {
    const acct = {
      equityUsd: 10_000,
      usedMarginUsd: 1_000,
      freeMarginUsd: 9_000,
      openOrders: [],
    };
    const port = {
      equityUsd: 10_000,
      positions: [
        { symbol: "rNVDAUSDT", side: "buy" as const, quantity: 15, priceUsd: 200 }, // $3,000 (30%)
      ],
    };

    // Case A: Safe trade
    const safe = StructuralChangeGuard.evaluateBlastRadiusWithPortfolio(
      { symbol: "rAAPLUSDT", side: "buy", quantity: 5, priceUsd: 200 }, // $1,000
      acct,
      port,
    );
    assert.equal(safe.decision, "APPROVED");
    assert.deepEqual(safe.reasons, []);

    // Case B: Breaches R1 single trade cap ($6,000 > $5,000)
    const r1Breach = StructuralChangeGuard.evaluateBlastRadiusWithPortfolio(
      { symbol: "rAAPLUSDT", side: "buy", quantity: 30, priceUsd: 200 }, // $6,000
      acct,
      port,
    );
    assert.equal(r1Breach.decision, "HARD_VETO");
    assert.ok(r1Breach.reasons.some((r) => r.includes("5000") || r.includes("$5,000")));

    // Case C: Breaches R4 asset concentration ($2,000 NVDA on top of $3,000 = $5,000 -> 50% > 40%)
    const r4Breach = StructuralChangeGuard.evaluateBlastRadiusWithPortfolio(
      { symbol: "rNVDAUSDT", side: "buy", quantity: 10, priceUsd: 200 }, // $2,000
      acct,
      port,
    );
    assert.equal(r4Breach.decision, "HARD_VETO");
    assert.ok(r4Breach.reasons.some((r) => r.includes("single-asset concentration 50.0%")));
  });
});
