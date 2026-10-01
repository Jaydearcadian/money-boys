import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildStrategyPacket, PACKET_TTL_MS, type PacketRejection, type StrategyPacketV1 } from "../src/bitget/strategy-packet-v1.js";
import { evaluateBasisSpread, type QuantAnalysisResult } from "../src/agents/quant.js";
import { sealReceipt, type SealedReasoningReceipt } from "../src/council/receipts.js";
import { StructuralChangeGuard, toBlastRadiusReport } from "../src/skills/igraph-guard/security.js";

/**
 * StrategyPacketV1 admission.
 *
 * The packet must refuse anything that would later need a human to catch. Its
 * types are deliberately shaped so a non-eligible packet cannot be CONSTRUCTED
 * — `positiveNetEdge: true`, `freshness: "verified_fresh"`, `risk.decision:
 * "APPROVED"` are literal types. The runtime checks below prove the constructor
 * enforces them rather than trusting its caller.
 */

const NOW = new Date("2026-10-05T16:30:00.000Z"); // 12:30 ET Monday

function quantOf(netEdge: number, action: "BUY_BASIS" | "SELL_BASIS" | "NEUTRAL"): QuantAnalysisResult {
  const mid = 229.95;
  const depth = {
    bids: Array.from({ length: 10 }, (_, i) => ({ price: mid * (1 - 0.0002 * (i + 1)), quantity: 40 })),
    asks: Array.from({ length: 10 }, (_, i) => ({ price: mid * (1 + 0.0002 * (i + 1)), quantity: 40 })),
  };
  // Real evaluateBasisSpread is used so the shape is schema-valid, then the
  // decision fields are overridden to isolate the admission rule under test.
  const base = evaluateBasisSpreadSafe(netEdge, action, mid, depth);
  return base;
}

function evaluateBasisSpreadSafe(
  netEdge: number,
  action: "BUY_BASIS" | "SELL_BASIS" | "NEUTRAL",
  mid: number,
  depth: { bids: { price: number; quantity: number }[]; asks: { price: number; quantity: number }[] },
): QuantAnalysisResult {
  const r = evaluateBasisSpread({
    tokenPrice: mid,
    tradFiClosePrice: mid * (1 - netEdge),
    orderSizeUsd: 25,
    depth,
    fundingRate8h: 0,
    hoursToClose: 1,
    takerFee: 0.0006,
  });
  return { ...r, netEdge, action };
}

function packetArgs(overrides: Partial<Parameters<typeof buildStrategyPacket>[0]> = {}) {
  return {
    symbolMapping: { repoSymbol: "rNVDAUSDT", venueSymbol: "NVDAUSDT", referenceSymbol: "NVDA" },
    benchmark: {
      provider: "robinhood_stock_token_api",
      sourceAsOf: new Date(NOW.getTime() - 400).toISOString(),
      requestedAt: NOW.toISOString(),
      responseReceivedAt: new Date(NOW.getTime() + 100).toISOString(),
      ageAtReceiptMs: 500,
      freshnessBasis: "receipt-relative" as const,
      freshness: "verified_fresh" as const,
      effectiveThresholdMs: 15_000,
      timestampType: "PROVIDER_GENERATED_QUOTE",
      bid: 229.9,
      ask: 230.0,
      midpoint: 229.95,
      isTradingHalt: false as const,
    },
    session: {
      date: "2026-10-05",
      dayType: "REGULAR" as const,
      calendarId: "test-cal",
      exchange: "NYSE",
      openMinute: 9 * 60 + 30,
      closeMinute: 16 * 60,
      admissionMinute: 12 * 60 + 30,
    },
    quant: quantOf(0.003, "SELL_BASIS"),
    sizing: {
      compliantQuantity: 0.12,
      roundedNotionalUsd: 27.6,
      minQty: 0.01,
      minNotionalUsdt: 5,
      multiplier: 0.01,
    },
    risk: { decision: "APPROVED" as const, exposureUsd: 27.6, projectedMarginUtilization: 0.003 },
    council: { compositeScore: 80, macro: 78, quant: 82, risk: 80, exec: 76 },
    now: NOW,
    ...overrides,
  };
}

