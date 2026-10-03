import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AbPaperRunner, type AbCycleInputArgs } from "../src/campaign/ab-paper-runner.js";
import { verifyReceipt } from "../src/council/receipts.js";

describe("AbPaperRunner (Track 2 Autonomous A/B Evaluation)", () => {
  const defaultDepth = {
    bids: [{ price: 200, quantity: 100 }],
    asks: [{ price: 201, quantity: 100 }],
  };

  const defaultAccount = {
    equityUsd: 10_000,
    usedMarginUsd: 1_000,
    freeMarginUsd: 9_000,
    openOrders: [],
  };

  const baseInput: AbCycleInputArgs = {
    symbol: "rNVDAUSDT",
    side: "buy",
    quantity: 5,
    priceUsd: 200, // $1,000 exposure
    tokenPrice: 200,
    tradFiClosePrice: 195, // Dislocation: (200 - 195) / 195 = +2.56%
    depth: defaultDepth,
    account: defaultAccount,
    macroScore: 85,
    macroRationale: "Strong GPU data center earnings catalyst",
    llmVerdict: {
      decision: "APPROVED",
      confidence: 0.92,
      modelId: "qwen-plus-0925",
      rationale: "Clear weekend dislocation with fresh benchmark and positive guidance",
    },
  };

  it("1. runs dual-arm cycle: both arms evaluate identical input hash", async () => {
    const runner = new AbPaperRunner();
    const result = await runner.runCycle(baseInput, { activeAuthority: "COUNCIL" });

    assert.ok(result.inputHash && result.inputHash.length === 64);
    assert.equal(result.observations.length, 2);
    assert.equal(result.observations[0]!.inputHash, result.inputHash);
    assert.equal(result.observations[1]!.inputHash, result.inputHash);
    assert.equal(result.observations[0]!.authority, "COUNCIL");
    assert.equal(result.observations[1]!.authority, "LLM");
  });

  it("2. enforces absolute Risk Veto: neither arm can approve when risk permits = false", async () => {
    const runner = new AbPaperRunner();

    // Breaches $5,000 single-trade cap: 30 * 200 = $6,000
    const vetoInput: AbCycleInputArgs = {
      ...baseInput,
      quantity: 30,
      priceUsd: 200,
      llmVerdict: {
        decision: "APPROVED",
        confidence: 0.99,
        modelId: "qwen-plus-0925",
        rationale: "Model wants to take high leverage trade",
      },
    };

    const result = await runner.runCycle(vetoInput, { activeAuthority: "LLM" });

    // Despite LLM verdict being APPROVED, the Risk Boy HARD_VETO terminates execution
    assert.equal(result.risk.decision, "HARD_VETO");
    assert.equal(result.councilResolution.decision, "VETOED");
    assert.equal(result.llmResolution.decision, "VETOED");
    assert.equal(result.llmResolution.authoritySource, "RISK_VETO");
    assert.equal(result.activeDecision, "VETOED");
    assert.equal(result.receipt, undefined);
    assert.equal(result.executionRecord, undefined);

    const metrics = runner.getMetrics();
    assert.equal(metrics.riskViolationRate, 0);
    assert.equal(metrics.riskViolations, 0);
    assert.equal(metrics.criticalDefect, false);
  });

  it("3. executes PAPER dispatch with verified receipt when active arm approves", async () => {
    const runner = new AbPaperRunner();
    const result = await runner.runCycle(baseInput, {
      activeAuthority: "COUNCIL",
      executePaperFills: true,
    });

    assert.equal(result.activeDecision, "APPROVED");
    assert.ok(result.receipt);
    assert.equal(verifyReceipt(result.receipt), true);
    assert.ok(result.executionRecord);
    assert.equal(result.executionRecord.status, "FILLED");
    assert.equal(result.executionRecord.mode, "PAPER");
    assert.equal(result.executionRecord.symbol, "rNVDAUSDT");
    assert.equal(result.executionRecord.quantity, 5);
  });

  it("4. tracks disagreement when Council approves but LLM vetoes", async () => {
    const runner = new AbPaperRunner();
    const disagreeInput: AbCycleInputArgs = {
      ...baseInput,
      llmVerdict: {
        decision: "VETOED",
        confidence: 0.88,
        modelId: "qwen-plus-0925",
        rationale: "Model detects geopolitical risk in filings",
      },
    };

    const result = await runner.runCycle(disagreeInput, { activeAuthority: "LLM" });

    assert.equal(result.councilResolution.decision, "APPROVED");
    assert.equal(result.llmResolution.decision, "VETOED");
    assert.equal(result.armsAgree, false);
    // Since active arm is LLM, it follows LLM and does not execute
    assert.equal(result.activeDecision, "VETOED");
    assert.equal(result.receipt, undefined);

    const metrics = runner.getMetrics();
    assert.equal(metrics.armsDisagreeCount, 2); // 1 observation per arm
    assert.equal(metrics.armsAgreeCount, 0);
    assert.equal(metrics.riskViolationRate, 0);
  });

  it("5. measures decision consistency across repeated identical inputs", async () => {
    const runner = new AbPaperRunner();

    // Run identical input 3 times
    for (let i = 0; i < 3; i++) {
      await runner.runCycle({
        ...baseInput,
        cycleId: `repeat-${i}`,
      });
    }

    const metrics = runner.getMetrics();
    assert.equal(metrics.cycles, 6); // 3 cycles * 2 arms
    assert.ok(metrics.decisionConsistency > 0);
    assert.equal(metrics.riskViolationRate, 0);
  });

  it("6. integrates Portfolio Copilot to veto on concentration breach", async () => {
    const runner = new AbPaperRunner();

    const concentratedPortfolio = {
      equityUsd: 10_000,
      positions: [
        { symbol: "rNVDAUSDT", side: "buy" as const, quantity: 15, priceUsd: 200 }, // $3,000 (30%)
      ],
    };

    // Proposing: Buy $2,000 more NVDA -> pushes concentration to 50% > 40%
    const result = await runner.runCycle({
      ...baseInput,
      quantity: 10,
      priceUsd: 200,
      portfolio: concentratedPortfolio,
    });

    assert.equal(result.risk.decision, "HARD_VETO");
    assert.ok(result.portfolioAssessment);
    assert.equal(result.portfolioAssessment.decision, "HARD_VETO");
    assert.ok(result.risk.reasons.some((r) => r.includes("single-asset concentration 50.0%")));
    assert.equal(result.activeDecision, "VETOED");
  });
});
