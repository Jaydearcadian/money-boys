import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dispatchPacket, idempotencyKeyFor, type BridgeDispatcher } from "../src/bitget/bridge.js";
import { buildStrategyPacket, type StrategyPacketV1 } from "../src/bitget/strategy-packet-v1.js";
import type { CalendarDay, TradingCalendar } from "../src/agents/session-calendar.js";
import { buildSameDayChecklist, type SameDayChecklist } from "../src/agents/calendar-dataset.js";
import { evaluateBasisSpread, type QuantAnalysisResult } from "../src/agents/quant.js";
import { sealReceipt, verifyReceipt, type SealedReasoningReceipt } from "../src/council/receipts.js";
import { StructuralChangeGuard, toBlastRadiusReport } from "../src/skills/igraph-guard/security.js";
import type { ExecutionRecord } from "../src/bitget/dispatcher.js";

/**
 * Deterministic packet-to-dispatch bridge E2E.
 *
 * ZERO network. ZERO venue contact. The dispatcher is an instrumented test
 * double that COUNTS calls, because proving "no order" requires observing the
 * ABSENCE of the call — not merely a rejected return value.
 *
 * The governing claim: every negative path produces `venueCalls === 0`.
 */

const TRADING_DAY = "2026-10-05"; // Monday
const OPEN_ET = new Date("2026-10-05T16:30:00.000Z"); // 12:30 ET
const CLOSED_ET = new Date("2026-10-05T21:00:00.000Z"); // 17:00 ET, after close

function cal(days: CalendarDay[]): TradingCalendar {
  const map: Record<string, CalendarDay> = {};
  for (const d of days) map[d.date] = d;
  return { id: "bridge-test-cal", exchange: "NYSE", days: map };
}
const REGULAR_CAL = cal([{ date: TRADING_DAY, type: "REGULAR" }]);

/** Counts venue calls. Every assertion about refusal inspects this. */
class CountingDispatcher implements BridgeDispatcher {
  calls: { method: "dispatch" | "closePosition"; symbol: string; side: string; quantity: number }[] = [];
  async dispatch(
    _receipt: SealedReasoningReceipt,
    params: { symbol: string; side: "BUY" | "SELL"; quantity: number; fillPriceUsd: number },
  ): Promise<ExecutionRecord> {
    this.calls.push({ method: "dispatch", symbol: params.symbol, side: params.side, quantity: params.quantity });
    return {
      orderId: "fixture-open-1",
      clientOid: "fixture-oid-open",
      symbol: params.symbol,
      side: params.side,
      mode: "DEMO",
      quantity: params.quantity,
      fillPriceUsd: params.fillPriceUsd,
      feeUsd: 0,
      status: "FILLED",
      receiptHash: "n/a",
      executedAt: "2026-10-05T16:30:00.000Z",
      latencyMs: 1,
    };
  }
  async closePosition(
    _receipt: SealedReasoningReceipt,
    params: { symbol: string; side: "BUY" | "SELL"; quantity: number; fillPriceUsd: number },
  ): Promise<ExecutionRecord> {
    this.calls.push({ method: "closePosition", symbol: params.symbol, side: params.side, quantity: params.quantity });
    return {
      orderId: "fixture-close-1",
      clientOid: "fixture-oid-close",
      symbol: params.symbol,
      side: params.side,
      mode: "DEMO",
      quantity: params.quantity,
      fillPriceUsd: params.fillPriceUsd,
      feeUsd: 0,
      status: "FILLED",
      receiptHash: "n/a",
      executedAt: "2026-10-05T16:31:00.000Z",
      latencyMs: 1,
    };
  }
}

function quantOf(netEdge: number, action: "BUY_BASIS" | "SELL_BASIS" | "NEUTRAL"): QuantAnalysisResult {
  const mid = 229.95;
  const depth = {
    bids: Array.from({ length: 10 }, (_, i) => ({ price: mid * (1 - 0.0002 * (i + 1)), quantity: 40 })),
    asks: Array.from({ length: 10 }, (_, i) => ({ price: mid * (1 + 0.0002 * (i + 1)), quantity: 40 })),
  };
  const r = evaluateBasisSpread({
    tokenPrice: mid, tradFiClosePrice: mid * (1 - netEdge), orderSizeUsd: 25, depth,
    fundingRate8h: 0, hoursToClose: 1, takerFee: 0.0006,
  });
  return { ...r, netEdge, action };
}