function reasonsOf(r: StrategyPacketV1 | PacketRejection): string[] {
  return (r as PacketRejection).reasons ?? [];
}

describe("StrategyPacketV1 — admission", () => {
  it("builds a packet from fully valid inputs", () => {
    const r = buildStrategyPacket(packetArgs());
    assert.equal((r as PacketRejection).ok, undefined);
    const p = r as StrategyPacketV1;
    assert.equal(p.version, 1);
    assert.equal(p.environment, "DEMO");
    assert.equal(p.positiveNetEdge, true);
    assert.equal(p.benchmark.freshnessBasis, "receipt-relative");
  });

  it("binds both local timestamps and the admission age", () => {
    const p = buildStrategyPacket(packetArgs()) as StrategyPacketV1;
    assert.equal(p.benchmark.requestedAt, NOW.toISOString());
    assert.notEqual(p.benchmark.requestedAt, p.benchmark.responseReceivedAt);
    assert.equal(p.benchmark.ageAtReceiptMs, 500);
  });

  it("sets an expiry and does not conflate it with the freshness gate", () => {
    const p = buildStrategyPacket(packetArgs()) as StrategyPacketV1;
    assert.equal(Date.parse(p.expiresAt) - Date.parse(p.issuedAt), PACKET_TTL_MS);
    assert.equal(p.benchmark.effectiveThresholdMs, 15_000);
  });

  it("honours a caller-supplied TTL", () => {
    const p = buildStrategyPacket(packetArgs({ ttlMs: 5_000 })) as StrategyPacketV1;
    assert.equal(Date.parse(p.expiresAt) - Date.parse(p.issuedAt), 5_000);
  });
});

