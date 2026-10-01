/**
 * Fixture-backed open-hours campaign harness (no venue contact).
 *
 * WHAT THIS IS
 *   The end-to-end shape of the bounded Demo campaign, exercised entirely
 *   against a deterministic fixture: a known regular open session, a fresh
 *   receipt-relative benchmark, a positive net edge, and the full lifecycle
 *   open -> read-back -> close -> flatten -> FLAT.
 *
 * WHAT THIS IS NOT
 *   It NEVER reaches a venue. The dispatcher is a scripted double that records
 *   an authoritative position book, so read-back is a real reconciliation
 *   against simulated state rather than an echo of the fill response. That is
 *   the whole point of the read-back step: it must be able to DISAGREE with
 *   the fill and be believed over it.
 *
 *   No live Robinhood read. No order. No scheduler. No polling.
 *
 * WHY FIXTURES FOR A CAMPAIGN
 *   A campaign run against a live provider would prove one observation, not the
 *   control path. Fixtures prove the path. Live eligibility remains separately
 *   gated behind GAP-017 and GAP-019.
 */
import { sealReceipt, verifyReceipt, type SealedReasoningReceipt } from "../council/receipts.js";
import { evaluateBasisSpread } from "../agents/quant.js";
import { resolveSession, type CalendarDay, type TradingCalendar } from "../agents/session-calendar.js";
import { buildSameDayChecklist } from "../agents/calendar-dataset.js";
import { buildStrategyPacket, type StrategyPacketV1 } from "../bitget/strategy-packet-v1.js";
import { dispatchPacket, type BridgeDispatcher } from "../bitget/bridge.js";
import { StructuralChangeGuard, toBlastRadiusReport } from "../skills/igraph-guard/security.js";
import type { ExecutionRecord } from "../bitget/dispatcher.js";

const TRADING_DAY = "2026-10-05"; // Monday, a known regular session
const OPEN_ET = new Date("2026-10-05T16:30:00.000Z"); // 12:30 ET

function calendarOf(days: CalendarDay[]): TradingCalendar {
  const map: Record<string, CalendarDay> = {};
  for (const d of days) map[d.date] = d;
  return { id: "campaign-fixture-cal", exchange: "NYSE", days: map };
}
const REGULAR_CAL = calendarOf([{ date: TRADING_DAY, type: "REGULAR" }]);

/**
 * Authoritative position book. Fills mutate it; read-back reads it. The two
 * are deliberately independent so a read-back mismatch is detectable.
 */
class PositionBook {
  positions = new Map<string, number>();
  snapshots: { at: string; positions: Record<string, number>; flat: boolean }[] = [];

  record(): Record<string, number> {
    return Object.fromEntries(this.positions);
  }
  flat(): boolean {
    return [...this.positions.values()].every((v) => v === 0);
  }
  snapshot(at: string): void {
    this.snapshots.push({ at, positions: this.record(), flat: this.flat() });
  }
}

interface ScriptedVenue {
  dispatcher: BridgeDispatcher;
  book: PositionBook;
  calls: { method: string; symbol: string; side: string; quantity: number; receiptHash: string }[];
}

/**
 * Scripted dispatcher double.
 *
 * `fillMismatchSymbol` simulates a venue filling a DIFFERENT symbol than
 * requested, which is the case that proves read-back is load-bearing.
 */
function scriptedVenue(opts: { fillMismatchSymbol?: boolean } = {}): ScriptedVenue {
  const book = new PositionBook();
  const calls: ScriptedVenue["calls"] = [];
  let seq = 0;

  const apply = (
    method: string,
    receipt: SealedReasoningReceipt,
    params: { symbol: string; side: "BUY" | "SELL"; quantity: number; fillPriceUsd: number },
  ): ExecutionRecord => {
    seq += 1;
    const orderId = `fixture-${seq}`;
    calls.push({ method, symbol: params.symbol, side: params.side, quantity: params.quantity, receiptHash: receipt.receiptHash });
    // A SELL reduces, a BUY increases, in this one-way fixture.
    const current = book.positions.get(params.symbol) ?? 0;
    const delta = params.side === "SELL" ? -params.quantity : params.quantity;
    book.positions.set(params.symbol, Number((current + delta).toFixed(8)));
    return {
      orderId,
      clientOid: `oid-${seq}`,
      symbol: params.symbol,
      side: params.side,
      mode: "DEMO",
      quantity: params.quantity,
      fillPriceUsd: params.fillPriceUsd,
      feeUsd: 0,
      status: "FILLED",
      receiptHash: receipt.receiptHash,
      executedAt: OPEN_ET.toISOString(),
      latencyMs: 1,
      venueResponse: {
        // Simulates the venue reporting a different symbol back.
        reportedSymbol: opts.fillMismatchSymbol ? "SOMEOTHERUSDT" : params.symbol,
      },
    };
  };

  return {
    book,
    calls,
    dispatcher: {
      dispatch: async (receipt, params) => apply("dispatch", receipt, params),
      closePosition: async (receipt, params) => apply("closePosition", receipt, params),
    },
  };
}