function makePacket(over: Record<string, unknown> = {}): StrategyPacketV1 {
  const base = {
    symbolMapping: { repoSymbol: "rNVDAUSDT", venueSymbol: "NVDAUSDT", referenceSymbol: "NVDA" },
    benchmark: {
      provider: "robinhood_stock_token_api",
      // Response was received 100ms after the request; admission/dispatch
      // happens at OPEN_ET, which is that receipt instant.
      sourceAsOf: new Date(OPEN_ET.getTime() - 500).toISOString(),
      requestedAt: new Date(OPEN_ET.getTime() - 100).toISOString(),
      responseReceivedAt: OPEN_ET.toISOString(),
      ageAtReceiptMs: 500,
      freshnessBasis: "receipt-relative" as const,
      freshness: "verified_fresh" as const,
      effectiveThresholdMs: 15_000,
      timestampType: "PROVIDER_GENERATED_QUOTE",
      bid: 229.9, ask: 230.0, midpoint: 229.95, isTradingHalt: false as const,
    },
    session: {
      date: TRADING_DAY, dayType: "REGULAR" as const, calendarId: "bridge-test-cal",
      exchange: "NYSE", openMinute: 570, closeMinute: 960, admissionMinute: 750,
    },
    quant: quantOf(0.003, "SELL_BASIS"),
    sizing: {
      compliantQuantity: 0.12, roundedNotionalUsd: 27.6, minQty: 0.01,
      minNotionalUsdt: 5, multiplier: 0.01,
    },
    risk: { decision: "APPROVED" as const, exposureUsd: 27.6, projectedMarginUtilization: 0.003 },
    council: { compositeScore: 80, macro: 78, quant: 82, risk: 80, exec: 76 },
    now: OPEN_ET,
  };
  const merged = { ...base, ...over } as Parameters<typeof buildStrategyPacket>[0];
  const p = buildStrategyPacket(merged);
  assert.equal((p as { ok?: boolean }).ok, undefined, `fixture packet was rejected: ${JSON.stringify(p)}`);
  return p as StrategyPacketV1;
}

function approvedReceipt(p: StrategyPacketV1): SealedReasoningReceipt {
  const blast = StructuralChangeGuard.evaluateBlastRadius(
    { symbol: p.symbolMapping.venueSymbol, side: "sell", quantity: p.sizing.compliantQuantity, priceUsd: p.quant.midPrice },
    { equityUsd: 9364.2, usedMarginUsd: 0, freeMarginUsd: 9364.2, openOrders: [] },
  );
  return sealReceipt({
    symbol: p.symbolMapping.venueSymbol,
    action: p.quant.action,
    quantMetrics: p.quant,
    riskReport: toBlastRadiusReport(blast),
    councilScores: p.council,
    decision: "APPROVED",
    rationale: "Bridge E2E fixture.",
  });
}

