import { z } from "zod";
import { evaluateBasisSpread, type QuantAnalysisResult } from "../agents/quant.js";
import { evaluateExecution, type ExecutionAssessment } from "../agents/execution.js";
import {
  StructuralChangeGuard,
  toBlastRadiusReport,
  type BlastRadiusResult,
  type RiskAccount,
} from "../skills/igraph-guard/security.js";
import {
  reduceCouncilVote,
  type CouncilDeliberationResult,
} from "./reducer.js";
import {
  sealReceipt,
  type SealedReasoningReceipt,
} from "./receipts.js";
import {
  MacroCatalystProposalSchema,
  type MacroCatalystProposal,
} from "../skills/noema-qa/schemas.js";
import { MarketDepthSchema } from "../agents/quant.js";
import { RiskAccountSchema } from "../skills/igraph-guard/security.js";
import type { OrderDispatcher, ExecutionRecord } from "../bitget/dispatcher.js";

/**
 * CLM-006 / GAP-006 — Council cyclic handoff adapter (Phase 05 hardened).
 *
 * Pipeline: quant.evaluateBasisSpread → security.StructuralChangeGuard
 * .evaluateBlastRadius → execution.evaluateExecution →
 * reducer.reduceCouncilVote → receipts.sealReceipt, with:
 *  - Recursive SOFT_REJECT scaling: Pass 1 SOFT_REJECT re-runs the Hot Path
 *    at 50% quantity; Pass 2 APPROVED seals APPROVED at reduced exposure.
 *  - Empirical telemetry: performance.now() timers per stage.
 *  - Optional OrderDispatcher: APPROVED receipts dispatch (PAPER default).
 *
 * Risk score mapping (deterministic): veto → 0; approved →
 * `100 − utilizationPct × 0.5`, so a safe book still clears Risk ≥ 80
 * while utilization drag is visible. Receipt decision: APPROVED →
 * APPROVED, anything else → VETOED (SOFT_REJECT keeps its scaled
 * resubmission via Pass 2 — the receipt still seals, verify stays true).
 *
 * Pure TypeScript + Zod. No LLM, no network (dispatcher PAPER path included).
 */

export const DeliberationCycleParamsSchema = z.object({
  symbol: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  quantity: z.number().positive(),
  priceUsd: z.number().positive(),
  tokenPrice: z.number().positive(),
  tradFiClosePrice: z.number().positive(),
  orderSizeUsd: z.number().positive(),
  fundingRate8h: z.number().finite().default(0),
  hoursToClose: z.number().nonnegative().default(0),
  takerFee: z.number().nonnegative().default(0.0006),
  rationale: z.string().min(1).optional(),
});
export type DeliberationCycleParams = z.infer<typeof DeliberationCycleParamsSchema>;

export const PipelineLatenciesSchema = z.object({
  macroMs: z.number().nonnegative(),
  quantMs: z.number().nonnegative(),
  riskMs: z.number().nonnegative(),
  execMs: z.number().nonnegative(),
  councilReducerMs: z.number().nonnegative(),
  sealingMs: z.number().nonnegative(),
  totalPipelineMs: z.number().nonnegative(),
});
export type PipelineLatencies = z.infer<typeof PipelineLatenciesSchema>;

export const DeliberationCycleResultSchema = z.object({
  receipt: z.custom<SealedReasoningReceipt>((v) => typeof v === "object" && v !== null),
  deliberation: z.custom<CouncilDeliberationResult>(
    (v) => typeof v === "object" && v !== null,
  ),
});
export type DeliberationCycleResult = {
  receipt: SealedReasoningReceipt;
  deliberation: CouncilDeliberationResult;
  quant: QuantAnalysisResult;
  risk: BlastRadiusResult;
  execution: ExecutionAssessment;
  /** 1 = single pass, 2 = soft-reject scaled retry. */
  passNumber: 1 | 2;
  executionQuantity: number;
  executionExposureUsd: number;
  latencies: PipelineLatencies;
  executionRecord?: ExecutionRecord;
};