/** Deterministic Quant result with a positive edge. */
function positiveQuant() {
  const mid = 229.95;
  const depth = {
    bids: Array.from({ length: 10 }, (_, i) => ({ price: mid * (1 - 0.0002 * (i + 1)), quantity: 40 })),
    asks: Array.from({ length: 10 }, (_, i) => ({ price: mid * (1 + 0.0002 * (i + 1)), quantity: 40 })),
  };
  return evaluateBasisSpread({
    tokenPrice: mid,
    tradFiClosePrice: mid * 0.997, // ~0.3% dislocation
    orderSizeUsd: 25,
    depth,
    fundingRate8h: 0,
    hoursToClose: 1,
    takerFee: 0.0006,
  });
}

/**
 * The authoritative read-back: read position state from the venue and compare
 * against the intent. A fill response is NOT sufficient evidence.
 */
function readBack(args: {
  book: PositionBook;
  execution: ExecutionRecord;
  intent: { symbol: string; side: "BUY" | "SELL"; quantity: number };
}): { matches: boolean; observed: number; expected: number; venueReportedSymbol: string; symbolAgrees: boolean } {
  args.book.snapshot(args.execution.executedAt);
  const observed = args.book.positions.get(args.intent.symbol) ?? 0;
  const expected = args.intent.side === "SELL" ? -args.intent.quantity : args.intent.quantity;
  const venueReportedSymbol = String(
    (args.execution.venueResponse as { reportedSymbol?: string } | undefined)?.reportedSymbol ?? args.execution.symbol,
  );
  return {
    matches: Math.abs(observed - expected) < 1e-9,
    observed,
    expected,
    venueReportedSymbol,
    symbolAgrees: venueReportedSymbol === args.intent.symbol,
  };
}

export interface CampaignStep {
  step: string;
  ok: boolean;
  detail: Record<string, unknown>;
}

export interface CampaignResult {
  eligible: boolean;
  decision: "DISPATCHED_AND_FLAT" | "NO_TRADE";
  steps: CampaignStep[];
  session: ReturnType<typeof resolveSession>;
  calls: ScriptedVenue["calls"];
  venueContacts: number;
  finalFlat: boolean;
  packet?: StrategyPacketV1;
  receiptHash?: string;
}

/**
 * Run one bounded campaign cycle against fixtures.
 *
 * `scenarios` selects which fixture conditions to exercise. All of them are
 * negative unless `freshOpenPositiveEdge` is set, and every negative path must
 * record `venueContacts === 0`.
 */
