/**
 * Bounded Demo strategy packet assembly (pure, no network, no credentials).
 *
 * Kept separate from scripts/demo-strategy-preflight.ts so the sizing and
 * gating rules are directly unit-testable and can be reused by any caller.
 *
 * Two gates must BOTH pass before a packet is executable:
 *   1. positive net edge (Quant Boy must not return NEUTRAL)
 *   2. venue-compliant sizing (multiplier, minQty AND minNotional together)
 *
 * Sizing comes from BitgetClient.sizeToVenueCompliance, never a hardcoded
 * quantity. The bare minTradeNum for a tokenized equity is NOT placeable:
 * 0.01 NVDA at $228.56 is $2.29 against a $5 venue minimum (GAP-016).
 *
 * This module submits nothing and holds no order authority.
 */
import { createHash } from "node:crypto";
import { BitgetClient, type MixContractConfig } from "./client.js";
import { sealReceipt } from "../council/receipts.js";
import { StructuralChangeGuard } from "../skills/igraph-guard/security.js";
import type { QuantAnalysisResult } from "../agents/quant.js";

/** Canonical repo/venue symbol pair for the tokenized-equity campaign. */
export const REPO_SYMBOL = "rNVDAUSDT";
export const VENUE_SYMBOL = "NVDAUSDT";
export const BENCHMARK_TICKER = "NVDA";
export const PRODUCT_TYPE = "USDT-FUTURES";

/** The bug this replaces: a hardcoded 0.01 that yields a $2.29 notional. */
export const FORBIDDEN_UNDER_SIZED_QUANTITY = 0.01;

export interface SizingSummary {
  targetNotionalUsd: number;
  compliantQuantity: number | null;
  roundedNotionalUsd: number | null;
  minQty: number;
  minNotionalUsdt: number;
  multiplier: number;
  precisionDecimalPlaces: number;
  steps: string[];
  reasons: string[];
  ok: boolean;
}

export interface PreflightPacket {
  repositorySymbol: string;
  venueSymbol: string;
  referencePriceUsd: number;
  sizing: SizingSummary;
  quant: QuantAnalysisResult;
  positiveNetEdge: boolean;
  executable: boolean;
  blockingReasons: string[];
  receiptHash: string | null;
  clientOidOpen: string | null;
  clientOidClose: string | null;
  risk: { decision: string; exposureUsd: number; projectedMarginUtilization: number } | null;
}

export interface SizingInputs {
  targetNotionalUsd: number;
  referencePriceUsd: number;
  freeMarginUsd: number;
  maxNotionalUsd?: number;
}

/**
 * Resolve a venue-compliant quantity.
 *
 * Wraps BitgetClient.sizeToVenueCompliance and always reports the venue
 * constraints alongside the result, so the packet shows WHY a size was
 * chosen rather than asserting one.
 */
export function resolveSizing(
  config: MixContractConfig,
  inputs: SizingInputs,
): SizingSummary {
  const priced: MixContractConfig = { ...config, referencePriceUsd: inputs.referencePriceUsd };
  const r = BitgetClient.sizeToVenueCompliance(
    priced,
    inputs.targetNotionalUsd,
    inputs.freeMarginUsd,
    inputs.maxNotionalUsd,
  );
  return {
    targetNotionalUsd: inputs.targetNotionalUsd,
    compliantQuantity: r.quantity,
    roundedNotionalUsd: r.notionalUsd,
    minQty: Number(config.minTradeNum),
    minNotionalUsdt: Number(config.minTradeUSDT ?? 0),
    multiplier: Number(config.sizeMultiplier),
    precisionDecimalPlaces: Number(config.volumePlace ?? NaN),
    steps: r.steps,
    reasons: r.reasons,
    ok: r.ok,
  };
}

/**
 * Deterministic packet assembly.
 *
 * Pure: no network, no credentials, no side effects. Separated from the I/O
 * so the sizing and gating rules are directly testable.
 */
