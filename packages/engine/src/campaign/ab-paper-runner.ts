import { randomUUID, createHash } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import {
  resolveDecisionAuthority,
  type DecisionAuthority,
  type LlmVerdict,
  type AuthorityResolution,
  LlmVerdictSchema,
} from "../council/decision-authority.js";
import {
  computeAbMetrics,
  type ArmObservation,
  type AbMetrics,
  ArmObservationSchema,
} from "../council/ab-harness.js";
import {
  evaluateBasisSpread,
  type MarketDepth,
  type QuantAnalysisResult,
  MarketDepthSchema,
} from "../agents/quant.js";
import {
  StructuralChangeGuard,
  toBlastRadiusReport,
  type RiskAccount,
  type BlastRadiusResult,
  RiskAccountSchema,
  PortfolioStateSchema,
  type PortfolioState,
  type PortfolioRiskAssessment,
} from "../skills/igraph-guard/security.js";
import { evaluateExecution, type ExecutionAssessment } from "../agents/execution.js";
import { reduceCouncilVote, type CouncilDeliberationResult } from "../council/reducer.js";
import {
  sealReceipt,
  hashPayload,
  type SealedReasoningReceipt,
} from "../council/receipts.js";
import { OrderDispatcher, type ExecutionRecord } from "../bitget/dispatcher.js";
import { resolveQwenConfig } from "../agents/macro.js";

/**
 * Observed inference telemetry from the LLM arm.
 * Used to derive provenance stamps strictly from empirical behavior, never CLI flags.
 */
export interface LlmInferenceTelemetry {
  isLiveInference: boolean;
  latencyMs: number;
  modelId: string;
  responseHash?: string;
  endpoint?: string;
  error?: string;
}

export interface PerformanceStamp {
  syntheticFixture: boolean;
  validAsPerformanceEvidence: boolean;
  provenance: "ALL_SYNTHETIC" | "PARTIAL_LIVE" | "LIVE_INFERENCE";
  reason: string;
  telemetrySummary: {
    totalEvaluations: number;
    liveEvaluations: number;
    syntheticEvaluations: number;
    minLatencyMs?: number;
    maxLatencyMs?: number;
    meanLatencyMs?: number;
    modelsObserved: string[];
    responseHashesSample: string[];
  };
}

/** Strip ```json fences / surrounding prose around the first {...} block. */
function extractJsonPayload(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const inner = (fenced?.[1] ?? text).trim();
  if (inner.startsWith("{")) return inner;
  const start = inner.indexOf("{");
  const end = inner.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) return inner.slice(start, end + 1);
  return inner;
}

/**
 * Live DashScope / Qwen gateway inference for the decision authority arm.
 * Uses native fetch and OpenAI-compatible wire format with qwen3.8-max default.
 * Never throws: network/parse failures resolve to fail-closed VETOED.
 */