export async function runFixtureCampaign(scenarios: {
  freshOpenPositiveEdge?: boolean;
  calendar?: TradingCalendar;
  dispatchDelayMs?: number;
  now?: Date;
  fillMismatchSymbol?: boolean;
  /**
   * Supplying an incomplete/absent checklist exercises the dispatch-boundary
   * gate. Omitted by default so the happy path reaches the venue.
   */
  sameDayChecklist?: Parameters<typeof buildSameDayChecklist>[0];
  omitChecklist?: boolean;
} = {}): Promise<CampaignResult> {
  const steps: CampaignStep[] = [];
  const now = scenarios.now ?? OPEN_ET;
  const venue = scriptedVenue({ fillMismatchSymbol: scenarios.fillMismatchSymbol });
  const calendar = scenarios.calendar ?? REGULAR_CAL;

  const add = (step: string, ok: boolean, detail: Record<string, unknown> = {}) => {
    steps.push({ step, ok, detail });
    return ok;
  };

  // ---- 1. Session gate ----------------------------------------------------
  const session = resolveSession({ now, calendar });
  if (!add("session_gate", session.tradable, { code: (session as { code?: string }).code ?? "TRADABLE", date: session.date })) {
    return {
      eligible: false, decision: "NO_TRADE", steps, session, calls: venue.calls,
      venueContacts: venue.calls.length, finalFlat: true,
    };
  }

  // ---- 2. Benchmark admission (fixture) -----------------------------------
  const quant = scenarios.freshOpenPositiveEdge === false
    ? evaluateBasisSpread({
        tokenPrice: 229.95, tradFiClosePrice: 229.95, orderSizeUsd: 25,
        depth: { bids: [], asks: [] },
        fundingRate8h: 0, hoursToClose: 1, takerFee: 0.0006,
      })
    : positiveQuant();
  add("quant_evaluated", true, { action: quant.action, netEdgePct: quant.netEdgePct });

  if (scenarios.freshOpenPositiveEdge === false) {
    add("positive_edge_required", false, { reason: "fixture scenario has no positive edge" });
    return {
      eligible: false, decision: "NO_TRADE", steps, session, calls: venue.calls,
      venueContacts: venue.calls.length, finalFlat: true,
    };
  }

  const sourceAsOf = new Date(now.getTime() - 500);
  const responseReceivedAt = new Date(now.getTime());
  const ageAtReceiptMs = responseReceivedAt.getTime() - sourceAsOf.getTime();

  const packet = buildStrategyPacket({
    symbolMapping: { repoSymbol: "rNVDAUSDT", venueSymbol: "NVDAUSDT", referenceSymbol: "NVDA" },
    benchmark: {
      provider: "robinhood_stock_token_api",
      sourceAsOf: sourceAsOf.toISOString(),
      requestedAt: new Date(now.getTime() - 100).toISOString(),
      responseReceivedAt: responseReceivedAt.toISOString(),
      ageAtReceiptMs,
      freshnessBasis: "receipt-relative",
      freshness: ageAtReceiptMs < 15_000 ? "verified_fresh" : "verified_stale",
      effectiveThresholdMs: 15_000,
      timestampType: "PROVIDER_GENERATED_QUOTE",
      bid: 229.9, ask: 230.0, midpoint: 229.95, isTradingHalt: false,
    } as never,
    session: {
      date: session.date,
      dayType: session.type,
      calendarId: calendar.id,
      exchange: calendar.exchange,
      // Narrowed: resolveSession returns a union and this branch is only
      // reached after `session.tradable` was asserted true.
      openMinute: session.tradable ? session.openMinute : 0,
      closeMinute: session.tradable ? session.closeMinute : 0,
      admissionMinute: Math.floor((now.getTime() - new Date(now).getTimezoneOffset() * 60_000) / 60_000) % 1440,
    },
    quant,
    sizing: {
      compliantQuantity: 0.12, roundedNotionalUsd: 27.6,
      minQty: 0.01, minNotionalUsdt: 5, multiplier: 0.01,
    },
    risk: { decision: "APPROVED", exposureUsd: 27.6, projectedMarginUtilization: 0.003 },
    council: { compositeScore: 82, macro: 80, quant: 85, risk: 80, exec: 78 },
    now,
  });

  if ((packet as { ok?: boolean }).ok === false) {
    add("packet_admission", false, { reasons: (packet as { reasons: string[] }).reasons });
    return {
      eligible: false, decision: "NO_TRADE", steps, session, calls: venue.calls,
      venueContacts: venue.calls.length, finalFlat: true,
    };
  }
  const goodPacket = packet as StrategyPacketV1;
  add("packet_admission", true, { expiresAt: goodPacket.expiresAt, netEdgePct: quant.netEdgePct });

  // ---- 3. Receipt ---------------------------------------------------------
  const blast = StructuralChangeGuard.evaluateBlastRadius(
    { symbol: goodPacket.symbolMapping.venueSymbol, side: "sell", quantity: goodPacket.sizing.compliantQuantity, priceUsd: goodPacket.quant.midPrice },
    { equityUsd: 9364.2, usedMarginUsd: 0, freeMarginUsd: 9364.2, openOrders: [] },
  );
  const receipt = sealReceipt({
    symbol: goodPacket.symbolMapping.venueSymbol,
    action: goodPacket.quant.action,
    quantMetrics: goodPacket.quant,
    riskReport: toBlastRadiusReport(blast),
    councilScores: goodPacket.council,
    decision: blast.decision === "APPROVED" ? "APPROVED" : "VETOED",
    rationale: "Bounded Demo campaign fixture.",
  });
  add("receipt_sealed", verifyReceipt(receipt), { receiptHash: receipt.receiptHash, decision: receipt.decision });

  // ---- 4. Dispatch --------------------------------------------------------
  const dispatchNow = scenarios.dispatchDelayMs ? new Date(now.getTime() + scenarios.dispatchDelayMs) : now;
  const opened = await dispatchPacket({
    packet: goodPacket, receipt, intent: "open", dispatcher: venue.dispatcher,
    calendar, now: dispatchNow, environmentMode: "DEMO",
    sameDayChecklist: buildSameDayChecklist(scenarios.sameDayChecklist ?? {
      annualCalendarReviewed: true, traderAlertsChecked: true, noUnscheduledChange: true,
      operatorConfirmed: true, confirmedBy: "fixture operator", confirmedAt: now.toISOString(),
    }),
  });
  if (!opened.ok || opened.execution === undefined) {
    const reasons = opened.ok ? ["dispatcher returned no execution record"] : opened.reasons;
    add("dispatch_open", false, { reasons, venueCalls: opened.ok ? 1 : opened.venueCalls });
    return {
      eligible: false, decision: "NO_TRADE", steps, session, calls: venue.calls,
      venueContacts: venue.calls.length, finalFlat: venue.book.flat(),
      packet: goodPacket, receiptHash: receipt.receiptHash,
    };
  }
  add("dispatch_open", true);

  // ---- 5. Read-back (authoritative, not the fill response) ----------------
  const openRead = readBack({
    book: venue.book,
    execution: opened.execution,
    intent: { symbol: goodPacket.symbolMapping.venueSymbol, side: "SELL", quantity: goodPacket.sizing.compliantQuantity },
  });
  add("read_back_open", openRead.matches && openRead.symbolAgrees, {
    observed: openRead.observed, expected: openRead.expected,
    venueReportedSymbol: openRead.venueReportedSymbol,
  });

  // ---- 6. Close -----------------------------------------------------------
  const closed = await dispatchPacket({
    packet: goodPacket, receipt, intent: "close", dispatcher: venue.dispatcher,
    calendar, now: dispatchNow, environmentMode: "DEMO",
    sameDayChecklist: buildSameDayChecklist(scenarios.sameDayChecklist ?? {
      annualCalendarReviewed: true, traderAlertsChecked: true, noUnscheduledChange: true,
      operatorConfirmed: true, confirmedBy: "fixture operator", confirmedAt: now.toISOString(),
    }),
  });
  if (!closed.ok || closed.execution === undefined) {
    add("dispatch_close", false, { reasons: closed.ok ? ["no execution record"] : closed.reasons });
    return {
      eligible: false, decision: "NO_TRADE", steps, session, calls: venue.calls,
      venueContacts: venue.calls.length, finalFlat: venue.book.flat(),
      packet: goodPacket, receiptHash: receipt.receiptHash,
    };
  }
  add("dispatch_close", true);

  // ---- 7. Flatten read-back ----------------------------------------------
  const closeRead = readBack({
    book: venue.book,
    execution: closed.execution,
    intent: { symbol: goodPacket.symbolMapping.venueSymbol, side: "BUY", quantity: goodPacket.sizing.compliantQuantity },
  });
  const flat = venue.book.flat();
  add("read_back_flat", flat, { positions: venue.book.record(), observed: closeRead.observed });
  venue.book.snapshot("final");

  return {
    eligible: true,
    decision: "DISPATCHED_AND_FLAT",
    steps,
    session,
    calls: venue.calls,
    venueContacts: venue.calls.length,
    finalFlat: flat,
    packet: goodPacket,
    receiptHash: receipt.receiptHash,
  };
}