describe("StrategyPacketV1 — fail-closed admission", () => {
  it("refuses a stale benchmark", () => {
    const r = buildStrategyPacket(packetArgs({
      benchmark: { ...packetArgs().benchmark, ageAtReceiptMs: 15_001 },
    }));
    assert.equal((r as PacketRejection).ok, false);
    assert.ok(reasonsOf(r).some((x) => x.includes("BENCHMARK_STALE")));
  });

  it("refuses a non-fresh freshness status", () => {
    const r = buildStrategyPacket(packetArgs({
      benchmark: { ...packetArgs().benchmark, freshness: "verified_stale" as never },
    }));
    assert.equal((r as PacketRejection).ok, false);
    assert.ok(reasonsOf(r).some((x) => x.includes("BENCHMARK_NOT_FRESH")));
  });

  it("refuses a request-start admission basis", () => {
    const r = buildStrategyPacket(packetArgs({
      benchmark: { ...packetArgs().benchmark, freshnessBasis: "request-start-relative" as never },
    }));
    assert.equal((r as PacketRejection).ok, false);
    assert.ok(reasonsOf(r).some((x) => x.includes("ADMISSION_BASIS_INVALID")));
  });

  it("refuses a halted benchmark", () => {
    const r = buildStrategyPacket(packetArgs({
      benchmark: { ...packetArgs().benchmark, isTradingHalt: true as never },
    }));
    assert.equal((r as PacketRejection).ok, false);
    assert.ok(reasonsOf(r).some((x) => x.includes("BENCHMARK_HALTED")));
  });

  it("refuses zero or negative net edge", () => {
    for (const edge of [0, -0.001]) {
      const r = buildStrategyPacket(packetArgs({ quant: quantOf(edge, "SELL_BASIS") }));
      assert.equal((r as PacketRejection).ok, false, `edge ${edge} must be refused`);
      assert.ok(reasonsOf(r).some((x) => x.includes("NO_POSITIVE_EDGE")));
    }
  });

  it("refuses a NEUTRAL verdict even with a positive net edge field", () => {
    // Defensive: a NEUTRAL must never become an authorization.
    const r = buildStrategyPacket(packetArgs({ quant: quantOf(0.01, "NEUTRAL") }));
    assert.equal((r as PacketRejection).ok, false);
    assert.ok(reasonsOf(r).some((x) => x.includes("QUANT_NEUTRAL")));
  });

  it("refuses a Risk decision that is not APPROVED", () => {
    const r = buildStrategyPacket(packetArgs({
      risk: { decision: "VETOED" as never, exposureUsd: 27.6, projectedMarginUtilization: 0.9 },
    }));
    assert.equal((r as PacketRejection).ok, false);
    assert.ok(reasonsOf(r).some((x) => x.includes("RISK_NOT_APPROVED")));
  });

  it("refuses a non-positive compliant quantity", () => {
    const r = buildStrategyPacket(packetArgs({
      sizing: { ...packetArgs().sizing, compliantQuantity: 0 },
    }));
    assert.equal((r as PacketRejection).ok, false);
    assert.ok(reasonsOf(r).some((x) => x.includes("SIZING_INVALID")));
  });

  it("collects every reason rather than stopping at the first", () => {
    const r = buildStrategyPacket(packetArgs({
      quant: quantOf(-0.01, "NEUTRAL"),
      risk: { decision: "VETOED" as never, exposureUsd: 0, projectedMarginUtilization: 1 },
      sizing: { ...packetArgs().sizing, compliantQuantity: -1 },
    }));
    const reasons = reasonsOf(r);
    assert.ok(reasons.length >= 3, `expected several reasons, got ${JSON.stringify(reasons)}`);
    assert.ok(reasons.some((x) => x.includes("NO_POSITIVE_EDGE")));
    assert.ok(reasons.some((x) => x.includes("QUANT_NEUTRAL")));
    assert.ok(reasons.some((x) => x.includes("RISK_NOT_APPROVED")));
  });
});

describe("StrategyPacketV1 — it confers no authority", () => {
  it("has no executable field of any kind", () => {
    const p = buildStrategyPacket(packetArgs()) as StrategyPacketV1;
    const keys = Object.keys(p);
    assert.ok(!keys.includes("executable"), "a packet must not carry an executable field");
    assert.ok(!JSON.stringify(p).includes('"executable"'), "executable must not appear in a packet payload");
  });

  it("declares Demo only and cannot express a live environment", () => {
    const p = buildStrategyPacket(packetArgs()) as StrategyPacketV1;
    assert.equal(p.environment, "DEMO");
    const asRecord = p as unknown as Record<string, unknown>;
    assert.notEqual(asRecord["environment"], "LIVE");
  });
});

describe("StrategyPacketV1 — receipt binding fixture", () => {
  it("produces a sealed, verifiable receipt for the happy-path packet", () => {
    const p = buildStrategyPacket(packetArgs()) as StrategyPacketV1;
    const blast = StructuralChangeGuard.evaluateBlastRadius(
      { symbol: p.symbolMapping.venueSymbol, side: "sell", quantity: p.sizing.compliantQuantity, priceUsd: p.quant.midPrice },
      { equityUsd: 9364.2, usedMarginUsd: 0, freeMarginUsd: 9364.2, openOrders: [] },
    );
    const receipt: SealedReasoningReceipt = sealReceipt({
      symbol: p.symbolMapping.venueSymbol,
      action: p.quant.action,
      quantMetrics: p.quant,
      riskReport: toBlastRadiusReport(blast),
      councilScores: p.council,
      decision: blast.decision === "APPROVED" ? "APPROVED" : "VETOED",
      rationale: "Bridge deterministic fixture.",
    });
    assert.equal(receipt.decision, "APPROVED");
    assert.match(receipt.receiptHash, /^[0-9a-f]{64}$/);
  });
});