export async function queryLiveLlmVerdict(
  input: {
    symbol: string;
    side: "buy" | "sell";
    quantity: number;
    priceUsd: number;
    basisPct?: number;
    macroScore?: number;
    macroRationale?: string;
  },
  opts?: {
    fetchImpl?: typeof fetch;
    config?: { baseUrl: string; model: string; apiKey: string };
  },
): Promise<{ verdict: LlmVerdict; telemetry: LlmInferenceTelemetry }> {
  const config = opts?.config ?? resolveQwenConfig();
  const fetchFn = opts?.fetchImpl ?? fetch;

  if (!config.apiKey || config.apiKey.trim().length === 0) {
    return {
      verdict: {
        decision: "VETOED",
        confidence: 0,
        modelId: "fallback-no-api-key",
        rationale: "Missing BITGET_QWEN_API_KEY / DASHSCOPE_API_KEY: fail-closed VETOED",
      },
      telemetry: {
        isLiveInference: false,
        latencyMs: 0,
        modelId: "fallback-no-api-key",
        error: "Missing API key",
      },
    };
  }

  const system =
    "You are the Autonomous Decision Authority for the Money Boys institutional trading desk. " +
    "You make independent trading decisions based on basis dislocation and macro catalysts. " +
    'Output ONLY valid JSON matching this schema: {"decision": "APPROVED"|"VETOED", "confidence": number (0-1), "modelId": string, "rationale": string}. ' +
    "No prose, no markdown fences.";

  const user =
    `Trade Candidate: ${input.side.toUpperCase()} ${input.quantity} ${input.symbol} @ $${input.priceUsd.toFixed(2)}. ` +
    (input.basisPct !== undefined ? `Basis Dislocation: ${input.basisPct > 0 ? "+" : ""}${input.basisPct.toFixed(2)}%. ` : "") +
    (input.macroScore !== undefined ? `Macro Catalyst Score: ${input.macroScore}/100 ("${input.macroRationale ?? "Neutral"}"). ` : "") +
    "Evaluate whether this trade should be APPROVED or VETOED.";

  const t0 = performance.now();
  try {
    const url = `${config.baseUrl}/chat/completions`;
    const res = await fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.1,
      }),
    });

    const latencyMs = Math.round(performance.now() - t0);

    if (!res.ok) {
      return {
        verdict: {
          decision: "VETOED",
          confidence: 0,
          modelId: config.model,
          rationale: `Qwen gateway HTTP ${res.status}: fail-closed VETOED`,
        },
        telemetry: {
          isLiveInference: false,
          latencyMs,
          modelId: config.model,
          endpoint: config.baseUrl,
          error: `HTTP ${res.status}`,
        },
      };
    }

    const rawText = await res.text();
    const responseHash = createHash("sha256").update(rawText).digest("hex");

    let payload: unknown;
    try {
      payload = JSON.parse(rawText);
    } catch {
      return {
        verdict: {
          decision: "VETOED",
          confidence: 0,
          modelId: config.model,
          rationale: "Qwen gateway response is not valid JSON: fail-closed VETOED",
        },
        telemetry: {
          isLiveInference: false,
          latencyMs,
          modelId: config.model,
          responseHash,
          endpoint: config.baseUrl,
          error: "Invalid JSON response envelope",
        },
      };
    }

    let messageContent = "";
    if (payload && typeof payload === "object") {
      const obj = payload as Record<string, unknown>;
      const choices = obj["choices"];
      if (Array.isArray(choices) && choices.length > 0) {
        const choice = choices[0] as Record<string, unknown>;
        const msg = choice["message"] as Record<string, unknown> | undefined;
        if (typeof msg?.["content"] === "string") {
          messageContent = msg["content"];
        } else if (typeof choice["text"] === "string") {
          messageContent = choice["text"];
        }
      }
    }

    if (!messageContent) {
      return {
        verdict: {
          decision: "VETOED",
          confidence: 0,
          modelId: config.model,
          rationale: "Empty message content from Qwen gateway: fail-closed VETOED",
        },
        telemetry: {
          isLiveInference: false,
          latencyMs,
          modelId: config.model,
          responseHash,
          endpoint: config.baseUrl,
          error: "Empty message content",
        },
      };
    }

    let candidate: unknown;
    try {
      candidate = JSON.parse(extractJsonPayload(messageContent));
    } catch {
      return {
        verdict: {
          decision: "VETOED",
          confidence: 0,
          modelId: config.model,
          rationale: "Model content did not contain valid JSON verdict: fail-closed VETOED",
        },
        telemetry: {
          isLiveInference: false,
          latencyMs,
          modelId: config.model,
          responseHash,
          endpoint: config.baseUrl,
          error: "Model output not valid JSON",
        },
      };
    }

    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return {
        verdict: {
          decision: "VETOED",
          confidence: 0,
          modelId: config.model,
          rationale: "Model candidate is not a JSON object: fail-closed VETOED",
        },
        telemetry: {
          isLiveInference: false,
          latencyMs,
          modelId: config.model,
          responseHash,
          endpoint: config.baseUrl,
          error: "Model output not an object",
        },
      };
    }

    const rec = candidate as Record<string, unknown>;
    const decision = rec["decision"] === "APPROVED" ? "APPROVED" : "VETOED";
    const confidence =
      typeof rec["confidence"] === "number" && !isNaN(rec["confidence"])
        ? Math.max(0, Math.min(1, rec["confidence"]))
        : 0.5;
    const modelId =
      typeof rec["modelId"] === "string" && rec["modelId"].trim().length > 0
        ? rec["modelId"].trim()
        : config.model;
    const rationale =
      typeof rec["rationale"] === "string" && rec["rationale"].trim().length > 0
        ? rec["rationale"].trim()
        : "Model provided decision";

    const parsedVerdict = LlmVerdictSchema.parse({
      decision,
      confidence,
      modelId,
      rationale,
    });

    return {
      verdict: parsedVerdict,
      telemetry: {
        isLiveInference: true,
        latencyMs: Math.max(1, latencyMs),
        modelId,
        responseHash,
        endpoint: config.baseUrl,
      },
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - t0);
    const msg = err instanceof Error ? err.message : String(err);
    return {
      verdict: {
        decision: "VETOED",
        confidence: 0,
        modelId: config.model,
        rationale: `Qwen gateway network error (${msg}): fail-closed VETOED`,
      },
      telemetry: {
        isLiveInference: false,
        latencyMs,
        modelId: config.model,
        endpoint: config.baseUrl,
        error: msg,
      },
    };
  }
}