function riskScoreFor(blast: BlastRadiusResult): number {
  if (blast.decision !== "APPROVED") return 0;
  const utilPct = blast.projectedMarginUtilization * 100;
  const s = 100 - utilPct * 0.5;
  return Math.max(0, Math.min(100, Math.round(s * 10) / 10));
}

type HotPath = {
  quant: QuantAnalysisResult;
  risk: BlastRadiusResult;
  execution: ExecutionAssessment;
  deliberation: CouncilDeliberationResult;
  quantMs: number;
  riskMs: number;
  execMs: number;
  reducerMs: number;
};

function runHotPath(
  macro: MacroCatalystProposal,
  book: z.infer<typeof MarketDepthSchema>,
  acct: RiskAccount,
  p: DeliberationCycleParams,
  quantity: number,
  orderSizeUsd: number,
  exposureUsd: number,
): HotPath {
  const tQuantStart = performance.now();
  const quant = evaluateBasisSpread({
    tokenPrice: p.tokenPrice,
    tradFiClosePrice: p.tradFiClosePrice,
    orderSizeUsd,
    depth: book,
    fundingRate8h: p.fundingRate8h,
    hoursToClose: p.hoursToClose,
    takerFee: p.takerFee,
  });
  const quantMs = performance.now() - tQuantStart;

  const tRiskStart = performance.now();
  const risk = StructuralChangeGuard.evaluateBlastRadius(
    { symbol: p.symbol, side: p.side, quantity, priceUsd: p.priceUsd },
    acct,
  );
  const riskMs = performance.now() - tRiskStart;
  const riskReport = toBlastRadiusReport(risk);

  const tExecStart = performance.now();
  const execution = evaluateExecution({
    orderSizeUsd,
    availableDepthUsd: quant.availableDepthUsd,
    depthCoverage: quant.depthCoverage,
    completeFill: quant.completeFill,
    takerFee: p.takerFee,
    vwapSlippage: quant.vwapSlippage,
  });
  const execMs = performance.now() - tExecStart;

  const tReducerStart = performance.now();
  const deliberation: CouncilDeliberationResult = reduceCouncilVote({
    macroScore: macro.score,
    quantScore: quant.quantScore,
    riskScore: riskScoreFor(risk),
    execScore: execution.executionScore,
    riskPermitted: riskReport.permitted,
    originalExposureUsd: exposureUsd,
  });
  const reducerMs = performance.now() - tReducerStart;

  return { quant, risk, execution, deliberation, quantMs, riskMs, execMs, reducerMs };
}

function sealCycle(
  p: DeliberationCycleParams,
  hot: HotPath,
  decision: "APPROVED" | "VETOED",
  rationale: string,
  passNumber: 1 | 2,
  executedQuantity: number,
): SealedReasoningReceipt {
  const riskReport = toBlastRadiusReport(hot.risk);
  return sealReceipt({
    symbol: p.symbol,
    action: hot.quant.action,
    quantMetrics: hot.quant,
    riskReport,
    councilScores: {
      compositeScore: hot.deliberation.compositeScore,
      macro: 0 + 0, // placeholder overwritten below (kept numeric for catchall)
    },
    decision,
    rationale,
    metadata: {
      passNumber,
      originalQuantity: p.quantity,
      executedQuantity,
    },
  });
}

/** Build the sealed receipt with full council scores + metadata. */
function sealWithScores(
  p: DeliberationCycleParams,
  macro: MacroCatalystProposal,
  hot: HotPath,
  decision: "APPROVED" | "VETOED",
  rationale: string,
  passNumber: 1 | 2,
  executedQuantity: number,
): SealedReasoningReceipt {
  const riskReport = toBlastRadiusReport(hot.risk);
  return sealReceipt({
    symbol: p.symbol,
    action: hot.quant.action,
    quantMetrics: hot.quant,
    riskReport,
    councilScores: {
      compositeScore: hot.deliberation.compositeScore,
      macro: macro.score,
      quant: hot.quant.quantScore,
      risk: riskScoreFor(hot.risk),
      exec: hot.execution.executionScore,
    },
    decision,
    rationale,
    metadata: {
      passNumber,
      originalQuantity: p.quantity,
      executedQuantity,
    },
  });
}