async function run(args: {
  packet?: StrategyPacketV1;
  receipt?: SealedReasoningReceipt;
  now?: Date;
  calendar?: TradingCalendar;
  intent?: "open" | "close";
  dispatchedKeys?: Set<string>;
  environmentMode?: string;
  checklist?: SameDayChecklist | null;
}) {
  const dispatcher = new CountingDispatcher();
  const packet = args.packet ?? makePacket();
  const receipt = args.receipt ?? approvedReceipt(packet);
  const res = await dispatchPacket({
    packet,
    receipt,
    intent: args.intent,
    dispatcher,
    calendar: args.calendar ?? REGULAR_CAL,
    now: args.now ?? OPEN_ET,
    dispatchedKeys: args.dispatchedKeys,
    environmentMode: args.environmentMode,
    sameDayChecklist: args.checklist === null
      ? buildSameDayChecklist({ annualCalendarReviewed: false, traderAlertsChecked: false,
          noUnscheduledChange: false, operatorConfirmed: false, confirmedBy: "", confirmedAt: "" })
      : args.checklist ?? buildSameDayChecklist({
          annualCalendarReviewed: true, traderAlertsChecked: true, noUnscheduledChange: true,
          operatorConfirmed: true, confirmedBy: "fixture operator",
          confirmedAt: OPEN_ET.toISOString(),
        }),
  });
  return { res, dispatcher };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("bridge — happy path", () => {
  it("dispatches an eligible packet exactly once", async () => {
    const { res, dispatcher } = await run({});
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(dispatcher.calls.length, 1);
    assert.equal(dispatcher.calls[0]!.method, "dispatch");
    assert.equal(dispatcher.calls[0]!.symbol, "NVDAUSDT");
    assert.equal(dispatcher.calls[0]!.quantity, 0.12);
  });

  it("derives the venue side from the Quant verdict", async () => {
    const { dispatcher } = await run({ packet: makePacket({ quant: quantOf(0.004, "BUY_BASIS") }) });
    assert.equal(dispatcher.calls[0]!.side, "BUY");
  });

  it("records revalidation values recomputed at dispatch", async () => {
    const { res } = await run({});
    assert.equal(res.ok, true);
    const rv = (res as unknown as { revalidation: Record<string, unknown> }).revalidation;
    assert.equal(rv["freshnessBasis"], "receipt-relative");
    assert.equal(rv["freshnessAtDispatch"], "verified_fresh");
    assert.equal(rv["sessionTradable"], true);
    assert.equal(rv["recomputedVenueSymbol"], "NVDAUSDT");
    assert.equal(rv["receiptVerified"], true);
    assert.equal(rv["packetNotExpired"], true);
    assert.equal(rv["environment"], "DEMO");
  });

  it("closes an open intent, inverting the direction", async () => {
    const { res, dispatcher } = await run({ intent: "close" });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(dispatcher.calls[0]!.method, "closePosition");
    // SELL_BASIS opens a short; closing it is a BUY.
    assert.equal(dispatcher.calls[0]!.side, "BUY");
  });

  it("derives a deterministic idempotency key per intent", () => {
    assert.equal(idempotencyKeyFor("abc", "open"), "abc:open");
    assert.equal(idempotencyKeyFor("abc", "close"), "abc:close");
    assert.notEqual(idempotencyKeyFor("abc", "open"), idempotencyKeyFor("abc", "close"));
  });
});

// ---------------------------------------------------------------------------
// Fail-closed: every case must produce ZERO venue calls
// ---------------------------------------------------------------------------

describe("bridge — refuses with zero venue calls", () => {
  /** Asserts a refusal AND that the venue was never touched. */
  async function expectRefused(args: Parameters<typeof run>[0], expectReason: string) {
    const { res, dispatcher } = await run(args);
    assert.equal(res.ok, false, "expected a refusal");
    assert.equal(dispatcher.calls.length, 0, `venue was contacted on a refusal path: ${JSON.stringify(dispatcher.calls)}`);
    const reasons = (res as { reasons: string[] }).reasons;
    assert.ok(
      reasons.some((r) => r.includes(expectReason)),
      `expected reason containing '${expectReason}', got ${JSON.stringify(reasons)}`,
    );
    return res as { reasons: string[]; venueCalls: 0 };
  }

  it("refuses an expired packet", async () => {
    const p = makePacket();
    await expectRefused({ packet: p, now: new Date(Date.parse(p.expiresAt) + 1) }, "PACKET_EXPIRED");
  });

  it("refuses a packet that aged out after admission", async () => {
    // Admitted fresh, dispatched long after: the bridge must re-measure.
    const p = makePacket();
    await expectRefused(
      { packet: p, now: new Date(OPEN_ET.getTime() + 20_000) },
      "BENCHMARK_STALE_AT_DISPATCH",
    );
  });

  it("refuses a benchmark stale at admission", async () => {
    // Constructed directly rather than via makePacket: an over-threshold
    // declared age makes buildStrategyPacket refuse, and this case needs to
    // prove the BRIDGE independently re-measures. The declared age here is
    // small (so the packet's own claim looks fine) while its timestamps put the
    // quote 60s before dispatch.
    const p = makePacket();
    const stale = {
      ...p,
      benchmark: {
        ...p.benchmark,
        sourceAsOf: new Date(OPEN_ET.getTime() - 60_000).toISOString(),
        ageAtReceiptMs: 500,
        freshness: "verified_fresh" as const,
      },
    } as StrategyPacketV1;
    await expectRefused({ packet: stale }, "BENCHMARK_STALE_AT_DISPATCH");
  });

  it("refuses a future-dated benchmark at dispatch", async () => {
    const p = makePacket();
    const future = {
      ...p,
      benchmark: { ...p.benchmark, sourceAsOf: new Date(OPEN_ET.getTime() + 60_000).toISOString() },
    } as StrategyPacketV1;
    await expectRefused({ packet: future }, "BENCHMARK_STALE_AT_DISPATCH");
  });

  it("refuses when responseReceivedAt is in the future relative to dispatch", async () => {
    const p = makePacket();
    const skewed = {
      ...p,
      benchmark: { ...p.benchmark, responseReceivedAt: new Date(OPEN_ET.getTime() + 30_000).toISOString() },
    } as StrategyPacketV1;
    await expectRefused({ packet: skewed }, "CLOCK_SKEW");
  });

  it("refuses a closed session even though the quote is fresh", async () => {
    await expectRefused({ now: CLOSED_ET }, "SESSION_NOT_TRADABLE");
  });

  it("refuses a holiday", async () => {
    await expectRefused(
      { calendar: cal([{ date: TRADING_DAY, type: "HOLIDAY", note: "Test holiday" }]) },
      "SESSION_NOT_TRADABLE",
    );
  });

  it("refuses an early close after the early close time", async () => {
    await expectRefused(
      { calendar: cal([{ date: TRADING_DAY, type: "EARLY_CLOSE", closeMinute: 13 * 60 }]), now: new Date("2026-10-05T17:30:00.000Z") },
      "SESSION_NOT_TRADABLE",
    );
  });

  it("refuses a date the calendar does not know", async () => {
    await expectRefused({ calendar: cal([]) }, "UNKNOWN_CALENDAR_DAY");
  });

  it("refuses a tampered receipt", async () => {
    const p = makePacket();
    const good = approvedReceipt(p);
    const tampered = { ...good, quantMetrics: { ...(good.quantMetrics as object), netEdgePct: 99 } };
    await expectRefused({ receipt: tampered as SealedReasoningReceipt }, "RECEIPT_VERIFY_FAILED");
  });

  it("refuses a VETOED receipt", async () => {
    const p = makePacket();
    const good = approvedReceipt(p);
    const vetoed = { ...good, decision: "VETOED" };
    await expectRefused({ receipt: vetoed as SealedReasoningReceipt }, "RECEIPT_NOT_APPROVED");
  });

  it("refuses a failed council quorum", async () => {
    await expectRefused(
      { packet: makePacket({ council: { compositeScore: 20, macro: 20, quant: 20, risk: 20, exec: 20 } }) },
      "COUNCIL_QUORUM_FAILED",
    );
  });

  it("refuses a mismatched venue symbol", async () => {
    const p = makePacket();
    const bad = {
      ...p,
      symbolMapping: { ...p.symbolMapping, venueSymbol: "WRONGUSDT" },
    } as StrategyPacketV1;
    await expectRefused({ packet: bad }, "SYMBOL_MAPPING_MISMATCH");
  });

  it("refuses a reference symbol that does not derive from the repo symbol", async () => {
    const p = makePacket();
    const bad = {
      ...p,
      symbolMapping: { ...p.symbolMapping, referenceSymbol: "TSLA" },
    } as StrategyPacketV1;
    await expectRefused({ packet: bad }, "REFERENCE_SYMBOL_MISMATCH");
  });

  it("refuses a LIVE environment", async () => {
    await expectRefused({ environmentMode: "LIVE" }, "ENVIRONMENT_FORBIDDEN");
  });

  it("refuses a replayed idempotency key", async () => {
    const p = makePacket();
    const receipt = approvedReceipt(p);
    const replayed = new Set([idempotencyKeyFor(receipt.receiptHash, "open")]);
    await expectRefused({ packet: p, receipt, dispatchedKeys: replayed }, "IDEMPOTENCY_REPLAY_REFUSED");
  });

  it("refuses a request-start admission basis", async () => {
    const p = makePacket();
    const bad = { ...p, benchmark: { ...p.benchmark, freshnessBasis: "request-start-relative" } } as never;
    await expectRefused({ packet: bad as StrategyPacketV1 }, "ADMISSION_BASIS_INVALID");
  });

  it("refuses a close when the dispatcher cannot close", async () => {
    const dispatcherWithoutClose: BridgeDispatcher = {
      dispatch: (async () => { throw new Error("must not be reached"); }) as never,
    };
    const p = makePacket();
    const receipt = approvedReceipt(p);
    const res = await dispatchPacket({
      packet: p, receipt, intent: "close", dispatcher: dispatcherWithoutClose,
      calendar: REGULAR_CAL, now: OPEN_ET,
      // A dispatch-boundary call always supplies the checklist; the property is
      // required precisely so a caller cannot forget it.
      sameDayChecklist: buildSameDayChecklist({
        annualCalendarReviewed: true, traderAlertsChecked: true, noUnscheduledChange: true,
        operatorConfirmed: true, confirmedBy: "fixture operator", confirmedAt: OPEN_ET.toISOString(),
      }),
    });
    assert.equal(res.ok, false);
    assert.equal((res as { venueCalls: number }).venueCalls, 0);
    assert.ok((res as { reasons: string[] }).reasons.some((r) => r.includes("CLOSE_UNSUPPORTED")));
  });
});

describe("bridge — revalidation is independent of the packet's claims", () => {
  it("ignores a packet that lies about its own freshness", async () => {
    // The packet claims verified_fresh and a tiny age, but its own timestamps
    // show the quote is 40s old at dispatch. The bridge measures, not believes.
    const p = makePacket();
    const lying = {
      ...p,
      benchmark: {
        ...p.benchmark,
        sourceAsOf: new Date(OPEN_ET.getTime() - 40_000).toISOString(),
        // claims that were true at construction:
        ageAtReceiptMs: 500,
        freshness: "verified_fresh" as const,
      },
    } as StrategyPacketV1;
    const { res, dispatcher } = await run({ packet: lying, now: OPEN_ET });
    assert.equal(res.ok, false);
    assert.equal(dispatcher.calls.length, 0);
    assert.ok((res as { reasons: string[] }).reasons.some((r) => r.includes("BENCHMARK_STALE_AT_DISPATCH")));
  });

  it("re-resolves the session rather than trusting the packet's session block", async () => {
    // Packet says it was admitted at 12:30 ET on a regular day. Dispatch at
    // 17:00 ET is outside the session and must be refused.
    const { res, dispatcher } = await run({ now: CLOSED_ET });
    assert.equal(res.ok, false);
    assert.equal(dispatcher.calls.length, 0);
    assert.equal((res as unknown as { revalidation: Record<string, unknown> }).revalidation["sessionTradable"], false);
  });
});

describe("bridge — packet construction gates", () => {
  it("cannot even construct a packet from closed-session or stale inputs", () => {
    const stale = buildStrategyPacket({
      symbolMapping: { repoSymbol: "rNVDAUSDT", venueSymbol: "NVDAUSDT", referenceSymbol: "NVDA" },
      benchmark: {
        provider: "p", sourceAsOf: new Date(OPEN_ET.getTime() - 60_000).toISOString(),
        requestedAt: OPEN_ET.toISOString(), responseReceivedAt: OPEN_ET.toISOString(),
        ageAtReceiptMs: 60_000, freshnessBasis: "receipt-relative" as const,
        freshness: "verified_fresh" as const, effectiveThresholdMs: 15_000,
        timestampType: "t", bid: 1, ask: 1, midpoint: 1, isTradingHalt: false as const,
      },
      session: { date: TRADING_DAY, dayType: "REGULAR", calendarId: "c", exchange: "NYSE", openMinute: 570, closeMinute: 960, admissionMinute: 750 },
      quant: quantOf(0.01, "BUY_BASIS"),
      sizing: { compliantQuantity: 0.1, roundedNotionalUsd: 10, minQty: 0.01, minNotionalUsdt: 5, multiplier: 0.01 },
      risk: { decision: "APPROVED" as const, exposureUsd: 10, projectedMarginUtilization: 0.1 },
      council: { compositeScore: 80, macro: 80, quant: 80, risk: 80, exec: 80 },
      now: OPEN_ET,
    });
    assert.equal((stale as { ok: boolean }).ok, false);
    assert.ok((stale as { reasons: string[] }).reasons.some((r) => r.includes("BENCHMARK_STALE")));
  });

  it("produces a verifiable receipt that the bridge then accepts", () => {
    const p = makePacket();
    const r = approvedReceipt(p);
    assert.equal(verifyReceipt(r), true);
  });
});
// ---------------------------------------------------------------------------
// Dispatch-boundary same-day checklist
//
// The attestation moved HERE, from evidence admission to the moment before an
// order could be sent. These tests pin both halves of that move: a read-only
// observation proceeds without it, and a dispatch without it contacts nothing.
// ---------------------------------------------------------------------------

describe("bridge — same-day checklist at the dispatch boundary", () => {
  const emptyChecklist = (): SameDayChecklist =>
    buildSameDayChecklist({
      annualCalendarReviewed: false, traderAlertsChecked: false, noUnscheduledChange: false,
      operatorConfirmed: false, confirmedBy: "", confirmedAt: "",
    });

  it("dispatches when the checklist is complete", async () => {
    const { res, dispatcher } = await run({});
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(dispatcher.calls.length, 1);
    assert.equal((res as { revalidation: { sameDayChecklistComplete: boolean } }).revalidation.sameDayChecklistComplete, true);
  });

  it("refuses with zero venue calls when the checklist is incomplete", async () => {
    const { res, dispatcher } = await run({ checklist: emptyChecklist() });
    assert.equal(res.ok, false);
    assert.equal(dispatcher.calls.length, 0, "an incomplete checklist must not reach the venue");
    assert.equal((res as { venueCalls: number }).venueCalls, 0);
    const reasons = (res as { reasons: string[] }).reasons;
    assert.ok(reasons.some((r) => r.includes("SAME_DAY_CHECKLIST_INCOMPLETE")));
  });

  it("refuses when no checklist is supplied at all", async () => {
    // `sameDayChecklist` is required in the type so this cannot be forgotten
    // at compile time; a JS caller or `any` cast still must fail closed.
    const dispatcher = new CountingDispatcher();
    const packet = makePacket();
    const receipt = approvedReceipt(packet);
    const res = await dispatchPacket({
      packet, receipt, dispatcher, calendar: REGULAR_CAL, now: OPEN_ET,
    } as unknown as Parameters<typeof dispatchPacket>[0]);
    assert.equal(res.ok, false);
    assert.equal(dispatcher.calls.length, 0);
    assert.ok((res as { reasons: string[] }).reasons.some((r) => r.includes("SAME_DAY_CHECKLIST_MISSING")));
  });

  it("names the Trader Alert gap as the reason", async () => {
    const { res } = await run({ checklist: emptyChecklist() });
    const reasons = (res as { reasons: string[] }).reasons.join(" ");
    assert.match(reasons, /Trader Alerts are not machine-readable/);
    assert.match(reasons, /UNKNOWN_SESSION -> NO_TRADE/);
  });

  it("refuses a close with an incomplete checklist before touching the venue", async () => {
    const { res, dispatcher } = await run({ intent: "close", checklist: emptyChecklist() });
    assert.equal(res.ok, false);
    assert.equal(dispatcher.calls.length, 0);
  });

  it("reports the checklist state in revalidation even when refusing", async () => {
    const { res } = await run({ checklist: emptyChecklist() });
    assert.equal((res as { revalidation: { sameDayChecklistComplete: boolean } }).revalidation.sameDayChecklistComplete, false);
  });

  it("refuses a replay even when the checklist is complete", async () => {
    // Proves the checklist did not displace the idempotency control.
    const p = makePacket();
    const receipt = approvedReceipt(p);
    const replayed = new Set([idempotencyKeyFor(receipt.receiptHash, "open")]);
    const { res, dispatcher } = await run({ packet: p, receipt, dispatchedKeys: replayed });
    assert.equal(res.ok, false);
    assert.equal(dispatcher.calls.length, 0);
    assert.ok((res as { reasons: string[] }).reasons.some((r) => r.includes("IDEMPOTENCY_REPLAY_REFUSED")));
  });
});