/**
 * Derives the provenance stamp strictly from observed empirical telemetry.
 * Never checks a CLI flag or user claim.
 */
export function derivePerformanceStamp(
  telemetryList: readonly LlmInferenceTelemetry[],
): PerformanceStamp {
  const total = telemetryList.length;
  if (total === 0) {
    return {
      syntheticFixture: true,
      validAsPerformanceEvidence: false,
      provenance: "ALL_SYNTHETIC",
      reason: "No telemetry records observed; stamp defaults to syntheticFixture: true.",
      telemetrySummary: {
        totalEvaluations: 0,
        liveEvaluations: 0,
        syntheticEvaluations: 0,
        modelsObserved: [],
        responseHashesSample: [],
      },
    };
  }

  const liveRecords = telemetryList.filter(
    (t) =>
      t.isLiveInference === true &&
      t.latencyMs > 0 &&
      typeof t.responseHash === "string" &&
      /^[0-9a-f]{64}$/.test(t.responseHash) &&
      !t.modelId.includes("fixture") &&
      !t.modelId.includes("synthetic") &&
      !t.modelId.includes("fallback"),
  );

  const liveCount = liveRecords.length;
  const syntheticCount = total - liveCount;

  const latencies = liveRecords.map((r) => r.latencyMs);
  const minLatency = latencies.length ? Math.min(...latencies) : undefined;
  const maxLatency = latencies.length ? Math.max(...latencies) : undefined;
  const meanLatency = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : undefined;

  const modelsObserved = Array.from(new Set(telemetryList.map((t) => t.modelId)));
  const responseHashesSample = liveRecords
    .map((r) => r.responseHash!)
    .filter(Boolean)
    .slice(0, 5);

  const telemetrySummary = {
    totalEvaluations: total,
    liveEvaluations: liveCount,
    syntheticEvaluations: syntheticCount,
    minLatencyMs: minLatency,
    maxLatencyMs: maxLatency,
    meanLatencyMs: meanLatency,
    modelsObserved,
    responseHashesSample,
  };

  if (liveCount === 0) {
    return {
      syntheticFixture: true,
      validAsPerformanceEvidence: false,
      provenance: "ALL_SYNTHETIC",
      reason:
        "A/B campaign executed on authored scenario fixtures and synthetic LLM verdicts (GAP-022). " +
        "Zero live model inference round-trips observed in telemetry; metrics reflect authored fixture design rather than empirical model performance. " +
        "Admissible ONLY as control-plane and structural risk-veto verification.",
      telemetrySummary,
    };
  }

  if (liveCount < total) {
    return {
      syntheticFixture: true,
      validAsPerformanceEvidence: false,
      provenance: "PARTIAL_LIVE",
      reason:
        `A/B campaign executed with mixed live inference and authored fixtures (${liveCount}/${total} live). ` +
        "Quarantined from track performance evidence until 100% of cycle evaluations are live model responses over genuine market data.",
      telemetrySummary,
    };
  }

  return {
    syntheticFixture: false,
    validAsPerformanceEvidence: true,
    provenance: "LIVE_INFERENCE",
    reason:
      `A/B campaign evaluated entirely via live model inference against ${modelsObserved.join(", ")} ` +
      `across ${total} verified network round-trips with cryptographic SHA-256 payload provenance.`,
    telemetrySummary,
  };
}

