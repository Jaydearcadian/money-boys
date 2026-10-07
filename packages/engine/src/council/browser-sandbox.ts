/**
 * BROWSER SANDBOX — deterministic council deliberation with NO server contact.
 *
 * WHY THIS EXISTS
 *   The Live Cockpit wants judges to click "Simulate Catalyst Event" and
 *   "Probe Risk Veto". Doing that through POST /api/desk/simulate-cycle means
 *   unauthenticated visitors can append to the shared receipt ledger and
 *   rewrite the node matrix every other viewer sees over SSE — which corrupts
 *   the audit trail that I-03 and the Provenance page both rest on.
 *
 *   So the sandbox runs entirely in the browser. It reuses the SAME engine
 *   modules the server uses (reduceCouncilVote, evaluateBasisSpread,
 *   evaluateExecution, StructuralChangeGuard), all of which are free of node
 *   built-ins, so the verdict a judge sees is the real verdict — not a mock.
 *   Nothing is POSTed. The server is never asked.
 *
 *   This is also the stronger demo: "the council ran in your browser and the
 *   receipt verified with Web Crypto; the server was never involved" is a
 *   governance claim you cannot make about your own endpoint.
 *
 * WHAT THIS IS NOT
 *   Not a mock. Not a recorded fixture. Not a success path that always returns
 *   APPROVED — a proposal over the risk ceiling genuinely returns HARD_VETO,
 *   and that is the point of letting judges try it.
 */
import { z } from "zod";
import { reduceCouncilVote } from "./reducer.js";
import { evaluateBasisSpread, type QuantAnalysisResult } from "../agents/quant.js";
import { evaluateExecution } from "../agents/execution.js";
import { StructuralChangeGuard, toBlastRadiusReport } from "../skills/igraph-guard/security.js";

export const SandboxPresetSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** What this preset is meant to demonstrate, in plain words. */
  intent: z.string().min(1),
  symbol: z.string().min(1),
  side: z.enum(["BUY_BASIS", "SELL_BASIS"]),
  tokenPrice: z.number().positive(),
  tradFiClosePrice: z.number().positive(),
  notionalUsd: z.number().positive(),
  /** Account the proposal is measured against. Judges can drive this too. */
  accountEquityUsd: z.number().positive(),
  accountUsedMarginUsd: z.number().nonnegative(),
  macroScore: z.number().min(0).max(100),
  execScore: z.number().min(0).max(100),
  /**
   * Half the bid/ask spread as a fraction of price. Drives the passive
   * adverse-selection term. A 1-tick synthetic book made the hurdle ~0.0025%,
   * so essentially any positive basis cleared it and the "not worth the cost"
   * preset was APPROVED — which destroyed the single most important demo.
   */
  spreadHalfPct: z.number().nonnegative().default(0.0004),
  /** Shown above the result so the judge knows what they are looking at. */
  plainMeaning: z.string().min(1),
});
export type SandboxPreset = z.infer<typeof SandboxPresetSchema>;

export const SandboxResultSchema = z.object({
  presetId: z.string().min(1),
  label: z.string().min(1),
  intent: z.string().min(1),
  plainMeaning: z.string().min(1),
  symbol: z.string().min(1),
  side: z.enum(["BUY_BASIS", "SELL_BASIS"]),
  notionalUsd: z.number().positive(),

  quant: z.object({
    action: z.string(),
    rawBasisPct: z.number(),
    hurdleRatePct: z.number(),
    netEdgePct: z.number(),
    executionStyle: z.string(),
  }),
  execution: z.object({ executionScore: z.number() }),
  risk: z.object({
    permitted: z.boolean(),
    exposureUsd: z.number(),
    projectedMarginUtilization: z.number(),
    reasons: z.array(z.string()),
  }),
  council: z.object({
    status: z.string(),
    compositeScore: z.number(),
    quorum: z.number(),
    passingMembers: z.array(z.string()),
    rationale: z.string(),
  }),
  /** The whole point, stated explicitly and honestly. */
  dispatched: z.literal(false),
  serverContacted: z.literal(false),
  /** Verdict in everyday words, derived from the actual result. */
  verdictPlain: z.string(),
  /** Unsealed receipt payload. Hashing happens in the caller's browser. */
  receiptPayload: z.record(z.unknown()),
});
export type SandboxResult = z.infer<typeof SandboxResultSchema>;

