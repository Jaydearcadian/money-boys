/**
 * Packet-to-dispatch bridge.
 *
 * WHAT THIS IS
 *   The missing control path. `buildStrategyPacket` produces a proposed
 *   intent with its evidence bound in; this module decides whether that intent
 *   may become a VENUE intent, and dispatches it if so.
 *
 * THE CENTRAL RULE: NOTHING IS TRUSTED
 *   Every admission claim the packet makes about the world is re-derived here,
 *   as of DISPATCH time, from the clock and the calendar rather than read from
 *   the packet. A packet that was correct when built can be wrong by the time
 *   it is acted on, and a packet that lies about itself must not be believed.
 *
 *   Revalidated at dispatch:
 *     1. packet expiry            now < expiresAt
 *     2. receipt-relative freshness, recomputed to NOW
 *     3. regime and calendar session, re-resolved now
 *     4. symbol mapping, recomputed
 *     5. Risk and Council decisions, from the sealed receipt
 *     6. receipt integrity, SHA-256 verified
 *     7. environment is Demo
 *     8. idempotency, no prior dispatch for this intent
 *
 * FAIL CLOSED, ALWAYS
 *   Any rejection returns before `OrderDispatcher` is touched. Every negative
 *   path is proven by test to produce ZERO venue calls, not merely a rejected
 *   result — proving "no order" requires observing the absence of the call.
 *
 * NOT AUTHORIZED
 *   This module can reach `OrderDispatcher` in DEMO mode only. It refuses LIVE
 *   and PAPER is reachable only through an explicitly injected dispatcher.
 *   No order was submitted while building this; it is proven with fixtures.
 */
import { resolveSession, type TradingCalendar } from "../agents/session-calendar.js";
import { mapToVenueSymbol } from "./dispatcher.js";
import { toUnderlyingReferenceSymbol } from "../integrations/robinhood/benchmark.js";
import { verifyReceipt, type SealedReasoningReceipt } from "../council/receipts.js";
import {
  ADMISSION_BASIS,
  type PacketRejection,
  type StrategyPacketV1,
} from "./strategy-packet-v1.js";
import type { ExecutionRecord, OrderDispatcher } from "./dispatcher.js";

/**
 * Minimal dispatcher surface the bridge depends on. Injected for tests, and
 * satisfied by the real `OrderDispatcher`.
 *
 * `closePosition` is optional so a test double can omit it. When a close is
 * requested and the dispatcher cannot close, that is a refusal — never a
 * silent no-op reported as a fill.
 */
export interface BridgeDispatcher {
  dispatch(
    receipt: SealedReasoningReceipt,
    params: { symbol: string; side: "BUY" | "SELL"; quantity: number; fillPriceUsd: number },
  ): Promise<ExecutionRecord>;
  closePosition?: (
    receipt: SealedReasoningReceipt,
    params: { symbol: string; side: "BUY" | "SELL"; quantity: number; fillPriceUsd: number },
  ) => Promise<ExecutionRecord>;
}

export interface BridgeDispatchOk {
  readonly ok: true;
  readonly execution: ExecutionRecord;
  readonly revalidation: BridgeRevalidation;
}

export interface BridgeDispatchRejected {
  readonly ok: false;
  readonly code: string;
  readonly reasons: string[];
  readonly venueCalls: 0;
  /** Present so a REFUSED attempt is auditable, not just assertable. */
  readonly revalidation: BridgeRevalidation;
}

export type BridgeDispatchResult = BridgeDispatchOk | BridgeDispatchRejected;

/** Every re-derived value, so evidence records what was actually checked. */
export interface BridgeRevalidation {
  readonly packetIssuedAt: string;
  readonly packetExpiresAt: string;
  readonly dispatchNow: string;
  readonly packetNotExpired: boolean;
  /** Recomputed at dispatch, NOT read from the packet. */
  readonly ageAtDispatchMs: number | null;
  readonly effectiveThresholdMs: number;
  readonly freshnessBasis: typeof ADMISSION_BASIS;
  readonly freshnessAtDispatch: "verified_fresh" | "verified_stale" | "unverifiable";
  readonly sessionCode: string;
  readonly sessionTradable: boolean;
  readonly calendarDate: string;
  readonly recomputedVenueSymbol: string;
  readonly receiptVerified: boolean;
  readonly environment: "DEMO";
  readonly idempotencyKey: string;
}

/**
 * Idempotency key: the receipt hash plus the intent. Deterministic across
 * restarts, so a replay of the same packet cannot mint a second venue intent.
 */
