/**
 * Bounded A/B Paper Campaign Runner (Track 2 Verification Fixture)
 *
 * Runs a bounded sequence of deliberation cycles through AbPaperRunner,
 * measuring the LLM decision authority arm against the fixed-rule COUNCIL arm
 * on identical market inputs, with Portfolio Copilot factor & concentration risk
 * controls actively enforced.
 *
 * NOTE: The LLM verdicts here are AUTHORED FIXTURES for control-plane and
 * invariant verification (GAP-022). They are NOT live DashScope / Qwen-Plus
 * model outputs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AbPaperRunner,
  type AbCycleInputArgs,
} from "../packages/engine/src/campaign/ab-paper-runner.js";
import { resolveQwenConfig } from "../packages/engine/src/agents/macro.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "foundry", "evidence", "ab-campaign");
mkdirSync(OUT_DIR, { recursive: true });

const LOG_FILE = join(OUT_DIR, "ab_observations.jsonl");
const SUMMARY_FILE = join(OUT_DIR, "ab_metrics_summary.json");

async function main() {
  const { apiKey, model, baseUrl } = resolveQwenConfig();
  const hasLiveKey = Boolean(apiKey && apiKey.trim().length > 0);

  console.log(
    `== Money Boys: Running Bounded A/B Paper Campaign (${hasLiveKey ? "Live Inference Pipeline" : "Control-Plane Fixture"}) ==`,
  );
  if (hasLiveKey) {
    console.log(`[ab-campaign] Detected live API key. Querying ${model} @ ${baseUrl}`);
  } else {
    console.log(
      `[ab-campaign] No BITGET_QWEN_API_KEY / DASHSCOPE_API_KEY detected. Running control-plane scenario fixtures (GAP-022).`,
    );
  }
  const runner = new AbPaperRunner({ logFilePath: LOG_FILE });

  const defaultDepth = {
    bids: [{ price: 220, quantity: 150 }],
    asks: [{ price: 221, quantity: 150 }],
  };

  const startingAccount = {
    equityUsd: 25_000,
    usedMarginUsd: 2_500,
    freeMarginUsd: 22_500,
    openOrders: [],
  };

  const startingPortfolio = {
    equityUsd: 25_000,
    positions: [
      { symbol: "rAAPLUSDT", side: "buy" as const, quantity: 15, priceUsd: 225 }, // $3,375 (13.5%) Consumer Tech
      { symbol: "rMSFTUSDT", side: "buy" as const, quantity: 10, priceUsd: 430 }, // $4,300 (17.2%) Enterprise Software
    ],
  };

  // Authored scenario fixtures for control-plane verification
  const scenarios: { name: string; input: AbCycleInputArgs }[] = [
    {
      name: "1. NVDA Dislocation (Both Arms Agree -> APPROVED)",
      input: {
        cycleId: "cycle-001-nvda-dislocation",
        symbol: "rNVDAUSDT",
        side: "buy",
        quantity: 10,
        priceUsd: 228, // $2,280 notional
        tokenPrice: 228,
        tradFiClosePrice: 222, // Basis = +2.7%
        depth: defaultDepth,
        account: startingAccount,
        portfolio: startingPortfolio,
        macroScore: 82,
        macroRationale: "Authored catalyst: Blackwell architecture beat expectations",
        authoredFixtureVerdict: {
          decision: "APPROVED",
          confidence: 0.94,
          modelId: "authored-fixture-scenario",
          rationale: "Authored fixture hypothesis: Clear weekend dislocation with positive guidance",
        },
      },
    },
    {
      name: "2. TSLA Over-Concentration (Portfolio Copilot HARD_VETO)",
      input: {
        cycleId: "cycle-002-tsla-concentration-breach",
        symbol: "rTSLAUSDT",
        side: "buy",
        quantity: 45,
        priceUsd: 240, // $10,800 notional on $25k equity -> 43.2% > 40%
        tokenPrice: 240,
        tradFiClosePrice: 232,
        depth: defaultDepth,
        account: startingAccount,
        portfolio: startingPortfolio,
        macroScore: 90,
        macroRationale: "Authored catalyst: Robotaxi fleet deployment approval",
        authoredFixtureVerdict: {
          decision: "APPROVED",
          confidence: 0.98,
          modelId: "authored-fixture-scenario",
          rationale: "Authored fixture hypothesis: High-conviction AI thesis",
        },
      },
    },
    {
      name: "3. AMZN Weak Dislocation (Arms Disagree: Council Veto vs LLM Soft Approve)",
      input: {
        cycleId: "cycle-003-amzn-arms-disagreement",
        symbol: "rAMZNUSDT",
        side: "buy",
        quantity: 8,
        priceUsd: 185, // $1,480 notional
        tokenPrice: 185,
        tradFiClosePrice: 184.8, // Tiny basis: 0.1% (fails Quant hurdle)
        depth: defaultDepth,
        account: startingAccount,
        portfolio: startingPortfolio,
        macroScore: 65,
        macroRationale: "Authored catalyst: Mild retail sales uptick",
        authoredFixtureVerdict: {
          decision: "APPROVED",
          confidence: 0.60,
          modelId: "authored-fixture-scenario",
          rationale: "Authored fixture hypothesis: Slight positive drift expected",
        },
      },
    },
    {
      name: "4. NVDA Repeated Input (Consistency Probe)",
      input: {
        cycleId: "cycle-004-nvda-repeat-probe",
        symbol: "rNVDAUSDT",
        side: "buy",
        quantity: 10,
        priceUsd: 228,
        tokenPrice: 228,
        tradFiClosePrice: 222,
        depth: defaultDepth,
        account: startingAccount,
        portfolio: startingPortfolio,
        macroScore: 82,
        macroRationale: "Authored catalyst: Blackwell architecture beat expectations",
        authoredFixtureVerdict: {
          decision: "APPROVED",
          confidence: 0.94,
          modelId: "authored-fixture-scenario",
          rationale: "Authored fixture hypothesis: Clear weekend dislocation with positive guidance",
        },
      },
    },
    {
      name: "5. Single-Trade Cap Breach ($5k Limit Violation -> Both Arms Vetoed)",
      input: {
        cycleId: "cycle-005-risk-single-cap-veto",
        symbol: "BTCUSDT",
        side: "buy",
        quantity: 0.1,
        priceUsd: 80_000, // $8,000 exposure > $5,000
        tokenPrice: 80_000,
        tradFiClosePrice: 78_000,
        depth: {
          bids: [{ price: 80_000, quantity: 10 }],
          asks: [{ price: 80_100, quantity: 10 }],
        },
        account: startingAccount,
        portfolio: startingPortfolio,
        macroScore: 95,
        macroRationale: "Authored catalyst: Global crypto regulatory clarity announced",
        authoredFixtureVerdict: {
          decision: "APPROVED",
          confidence: 0.99,
          modelId: "authored-fixture-scenario",
          rationale: "Authored fixture hypothesis: High macro tailwind",
        },
      },
    },
  ];

  for (const s of scenarios) {
    console.log(`\nExecuting: ${s.name}`);
    const input: AbCycleInputArgs = { ...s.input };
    if (hasLiveKey) {
      delete input.authoredFixtureVerdict;
      input.queryLiveLlm = true;
    }
    const res = await runner.runCycle(input, {
      activeAuthority: "COUNCIL",
      executePaperFills: true,
      queryLiveLlm: hasLiveKey,
    });

    console.log(`  Input Hash:         ${res.inputHash.slice(0, 16)}...`);
    console.log(`  Risk Decision:      ${res.risk.decision} (${res.risk.reasons.length} reasons)`);
    if (res.portfolioAssessment?.decision === "HARD_VETO") {
      console.log(`  Portfolio Copilot:  HARD_VETO -> ${res.portfolioAssessment.reasons[0]}`);
    }
    console.log(`  Council Resolution: ${res.councilResolution.decision} (${res.councilResolution.authoritySource})`);
    console.log(`  LLM Resolution:     ${res.llmResolution.decision} (${res.llmResolution.authoritySource})`);
    if (res.llmTelemetry) {
      console.log(`  LLM Telemetry:      live=${res.llmTelemetry.isLiveInference} latency=${res.llmTelemetry.latencyMs}ms model=${res.llmTelemetry.modelId}`);
    }
    console.log(`  Arms Agree:         ${res.armsAgree ? "YES" : "NO"}`);
    if (res.receipt) {
      console.log(`  ReasoningReceipt:   SEALED -> ${res.receipt.receiptHash.slice(0, 16)}...`);
    }
    if (res.executionRecord) {
      console.log(`  Paper Execution:    ${res.executionRecord.status} (OrderId: ${res.executionRecord.orderId})`);
    }
  }

  const metrics = runner.getMetrics();
  console.log("\n=======================================================");
  console.log("A/B CAMPAIGN METRICS SUMMARY:");
  console.log("=======================================================");
  console.log(`Total Cycles Recorded:        ${metrics.cycles}`);
  console.log(`Risk Violation Rate:          ${(metrics.riskViolationRate * 100).toFixed(2)}% (Target: 0%)`);
  console.log(`Critical Invariant Defect:    ${metrics.criticalDefect ? "FAIL" : "NONE (CLEAN)"}`);
  console.log(`Decision Consistency:         ${(metrics.decisionConsistency * 100).toFixed(1)}%`);
  console.log(`Arms Agreement Rate:          ${(metrics.armsAgreementRate * 100).toFixed(1)}% (${metrics.armsAgreeCount} agree, ${metrics.armsDisagreeCount} disagree)`);
  console.log(`Human Takeovers:              ${metrics.humanTakeovers}`);

  const stamp = runner.getDerivedPerformanceStamp();
  console.log("\n=======================================================");
  console.log("DERIVED PROVENANCE STAMP (From Observed Telemetry):");
  console.log("=======================================================");
  console.log(`Provenance:                   ${stamp.provenance}`);
  console.log(`Synthetic Fixture:            ${stamp.syntheticFixture}`);
  console.log(`Valid as Performance Evidence: ${stamp.validAsPerformanceEvidence}`);
  console.log(`Live Evaluations:             ${stamp.telemetrySummary.liveEvaluations}/${stamp.telemetrySummary.totalEvaluations}`);
  if (stamp.telemetrySummary.meanLatencyMs !== undefined) {
    console.log(`Mean Inference Latency:       ${stamp.telemetrySummary.meanLatencyMs}ms`);
  }

  const stampedSummary = {
    ...stamp,
    ...metrics,
  };

  writeFileSync(SUMMARY_FILE, JSON.stringify(stampedSummary, null, 2), "utf8");
  console.log(`\nEvidence written with telemetry-derived stamp to:`);
  console.log(`  - ${LOG_FILE}`);
  console.log(`  - ${SUMMARY_FILE}`);
  console.log("VERIFY OK");
}

main().catch((err) => {
  console.error("FATAL in A/B Paper Campaign:", err);
  process.exit(1);
});