/**
 * A/B PAPER RUNNER & HARNESS (Track 2 Deliverable)
 *
 * Runs dual-arm deliberation across real or simulated market snapshots:
 *   Arm A: COUNCIL (Weighted persona reducer: Macro 25%, Quant 35%, Risk 25%, Exec 15%)
 *   Arm B: LLM (Autonomous model verdict, fail-closed if absent)
 *
 * Invariants Enforced:
 *   - Risk HARD_VETO terminates BOTH arms before authority resolution.
 *   - Zero risk violations possible by construction (riskViolationRate = 0).
 *   - Both arms run on identical canonical input hashes.
 *   - Decisions sealed via SHA-256 ReasoningReceipts.
 *   - PAPER orders executed only when active arm resolves to APPROVED.
 */

export const AbCycleInputSchema = z.object({
  cycleId: z.string().min(1).default(() => `cycle-${randomUUID().slice(0, 8)}`),
  symbol: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  quantity: z.number().positive(),
  priceUsd: z.number().positive(),
  tokenPrice: z.number().positive(),
  tradFiClosePrice: z.number().positive(),
  depth: MarketDepthSchema,
  fundingRate8h: z.number().finite().default(0),
  hoursToClose: z.number().nonnegative().default(0),
  takerFee: z.number().nonnegative().default(0.0006),
  account: RiskAccountSchema,
  portfolio: PortfolioStateSchema.optional(),
  macroScore: z.number().min(0).max(100).default(50),
  macroRationale: z.string().default("Neutral macro catalyst baseline"),
  llmVerdict: LlmVerdictSchema.optional(),
  /**
   * Explicit label for scenario test fixtures. Using authoredFixtureVerdict
   * makes it unambiguous that the verdict is an authored literal rather
   * than a live model output (GAP-022).
   */
  authoredFixtureVerdict: LlmVerdictSchema.optional(),
  queryLiveLlm: z.boolean().default(false),
  humanTakeover: z.boolean().default(false),
  outcome: z.enum(["WIN", "LOSS", "FLAT", "UNKNOWN"]).default("UNKNOWN"),
});
export type AbCycleInput = z.infer<typeof AbCycleInputSchema>;
export type AbCycleInputArgs = z.input<typeof AbCycleInputSchema>;

export interface AbCycleResult {
  cycleId: string;
  inputHash: string;
  quant: QuantAnalysisResult;
  risk: BlastRadiusResult;
  portfolioAssessment?: PortfolioRiskAssessment;
  execution: ExecutionAssessment;
  councilDeliberation: CouncilDeliberationResult;
  councilResolution: AuthorityResolution;
  llmResolution: AuthorityResolution;
  armsAgree: boolean;
  observations: [ArmObservation, ArmObservation]; // [councilObs, llmObs]
  activeAuthority: DecisionAuthority;
  activeDecision: "APPROVED" | "VETOED";
  receipt?: SealedReasoningReceipt;
  executionRecord?: ExecutionRecord;
  llmTelemetry?: LlmInferenceTelemetry;
}

export interface AbRunnerOptions {
  activeAuthority?: DecisionAuthority;
  executePaperFills?: boolean;
  logFilePath?: string;
  queryLiveLlm?: boolean;
  fetchImpl?: typeof fetch;
}

export class AbPaperRunner {
  private readonly observations: ArmObservation[] = [];
  private readonly telemetry: LlmInferenceTelemetry[] = [];
  private readonly dispatcher: OrderDispatcher;
  private readonly logFilePath?: string;

  constructor(opts?: { logFilePath?: string }) {
    this.dispatcher = new OrderDispatcher("PAPER");
    this.logFilePath = opts?.logFilePath;
  }