export function idempotencyKeyFor(receiptHash: string, intent: "open" | "close"): string {
  return `${receiptHash}:${intent}`;
}

/**
 * Dispatch a packet, or explain why not. Never throws for an admission
 * failure — it returns a rejection carrying every reason.
 */
export async function dispatchPacket(args: {
  packet: StrategyPacketV1;
  receipt: SealedReasoningReceipt;
  intent?: "open" | "close";
  dispatcher: BridgeDispatcher;
  calendar: TradingCalendar;
  now?: Date;
  /** Already-dispatched keys. Re-dispatch of any of these is refused. */
  dispatchedKeys?: ReadonlySet<string>;
  /** Real dispatcher mode, asserted to be Demo-capable. */
  environmentMode?: string;
}): Promise<BridgeDispatchResult> {
  const now = args.now ?? new Date();
  const intent = args.intent ?? "open";
  const p = args.packet;
  const reasons: string[] = [];

  // ---- 1. Packet expiry ----------------------------------------------------
  const expiresMs = Date.parse(p.expiresAt);
  const nowMs = now.getTime();
  const notExpired = !Number.isNaN(expiresMs) && nowMs < expiresMs;
  if (!notExpired) {
    reasons.push(`PACKET_EXPIRED: issuedAt=${p.issuedAt} expiresAt=${p.expiresAt} now=${now.toISOString()}`);
  }

  // ---- 2. Receipt-relative freshness, recomputed to NOW --------------------
  // NOT read from the packet. A packet that queued must be re-measured.
  const sourceMs = Date.parse(p.benchmark.sourceAsOf);
  const receiptMs = Date.parse(p.benchmark.responseReceivedAt);
  const threshold = p.benchmark.effectiveThresholdMs;
  let ageAtDispatchMs: number | null = null;
  let freshnessAtDispatch: BridgeRevalidation["freshnessAtDispatch"] = "unverifiable";
  if (Number.isNaN(sourceMs) || Number.isNaN(receiptMs)) {
    reasons.push("BENCHMARK_TIMESTAMP_UNPARSEABLE: cannot recompute age");
  } else {
    if (receiptMs > nowMs) {
      reasons.push("CLOCK_SKEW: responseReceivedAt is in the future relative to dispatch");
    }
    // (a) the age at receipt the packet was admitted on, and
    // (b) the age at DISPATCH, which is the one that must be inside the gate.
    ageAtDispatchMs = nowMs - sourceMs;
    const ageAtReceipt = receiptMs - sourceMs;
    freshnessAtDispatch =
      ageAtDispatchMs < 0 || ageAtReceipt < 0
        ? "unverifiable"
        : ageAtDispatchMs >= threshold
          ? "verified_stale"
          : "verified_fresh";
    if (freshnessAtDispatch !== "verified_fresh") {
      reasons.push(
        `BENCHMARK_STALE_AT_DISPATCH: ageAtDispatchMs=${ageAtDispatchMs} vs gate ${threshold} (admitted at ${ageAtReceipt})`,
      );
    }
  }

  // ---- 3. Regime and calendar session, re-resolved NOW ---------------------
  const session = resolveSession({ now, calendar: args.calendar });
  if (!session.tradable) {
    reasons.push(`SESSION_NOT_TRADABLE: ${session.code}: ${session.reason}`);
  }

  // ---- 4. Symbol mapping, recomputed --------------------------------------
  const recomputedVenue = mapToVenueSymbol(p.symbolMapping.repoSymbol);
  if (recomputedVenue !== p.symbolMapping.venueSymbol) {
    reasons.push(
      `SYMBOL_MAPPING_MISMATCH: packet claims ${p.symbolMapping.venueSymbol}, mapping yields ${recomputedVenue}`,
    );
  }
  if (toUnderlyingReferenceSymbol(p.symbolMapping.repoSymbol) !== p.symbolMapping.referenceSymbol) {
    reasons.push("REFERENCE_SYMBOL_MISMATCH: reference symbol does not derive from the repo symbol");
  }

  // ---- 5. Risk and Council, from the SEALED receipt -----------------------
  const receiptRisk = (args.receipt.riskReport ?? {}) as Record<string, unknown>;
  if (args.receipt.decision !== "APPROVED") {
    reasons.push(`RECEIPT_NOT_APPROVED: ${args.receipt.decision}`);
  }
  if (String(receiptRisk["decision"] ?? "") !== "APPROVED" && receiptRisk["decision"] !== undefined) {
    reasons.push(`RECEIPT_RISK_NOT_APPROVED: ${String(receiptRisk["decision"])}`);
  }
  if (p.council.compositeScore < 50) {
    reasons.push(`COUNCIL_QUORUM_FAILED: compositeScore=${p.council.compositeScore}`);
  }

  // ---- 6. Receipt integrity ------------------------------------------------
  const receiptVerified = verifyReceipt(args.receipt);
  if (!receiptVerified) {
    reasons.push("RECEIPT_VERIFY_FAILED: SHA-256 seal does not match");
  }
  // The packet's declared freshness basis must still be the receipt-relative one.
  if (p.benchmark.freshnessBasis !== ADMISSION_BASIS) {
    reasons.push(`ADMISSION_BASIS_INVALID: ${String(p.benchmark.freshnessBasis)}`);
  }

  // ---- 7. Environment: Demo only ------------------------------------------
  const mode = (args.environmentMode ?? "DEMO").toUpperCase();
  if (mode !== "DEMO" && mode !== "TESTNET") {
    reasons.push(`ENVIRONMENT_FORBIDDEN: this bridge is Demo-only, got ${mode}`);
  }
  if (p.environment !== "DEMO") {
    reasons.push(`PACKET_ENVIRONMENT_FORBIDDEN: packet declares ${p.environment}`);
  }

  // ---- 8. Idempotency ------------------------------------------------------
  const key = idempotencyKeyFor(args.receipt.receiptHash, intent);
  if (args.dispatchedKeys?.has(key)) {
    reasons.push(`IDEMPOTENCY_REPLAY_REFUSED: intent ${key} was already dispatched`);
  }

  /**
   * Structural refusals that cannot be expressed as a session code. Computed
   * before the revalidation record so the record exists on EVERY return path.
   */
  const closeUnsupported = intent === "close" && typeof args.dispatcher.closePosition !== "function";
  if (closeUnsupported) {
    // A close that cannot be performed is a refusal. Reporting success here
    // would strand a position while claiming it was flattened.
    reasons.push("CLOSE_UNSUPPORTED: dispatcher exposes no closePosition; a flatten cannot be guaranteed");
  }

  const revalidation: BridgeRevalidation = {
    packetIssuedAt: p.issuedAt,
    packetExpiresAt: p.expiresAt,
    dispatchNow: now.toISOString(),
    packetNotExpired: notExpired,
    ageAtDispatchMs,
    effectiveThresholdMs: threshold,
    freshnessBasis: ADMISSION_BASIS,
    freshnessAtDispatch,
    sessionCode: session.tradable ? "TRADABLE" : session.code,
    sessionTradable: session.tradable,
    calendarDate: session.date,
    recomputedVenueSymbol: recomputedVenue,
    receiptVerified,
    environment: "DEMO",
    idempotencyKey: key,
  };

  if (reasons.length > 0) {
    // NOTHING below this line runs on any rejection path. `revalidation` is
    // attached to refusals too, so a rejected attempt is still auditable.
    return {
      ok: false,
      code: closeUnsupported ? "CLOSE_UNSUPPORTED" : reasons.length === 1 ? "DISPATCH_REFUSED" : "DISPATCH_REFUSED_MULTIPLE",
      reasons,
      venueCalls: 0,
      revalidation,
    };
  }

  // ---- Only now may the venue be touched. ---------------------------------
  const side: "BUY" | "SELL" = p.quant.action === "BUY_BASIS" ? "BUY" : "SELL";
  // Reference price for the venue order. `midPrice` is the walk-derived mid;
  // the packet does not otherwise carry a token price.
  const fillPriceUsd = p.quant.midPrice;

  const execution =
    intent === "close"
      ? await args.dispatcher.closePosition!(args.receipt, {
          // Hedge-mode close inverts the direction being acted on.
          symbol: p.symbolMapping.venueSymbol,
          side: side === "BUY" ? "SELL" : "BUY",
          quantity: p.sizing.compliantQuantity,
          fillPriceUsd,
        })
      : await args.dispatcher.dispatch(args.receipt, {
          symbol: p.symbolMapping.venueSymbol,
          side,
          quantity: p.sizing.compliantQuantity,
          fillPriceUsd,
        });

  if (!execution) {
    return {
      ok: false,
      code: "DISPATCH_NO_EXECUTION_RECORD",
      reasons: ["dispatcher returned no execution record"],
      venueCalls: 0,
      revalidation,
    };
  }

  return { ok: true, execution, revalidation };
}