function buildResult(
  p: DeliberationCycleParams,
  macro: MacroCatalystProposal,
  book: z.infer<typeof MarketDepthSchema>,
  hot: HotPath,
  opts: {
    passNumber: 1 | 2;
    executionQuantity: number;
    executionExposureUsd: number;
    receiptDecision: "APPROVED" | "VETOED";
    rationale: string;
    macroMs: number;
    sealingMsHolder: { ms: number };
  },
  tTotalStart: number,
): DeliberationCycleResult {
  const tSealStart = performance.now();
  const receipt = sealWithScores(p, macro, hot, opts.receiptDecision, opts.rationale, opts.passNumber, opts.executionQuantity);
  const sealingMs = performance.now() - tSealStart;
  const totalPipelineMs = performance.now() - tTotalStart;
  void book;
  return {
    receipt,
    deliberation: hot.deliberation,
    quant: hot.quant,
    risk: hot.risk,
    execution: hot.execution,
    passNumber: opts.passNumber,
    executionQuantity: opts.executionQuantity,
    executionExposureUsd: opts.executionExposureUsd,
    latencies: {
      macroMs: opts.macroMs,
      quantMs: hot.quantMs,
      riskMs: hot.riskMs,
      execMs: hot.execMs,
      councilReducerMs: hot.reducerMs,
      sealingMs,
      totalPipelineMs,
    },
  };
}

async function attachDispatch(
  result: DeliberationCycleResult,
  dispatcher: OrderDispatcher | undefined,
  p: DeliberationCycleParams,
): Promise<DeliberationCycleResult> {
  if (!dispatcher) return result;
  if (result.receipt.decision !== "APPROVED") return result;
  const side = p.side === "buy" ? "BUY" : "SELL";
  const executionRecord = await dispatcher.dispatch(result.receipt, {
    symbol: p.symbol,
    side: side as "BUY" | "SELL",
    quantity: result.executionQuantity,
    fillPriceUsd: p.priceUsd,
  });
  return { ...result, executionRecord };
}

