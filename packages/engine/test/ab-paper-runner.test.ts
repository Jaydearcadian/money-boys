import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AbPaperRunner,
  queryLiveLlmVerdict,
  derivePerformanceStamp,
  type AbCycleInputArgs,
  type LlmInferenceTelemetry,
} from "../src/campaign/ab-paper-runner.js";
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

  it("7. queryLiveLlmVerdict parses gateway response with latency and sha256 telemetry", async () => {
    const mockPayload = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              decision: "APPROVED",
              confidence: 0.88,
              modelId: "qwen3.8-max",
              rationale: "Clean basis dislocation above funding hurdle with bullish macro catalyst",
            }),
          },
        },
      ],
    };

    const mockFetch: typeof fetch = async () =>
      new Response(JSON.stringify(mockPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const res = await queryLiveLlmVerdict(
      {
        symbol: "rNVDAUSDT",
        side: "buy",
        quantity: 10,
        priceUsd: 228,
        basisPct: 2.7,
        macroScore: 82,
        macroRationale: "Blackwell chip delivery acceleration",
      },
      {
        fetchImpl: mockFetch,
        config: { baseUrl: "https://hackathon.bitgetops.com/v1", model: "qwen3.8-max", apiKey: "mock-key" },
      },
    );

    assert.equal(res.verdict.decision, "APPROVED");
    assert.equal(res.verdict.confidence, 0.88);
    assert.equal(res.verdict.modelId, "qwen3.8-max");
    assert.equal(res.telemetry.isLiveInference, true);
    assert.ok(res.telemetry.latencyMs >= 0);
    assert.ok(res.telemetry.responseHash && /^[0-9a-f]{64}$/.test(res.telemetry.responseHash));
    assert.equal(res.telemetry.endpoint, "https://hackathon.bitgetops.com/v1");
  });

  it("8. queryLiveLlmVerdict handles missing API key, HTTP errors and invalid JSON fail-closed", async () => {
    // 1. Missing API key
    const noKey = await queryLiveLlmVerdict(
      { symbol: "rNVDAUSDT", side: "buy", quantity: 1, priceUsd: 200 },
      { config: { baseUrl: "https://mock", model: "qwen", apiKey: "" } },
    );
    assert.equal(noKey.verdict.decision, "VETOED");
    assert.equal(noKey.telemetry.isLiveInference, false);
    assert.equal(noKey.telemetry.error, "Missing API key");

    // 2. HTTP 500 error
    const http500Fetch: typeof fetch = async () => new Response("Gateway error", { status: 500 });
    const httpError = await queryLiveLlmVerdict(
      { symbol: "rNVDAUSDT", side: "buy", quantity: 1, priceUsd: 200 },
      { fetchImpl: http500Fetch, config: { baseUrl: "https://mock", model: "qwen", apiKey: "key" } },
    );
    assert.equal(httpError.verdict.decision, "VETOED");
    assert.equal(httpError.telemetry.isLiveInference, false);
    assert.ok(httpError.telemetry.error?.includes("500"));

    // 3. Malformed JSON
    const malformedFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "not valid json at all" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const malformed = await queryLiveLlmVerdict(
      { symbol: "rNVDAUSDT", side: "buy", quantity: 1, priceUsd: 200 },
      { fetchImpl: malformedFetch, config: { baseUrl: "https://mock", model: "qwen", apiKey: "key" } },
    );
    assert.equal(malformed.verdict.decision, "VETOED");
    assert.equal(malformed.telemetry.isLiveInference, false);
    assert.ok(malformed.telemetry.error?.includes("not valid JSON"));
  });

  it("9. derivePerformanceStamp strictly derives provenance from observed telemetry", () => {
    // Empty -> ALL_SYNTHETIC
    const emptyStamp = derivePerformanceStamp([]);
    assert.equal(emptyStamp.syntheticFixture, true);
    assert.equal(emptyStamp.validAsPerformanceEvidence, false);
    assert.equal(emptyStamp.provenance, "ALL_SYNTHETIC");

    // All fixtures -> ALL_SYNTHETIC
    const fixtureTelemetry: LlmInferenceTelemetry[] = [
      { isLiveInference: false, latencyMs: 0, modelId: "authored-fixture-scenario" },
      { isLiveInference: false, latencyMs: 0, modelId: "authored-fixture-scenario" },
    ];
    const fixtureStamp = derivePerformanceStamp(fixtureTelemetry);
    assert.equal(fixtureStamp.syntheticFixture, true);
    assert.equal(fixtureStamp.validAsPerformanceEvidence, false);
    assert.equal(fixtureStamp.provenance, "ALL_SYNTHETIC");
    assert.equal(fixtureStamp.telemetrySummary.liveEvaluations, 0);

    // Genuine live records
    const liveTelemetry: LlmInferenceTelemetry[] = [
      {
        isLiveInference: true,
        latencyMs: 145,
        modelId: "qwen3.8-max",
        responseHash: "a".repeat(64),
      },
      {
        isLiveInference: true,
        latencyMs: 160,
        modelId: "qwen3.8-max",
        responseHash: "b".repeat(64),
      },
    ];
    const liveStamp = derivePerformanceStamp(liveTelemetry);
    assert.equal(liveStamp.syntheticFixture, false);
    assert.equal(liveStamp.validAsPerformanceEvidence, true);
    assert.equal(liveStamp.provenance, "LIVE_INFERENCE");
    assert.equal(liveStamp.telemetrySummary.liveEvaluations, 2);
    assert.equal(liveStamp.telemetrySummary.meanLatencyMs, 153);

    // Mixed -> PARTIAL_LIVE
    const mixedStamp = derivePerformanceStamp([...fixtureTelemetry, ...liveTelemetry]);
    assert.equal(mixedStamp.syntheticFixture, true);
    assert.equal(mixedStamp.validAsPerformanceEvidence, false);
    assert.equal(mixedStamp.provenance, "PARTIAL_LIVE");
    assert.equal(mixedStamp.telemetrySummary.liveEvaluations, 2);
    assert.equal(mixedStamp.telemetrySummary.syntheticEvaluations, 2);
  });

  it("10. derivePerformanceStamp invariant: refuses live status if latency is 0 or model is fixture", () => {
    // Attacking claim: claim isLiveInference: true but latency is 0
    const zeroLatencyTelemetry: LlmInferenceTelemetry[] = [
      {
        isLiveInference: true,
        latencyMs: 0,
        modelId: "qwen3.8-max",
        responseHash: "c".repeat(64),
      },
    ];
    const s1 = derivePerformanceStamp(zeroLatencyTelemetry);
    assert.equal(s1.validAsPerformanceEvidence, false);
    assert.equal(s1.provenance, "ALL_SYNTHETIC");

    // Attacking claim: claim isLiveInference: true with >0 latency, but modelId is fixture
    const fakeModelTelemetry: LlmInferenceTelemetry[] = [
      {
        isLiveInference: true,
        latencyMs: 100,
        modelId: "authored-fixture-scenario",
        responseHash: "d".repeat(64),
      },
    ];
    const s2 = derivePerformanceStamp(fakeModelTelemetry);
    assert.equal(s2.validAsPerformanceEvidence, false);
    assert.equal(s2.provenance, "ALL_SYNTHETIC");
  });

  it("11. AbPaperRunner runs cycle with queryLiveLlm=true using mock fetch and records live telemetry", async () => {
    const mockPayload = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              decision: "APPROVED",
              confidence: 0.95,
              modelId: "qwen3.8-max",
              rationale: "Live approved from mock endpoint",
            }),
          },
        },
      ],
    };

    const mockFetch: typeof fetch = async () =>
      new Response(JSON.stringify(mockPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const runner = new AbPaperRunner();
    process.env["BITGET_QWEN_API_KEY"] = "mock-key";
    try {
      const res = await runner.runCycle(
        {
          ...baseInput,
          llmVerdict: undefined,
          authoredFixtureVerdict: undefined,
          queryLiveLlm: true,
        },
        {
          activeAuthority: "LLM",
          fetchImpl: mockFetch,
          queryLiveLlm: true,
        },
      );

      assert.equal(res.activeDecision, "APPROVED");
      assert.ok(res.llmTelemetry);
      assert.equal(res.llmTelemetry.isLiveInference, true);
      assert.equal(res.llmTelemetry.modelId, "qwen3.8-max");

      const stamp = runner.getDerivedPerformanceStamp();
      assert.equal(stamp.provenance, "LIVE_INFERENCE");
      assert.equal(stamp.validAsPerformanceEvidence, true);
    } finally {
      delete process.env["BITGET_QWEN_API_KEY"];
    }
  });
});