/** Same canonicalisation as verify.ts, so a seal made here verifies there. */
export function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return (value as unknown[]).map(canonicalize);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>).sort()) {
    const v = (value as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = canonicalize(v);
  }
  return out;
}

export function sandboxCanonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Run one deliberation. Pure: no I/O, no clock, no randomness, so the same
 * preset always yields the same receipt payload and therefore the same digest.
 */
export function runSandboxDeliberation(raw: SandboxPreset): SandboxResult {
  const p = SandboxPresetSchema.parse(raw);

  const priceUsed = (p.tokenPrice + p.tradFiClosePrice) / 2;
  const quantity = p.notionalUsd / p.tokenPrice;

  const quant: QuantAnalysisResult = evaluateBasisSpread({
    tokenPrice: p.tokenPrice,
    tradFiClosePrice: p.tradFiClosePrice,
    orderSizeUsd: p.notionalUsd,
    depth: {
      bids: [{ price: p.tokenPrice * (1 - p.spreadHalfPct), quantity: 500 }],
      asks: [{ price: p.tokenPrice * (1 + p.spreadHalfPct), quantity: 500 }],
    },
    fundingRate8h: 0,
    hoursToClose: 1,
    takerFee: 0.0006,
    executionStyle: "passive",
  });

  const execution = evaluateExecution({
    orderSizeUsd: p.notionalUsd,
    availableDepthUsd: quant.availableDepthUsd,
    depthCoverage: quant.depthCoverage,
    completeFill: quant.completeFill,
    takerFee: 0.0006,
    vwapSlippage: quant.vwapSlippage,
  });

  const risk = StructuralChangeGuard.evaluateBlastRadius(
    { symbol: p.symbol, side: p.side === "BUY_BASIS" ? "buy" : "sell", quantity, priceUsd: priceUsed },
    {
      equityUsd: p.accountEquityUsd,
      usedMarginUsd: p.accountUsedMarginUsd,
      freeMarginUsd: Math.max(0, p.accountEquityUsd - p.accountUsedMarginUsd),
      openOrders: [],
    },
  );

  const council = reduceCouncilVote({
    macroScore: p.macroScore,
    quantScore: quant.quantScore,
    riskScore: risk.decision === "APPROVED" ? 90 : 0,
    execScore: execution.executionScore,
    riskPermitted: risk.decision === "APPROVED",
    originalExposureUsd: p.notionalUsd,
  });

  const decision = council.status === "APPROVED" ? "APPROVED" : "VETOED";

  // Verdict phrased for someone who does not know what a Sharpe is. Derived
  // from the real result, never hardcoded per preset.
  // Order matters: risk veto is absolute, then "not worth the cost", then
  // the council. A council that scores a sub-cost proposal highly is still a
  // refusal, and saying so is the honest everyday framing.
  const verdictPlain =
    risk.decision !== "APPROVED"
      ? `BLOCKED BY RISK. ${risk.reasons.join(" ")}`
      : quant.netEdgePct <= 0
        ? `NOT WORTH THE COST. The price gap is ${Math.abs(quant.netEdgePct).toFixed(4)}% smaller than what it costs to trade, so the desk refuses. Trading anyway would lose money.`
        : decision !== "APPROVED"
          ? `BLOCKED BY THE COUNCIL. ${council.rationale}`
          : `PROPOSED, NOT TRADED. The council approved it (score ${council.compositeScore.toFixed(1)}), but this sandbox cannot place an order — that is the point.`;

  return SandboxResultSchema.parse({
    presetId: p.id,
    label: p.label,
    intent: p.intent,
    plainMeaning: p.plainMeaning,
    symbol: p.symbol,
    side: p.side,
    notionalUsd: p.notionalUsd,
    quant: {
      action: quant.action,
      rawBasisPct: quant.rawBasisPct,
      hurdleRatePct: quant.hurdleRatePct,
      netEdgePct: quant.netEdgePct,
      executionStyle: quant.executionStyle,
    },
    execution: { executionScore: execution.executionScore },
    risk: {
      permitted: risk.decision === "APPROVED",
      exposureUsd: risk.exposureUsd,
      projectedMarginUtilization: risk.projectedMarginUtilization,
      reasons: risk.reasons,
    },
    council: {
      status: council.status,
      compositeScore: council.compositeScore,
      quorum: council.quorum,
      passingMembers: council.passingMembers,
      rationale: council.rationale,
    },
    dispatched: false,
    serverContacted: false,
    verdictPlain,
    receiptPayload: {
      symbol: p.symbol,
      action: quant.action,
      quantMetrics: quant,
      riskReport: toBlastRadiusReport(risk),
      councilScores: {
        compositeScore: council.compositeScore,
        macro: p.macroScore,
        quant: quant.quantScore,
        risk: risk.decision === "APPROVED" ? 90 : 0,
        exec: execution.executionScore,
      },
      decision,
      rationale: council.rationale,
      metadata: {
        passNumber: 1,
        mode: "BROWSER_SANDBOX",
        dispatched: false,
        serverContacted: false,
        originalQuantity: 0,
        executedQuantity: 0,
      },
    },
  });
}

