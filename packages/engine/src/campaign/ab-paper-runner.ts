import { randomUUID } from "node:crypto";
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
}

export interface AbRunnerOptions {
  activeAuthority?: DecisionAuthority;
  executePaperFills?: boolean;
  logFilePath?: string;
}

export class AbPaperRunner {
  private readonly observations: ArmObservation[] = [];
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

    const llmResolution = resolveDecisionAuthority({
      authority: "LLM",
      deliberation: councilDeliberation,
      riskPermitted: riskReport.permitted,
      riskReasons: risk.reasons,
      llmVerdict: p.llmVerdict,
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
          : (p.llmVerdict?.rationale ?? "LLM Approved"),
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
    };
  }

  getObservations(): readonly ArmObservation[] {
    return this.observations;
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