// Overloads: sync without dispatcher (backward compatible), async with dispatcher.
export function executeDeliberationCycle(
  catalyst: MacroCatalystProposal,
  depth: unknown,
  account: RiskAccount,
  params: DeliberationCycleParams,
): DeliberationCycleResult;
export function executeDeliberationCycle(
  catalyst: MacroCatalystProposal,
  depth: unknown,
  account: RiskAccount,
  params: DeliberationCycleParams,
  dispatcher: OrderDispatcher,
): Promise<DeliberationCycleResult>;
export function executeDeliberationCycle(
  catalyst: MacroCatalystProposal,
  depth: unknown,
  account: RiskAccount,
  params: DeliberationCycleParams,
  dispatcher?: OrderDispatcher,
): DeliberationCycleResult | Promise<DeliberationCycleResult> {
  const tTotalStart = performance.now();
  const tMacroStart = performance.now();
  const macro = MacroCatalystProposalSchema.parse(catalyst);
  const book = MarketDepthSchema.parse(depth);
  const acct = RiskAccountSchema.parse(account);
  const p = DeliberationCycleParamsSchema.parse(params);
  const macroMs = performance.now() - tMacroStart;

  const originalExposureUsd = Math.round(p.quantity * p.priceUsd * 100) / 100;

  // Pass 1 — full exposure.
  const pass1 = runHotPath(macro, book, acct, p, p.quantity, p.orderSizeUsd, originalExposureUsd);

  if (pass1.deliberation.status === "APPROVED") {
    const executionExposureUsd = Math.round(p.quantity * p.priceUsd * 100) / 100;
    const rationale =
      p.rationale ??
      `Council ${pass1.deliberation.status} (S=${pass1.deliberation.compositeScore.toFixed(1)}, quorum ${pass1.deliberation.quorum}/4): ${pass1.deliberation.rationale}`;
    const result = buildResult(
      p, macro, book, pass1,
      {
        passNumber: 1,
        executionQuantity: p.quantity,
        executionExposureUsd,
        receiptDecision: "APPROVED",
        rationale,
        macroMs,
        sealingMsHolder: { ms: 0 },
      },
      tTotalStart,
    );
    if (dispatcher) return attachDispatch(result, dispatcher, p);
    return result;
  }

  if (pass1.deliberation.status === "SOFT_REJECT") {
    const pass1Score = pass1.deliberation.compositeScore.toFixed(2);
    // Pass 2 — 50% scaled retry through the Hot Path.
    const pass2Quantity = Math.floor(p.quantity * 0.5 * 1e4) / 1e4;
    const pass2ExposureUsd = pass2Quantity * p.priceUsd;
    const pass2 = runHotPath(macro, book, acct, p, pass2Quantity, pass2ExposureUsd, pass2ExposureUsd);
    // Aggregate hot-path latencies across both passes (empirical totals).
    const combined: HotPath = {
      ...pass2,
      quantMs: pass1.quantMs + pass2.quantMs,
      riskMs: pass1.riskMs + pass2.riskMs,
      execMs: pass1.execMs + pass2.execMs,
      reducerMs: pass1.reducerMs + pass2.reducerMs,
    };
    if (pass2.deliberation.status === "APPROVED") {
      const rationale =
        p.rationale ??
        `[SOFT_REJECT_SCALED_PASS2] Initial exposure ($${p.quantity * p.priceUsd}) soft-rejected (score ${pass1Score}). Halved to $${pass2ExposureUsd} and approved (score ${pass2.deliberation.compositeScore.toFixed(2)}).`;
      const result = buildResult(
        p, macro, book, { ...combined, deliberation: pass2.deliberation, quant: pass2.quant, risk: pass2.risk, execution: pass2.execution },
        {
          passNumber: 2,
          executionQuantity: pass2Quantity,
          executionExposureUsd: Math.round(pass2ExposureUsd * 100) / 100,
          receiptDecision: "APPROVED",
          rationale,
          macroMs,
          sealingMsHolder: { ms: 0 },
        },
        tTotalStart,
      );
      if (dispatcher) return attachDispatch(result, dispatcher, p);
      return result;
    }
    // Pass 2 still failed.
    const rationale =
      p.rationale ??
      `[SOFT_REJECT_SCALED_FAILED] Initial exposure soft-rejected; 50% scaled secondary evaluation failed with status ${pass2.deliberation.status}.`;
    const result = buildResult(
      p, macro, book, { ...combined, deliberation: pass2.deliberation, quant: pass2.quant, risk: pass2.risk, execution: pass2.execution },
      {
        passNumber: 2,
        executionQuantity: 0,
        executionExposureUsd: 0,
        receiptDecision: "VETOED",
        rationale,
        macroMs,
        sealingMsHolder: { ms: 0 },
      },
      tTotalStart,
    );
    if (dispatcher) return result;
    return result;
  }

  // REJECTED / HARD_VETO — terminate (still sealed + verifiable).
  const rationale =
    p.rationale ??
    `Council ${pass1.deliberation.status} (S=${pass1.deliberation.compositeScore.toFixed(1)}, quorum ${pass1.deliberation.quorum}/4): ${pass1.deliberation.rationale}`;
  const result = buildResult(
    p, macro, book, pass1,
    {
      passNumber: 1,
      executionQuantity: 0,
      executionExposureUsd: 0,
      receiptDecision: "VETOED",
      rationale,
      macroMs,
      sealingMsHolder: { ms: 0 },
    },
    tTotalStart,
  );
  if (dispatcher) return Promise.resolve(result);
  return result;
}

export const CouncilAdapter = {
  execute: executeDeliberationCycle,
};

export { sealCycle };