export function buildPacket(args: {
  config: MixContractConfig;
  quant: QuantAnalysisResult;
  account: { equityUsd: number; freeMarginUsd: number };
  targetNotionalUsd: number;
  councilScores?: { compositeScore: number; macro: number; quant: number; risk: number; exec: number };
}): Omit<PreflightPacket, "receiptHash" | "clientOidOpen" | "clientOidClose"> {
  const { config, quant, account, targetNotionalUsd } = args;
  const sizing = resolveSizing(config, {
    targetNotionalUsd,
    referencePriceUsd: Number(config.referencePriceUsd),
    freeMarginUsd: account.freeMarginUsd,
  });

  const blockingReasons: string[] = [];

  // Gate 1: sizing. A null quantity means no compliant order exists.
  if (sizing.compliantQuantity === null) {
    blockingReasons.push(
      `sizing failed: ${sizing.reasons.join("; ") || "no compliant quantity"}`,
    );
  }

  // Gate 2: strategy. A NEUTRAL verdict must never become an authorization.
  const positiveNetEdge = quant.netEdge > 0 && quant.action !== "NEUTRAL";
  if (!positiveNetEdge) {
    blockingReasons.push(
      `Quant returned ${quant.action} with net edge ${quant.netEdgePct}% — no positive edge, no order`,
    );
  }

  // Risk is evaluated against the COMPLIANT size, not the requested target.
  let risk: PreflightPacket["risk"] = null;
  if (sizing.compliantQuantity !== null) {
    const qty = sizing.compliantQuantity;
    const direction = quant.action === "BUY_BASIS" ? "buy" : "sell";
    const result = StructuralChangeGuard.evaluateBlastRadius(
      { symbol: config.symbol, side: direction, quantity: qty, priceUsd: Number(config.referencePriceUsd) },
      { equityUsd: account.equityUsd, usedMarginUsd: 0, freeMarginUsd: account.freeMarginUsd, openOrders: [] },
    );
    risk = {
      decision: result.decision,
      exposureUsd: result.exposureUsd,
      projectedMarginUtilization: result.projectedMarginUtilization,
    };
    if (result.decision !== "APPROVED") {
      blockingReasons.push(`Risk Boy ${result.decision}: ${result.reasons.join("; ")}`);
    }
    // Risk APPROVED does NOT override a Quant NEUTRAL. Stated explicitly so a
    // future reader cannot mistake an APPROVED risk line for a green light.
    if (!positiveNetEdge) {
      blockingReasons.push("Risk APPROVED does not override a Quant NEUTRAL verdict");
    }
  }

  return {
    repositorySymbol: REPO_SYMBOL,
    venueSymbol: config.symbol,
    referencePriceUsd: Number(config.referencePriceUsd),
    sizing,
    quant,
    positiveNetEdge,
    executable: blockingReasons.length === 0,
    blockingReasons,
    risk,
  };
}

/**
 * Seal the receipt and derive intent-bound clientOids for open and close.
 *
 * The intent is mixed into the digest so an open and a close built from the
 * same receipt cannot collide into a venue 40786 Duplicate clientOid.
 */
export function sealIntents(args: {
  quant: QuantAnalysisResult;
  repositorySymbol: string;
  sizing: SizingSummary;
  projectedLiquidationPrice: number;
  councilScores: { compositeScore: number; macro: number; quant: number; risk: number; exec: number };
  rationale: string;
}): { receiptHash: string; clientOidOpen: string; clientOidClose: string } {
  const { quant, repositorySymbol, sizing, projectedLiquidationPrice, councilScores, rationale } = args;
  const receipt = sealReceipt({
    symbol: repositorySymbol,
    action: quant.action,
    quantMetrics: quant,
    riskReport: {
      permitted: true,
      projectedMarginUtilizationPct: sizing.compliantQuantity === null ? 0 : 1,
      projectedLiquidationPrice,
      staleOrdersToCancel: [],
    },
    councilScores,
    decision: "APPROVED",
    rationale,
  });
  const oid = (intent: string) =>
    createHash("sha256").update(`${receipt.receiptHash}:${intent}`).digest("hex").slice(0, 32);
  return {
    receiptHash: receipt.receiptHash,
    clientOidOpen: oid("open"),
    clientOidClose: oid("close"),
  };
}