/**
 * Presets that each demonstrate a DIFFERENT outcome. Deliberately includes one
 * that hard-vetoes and one that the council rejects, so the sandbox is not a
 * toy that always says yes.
 */
export const SANDBOX_PRESETS: ReadonlyArray<SandboxPreset> = [
  {
    id: "clean-edge",
    label: "A clear opportunity",
    intent: "Shows the happy path end to end: the council approves and a sealed receipt is produced.",
    symbol: "rNVDAUSDT",
    side: "BUY_BASIS",
    tokenPrice: 235.5,
    tradFiClosePrice: 230.0,
    notionalUsd: 2_000,
    accountEquityUsd: 25_000,
    accountUsedMarginUsd: 0,
    macroScore: 78,
    execScore: 85,
    spreadHalfPct: 0.0004,
    plainMeaning: "The token is trading well above the stock it tracks, and the gap is bigger than the cost of trading.",
  },
  {
    id: "risk-veto",
    label: "Too big for this account",
    intent: "Shows the deterministic risk veto. No vote can override it — it is checked before scoring.",
    symbol: "rNVDAUSDT",
    side: "BUY_BASIS",
    tokenPrice: 235.5,
    tradFiClosePrice: 230.0,
    notionalUsd: 18_000,
    accountEquityUsd: 25_000,
    accountUsedMarginUsd: 0,
    macroScore: 95,
    execScore: 95,
    spreadHalfPct: 0.0004,
    plainMeaning: "The opportunity is just as good as the first one, but this trade is far too large for the account.",
  },
  {
    id: "margin-ceiling",
    label: "Account already loaded",
    intent: "Shows the 65% margin-utilisation ceiling firing on the ACCOUNT, not on the trade size.",
    symbol: "rAAPLUSDT",
    side: "BUY_BASIS",
    tokenPrice: 224.0,
    tradFiClosePrice: 219.5,
    notionalUsd: 4_500,
    accountEquityUsd: 25_000,
    accountUsedMarginUsd: 14_000,
    macroScore: 88,
    execScore: 82,
    spreadHalfPct: 0.0004,
    plainMeaning: "This single trade is small enough on its own. The account is the problem — it would push margin use past the 65% limit.",
  },
  {
    id: "no-edge",
    label: "Not worth the cost",
    intent: "Shows the desk refusing to trade. A price gap smaller than the friction is not an opportunity.",
    symbol: "rTSLAUSDT",
    side: "BUY_BASIS",
    tokenPrice: 412.0,
    tradFiClosePrice: 411.9588,
    notionalUsd: 2_000,
    accountEquityUsd: 25_000,
    accountUsedMarginUsd: 0,
    macroScore: 80,
    execScore: 80,
    spreadHalfPct: 0.0004,
    plainMeaning: "The token is almost exactly the price of the stock. After costs there is nothing left, so the desk says no.",
  },
];