  /**
   * Runs a single A/B cycle on the supplied market and account input.
   */
  async runCycle(input: AbCycleInputArgs, opts?: AbRunnerOptions): Promise<AbCycleResult> {
    const p = AbCycleInputSchema.parse(input);
    const activeAuthority = opts?.activeAuthority ?? "COUNCIL";
    const executePaperFills = opts?.executePaperFills ?? true;

    // 1. Canonical input hash (binds exact inputs so repeatability is verifiable)
    const inputPayload = {
      symbol: p.symbol,
      side: p.side,
      quantity: p.quantity,
      priceUsd: p.priceUsd,
      tokenPrice: p.tokenPrice,
      tradFiClosePrice: p.tradFiClosePrice,
      fundingRate8h: p.fundingRate8h,
      hoursToClose: p.hoursToClose,
      account: p.account,
    };
    const inputHash = hashPayload(inputPayload);

    // 2. Quant Boy evaluation
    const orderSizeUsd = p.quantity * p.priceUsd;
    const quant = evaluateBasisSpread({
      tokenPrice: p.tokenPrice,
      tradFiClosePrice: p.tradFiClosePrice,
      orderSizeUsd,
      depth: p.depth,
      fundingRate8h: p.fundingRate8h,
      hoursToClose: p.hoursToClose,
      takerFee: p.takerFee,
    });

    // 3. Risk Boy & Portfolio Copilot evaluation
    let risk: BlastRadiusResult;
    let portfolioAssessment: PortfolioRiskAssessment | undefined;

    if (p.portfolio) {
      const portResult = StructuralChangeGuard.evaluateBlastRadiusWithPortfolio(
        { symbol: p.symbol, side: p.side, quantity: p.quantity, priceUsd: p.priceUsd },
        p.account,
        p.portfolio,
      );
      risk = portResult;
      portfolioAssessment = portResult.portfolioAssessment;
    } else {
      risk = StructuralChangeGuard.evaluateBlastRadius(
        { symbol: p.symbol, side: p.side, quantity: p.quantity, priceUsd: p.priceUsd },
        p.account,
      );
    }
    const riskReport = toBlastRadiusReport(risk);

    // 4. Execution assessment
    const execution = evaluateExecution({
      orderSizeUsd,
      availableDepthUsd: quant.availableDepthUsd,
      depthCoverage: quant.depthCoverage,
      completeFill: quant.completeFill,
      takerFee: p.takerFee,
      vwapSlippage: quant.vwapSlippage,
    });

    // 5. Council Reducer (Fixed-rule arm)
    const riskScore = risk.decision === "APPROVED"
      ? Math.max(0, Math.min(100, Math.round((100 - risk.projectedMarginUtilization * 50) * 10) / 10))
      : 0;

    const councilDeliberation = reduceCouncilVote({
      macroScore: p.macroScore,
      quantScore: quant.quantScore,
      riskScore,
      execScore: execution.executionScore,
      riskPermitted: riskReport.permitted,
      originalExposureUsd: orderSizeUsd,
    });

    // 6. Dual-Arm Authority Resolution (COUNCIL vs LLM)
    const councilResolution = resolveDecisionAuthority({
      authority: "COUNCIL",
      deliberation: councilDeliberation,
      riskPermitted: riskReport.permitted,
      riskReasons: risk.reasons,
    });

    let effectiveVerdict: LlmVerdict | undefined = p.authoredFixtureVerdict ?? p.llmVerdict;
    let cycleTelemetry: LlmInferenceTelemetry;

    if (p.authoredFixtureVerdict) {
      cycleTelemetry = {
        isLiveInference: false,
        latencyMs: 0,
        modelId: p.authoredFixtureVerdict.modelId,
        error: "Authored scenario fixture literal",
      };
    } else if (p.llmVerdict) {
      cycleTelemetry = {
        isLiveInference: false,
        latencyMs: 0,
        modelId: p.llmVerdict.modelId,
        error: "Pre-supplied verdict literal",
      };
    } else if (opts?.queryLiveLlm || p.queryLiveLlm) {
      const liveRes = await queryLiveLlmVerdict(
        {
          symbol: p.symbol,
          side: p.side,
          quantity: p.quantity,
          priceUsd: p.priceUsd,
          basisPct: quant.netEdge ? quant.netEdge * 100 : undefined,
          macroScore: p.macroScore,
          macroRationale: p.macroRationale,
        },
        { fetchImpl: opts?.fetchImpl },
      );
      effectiveVerdict = liveRes.verdict;
      cycleTelemetry = liveRes.telemetry;
    } else {
      cycleTelemetry = {
        isLiveInference: false,
        latencyMs: 0,
        modelId: "none",
        error: "No verdict or live query specified",
      };
    }

    this.telemetry.push(cycleTelemetry);

    const llmResolution = resolveDecisionAuthority({
      authority: "LLM",
      deliberation: councilDeliberation,
      riskPermitted: riskReport.permitted,
      riskReasons: risk.reasons,
      llmVerdict: effectiveVerdict,
    });

    const armsAgree = councilResolution.decision === llmResolution.decision;

    // 7. Record Arm Observations
    const councilObs: ArmObservation = ArmObservationSchema.parse({
      cycleId: p.cycleId,
      inputHash,
      authority: "COUNCIL",
      decision: councilResolution.decision,
      councilDecision: councilResolution.councilDecision,
      armsAgree,
      riskVetoApplied: councilResolution.riskVetoApplied,
      riskPermitted: riskReport.permitted,
      humanTakeover: p.humanTakeover,
      outcome: p.outcome,
    });

    const llmObs: ArmObservation = ArmObservationSchema.parse({
      cycleId: p.cycleId,
      inputHash,
      authority: "LLM",
      decision: llmResolution.decision,
      councilDecision: councilResolution.councilDecision,
      armsAgree,
      riskVetoApplied: llmResolution.riskVetoApplied,
      riskPermitted: riskReport.permitted,
      humanTakeover: p.humanTakeover,
      outcome: p.outcome,
    });

    this.observations.push(councilObs, llmObs);

    // Optional JSONL persistence
    const targetLogPath = opts?.logFilePath ?? this.logFilePath;
    if (targetLogPath) {
      try {
        appendFileSync(targetLogPath, JSON.stringify(councilObs) + "\n");
        appendFileSync(targetLogPath, JSON.stringify(llmObs) + "\n");
      } catch {
        // Logging fail-safe
      }
    }

    // 8. Execution of Active Arm
    const activeResolution = activeAuthority === "COUNCIL" ? councilResolution : llmResolution;
    let receipt: SealedReasoningReceipt | undefined;
    let executionRecord: ExecutionRecord | undefined;

    if (activeResolution.decision === "APPROVED") {
      receipt = sealReceipt({
        symbol: p.symbol,
        action: quant.action,
        quantMetrics: quant,
        riskReport,
        councilScores: {
          compositeScore: councilDeliberation.compositeScore,
          macro: p.macroScore,
          quant: quant.quantScore,
          risk: riskScore,
          exec: execution.executionScore,
        },
        decision: "APPROVED",
        rationale: activeAuthority === "COUNCIL"
          ? councilDeliberation.rationale
          : (effectiveVerdict?.rationale ?? "LLM Approved"),
        metadata: {
          passNumber: 1,
          originalQuantity: p.quantity,
          executedQuantity: p.quantity,
        },
      });

      if (executePaperFills) {
        executionRecord = await this.dispatcher.dispatch(receipt, {
          symbol: p.symbol,
          side: p.side === "buy" ? "BUY" : "SELL",
          quantity: p.quantity,
          fillPriceUsd: p.priceUsd,
        });
      }
    }

    return {
      cycleId: p.cycleId,
      inputHash,
      quant,
      risk,
      portfolioAssessment,
      execution,
      councilDeliberation,
      councilResolution,
      llmResolution,
      armsAgree,
      observations: [councilObs, llmObs],
      activeAuthority,
      activeDecision: activeResolution.decision,
      receipt,
      executionRecord,
      llmTelemetry: cycleTelemetry,
    };
  }

  getObservations(): readonly ArmObservation[] {
    return this.observations;
  }

  getTelemetry(): readonly LlmInferenceTelemetry[] {
    return this.telemetry;
  }

  getDerivedPerformanceStamp(): PerformanceStamp {
    return derivePerformanceStamp(this.telemetry);
  }

  getMetrics(): AbMetrics {
    return computeAbMetrics(this.observations);
  }

  exportJsonl(): string {
    return this.observations.map((o) => JSON.stringify(o)).join("\n");
  }

  saveJsonl(filePath: string): void {
    writeFileSync(filePath, this.exportJsonl() + "\n", "utf8");
  }
}
