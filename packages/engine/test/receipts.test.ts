import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sealReceipt, verifyReceipt } from "../src/council/receipts.js";

/** Representative StructuralChangeGuard output: no structural change. */
const guardPass = {
  guardVersion: "scg-1.4.0",
  verdict: "pass",
  structuralChangeDetected: false,
  maxDrawdownBps: 120,
} as const;

/** Representative StructuralChangeGuard output: structural breach. */
const guardBreach = {
  guardVersion: "scg-1.4.0",
  verdict: "breach",
  structuralChangeDetected: true,
  maxDrawdownBps: 950,
} as const;

describe("ReasoningReceipt SHA-256 sealing (CLM-003 / GAP-003)", () => {
  it("seals and verifies an approved trade receipt (guard pass)", () => {
    const sealed = sealReceipt({
      tradeId: "trade-approved-001",
      decision: "approved",
      projectedLiquidationPrice: 61234.5,
      netEdgePct: 1.25,
      guard: { ...guardPass },
      rationale: "Guard passed; edge exceeds 1% threshold.",
    });
    assert.match(sealed.receiptHash, /^[0-9a-f]{64}$/);
    assert.equal(verifyReceipt(sealed), true);
  });

  it("seals and verifies a vetoed trade receipt (guard breach)", () => {
    const sealed = sealReceipt({
      tradeId: "trade-vetoed-002",
      decision: "vetoed",
      projectedLiquidationPrice: 58900.0,
      netEdgePct: -0.42,
      guard: { ...guardBreach },
      rationale: "Structural breach detected; council vetoes the trade.",
    });
    assert.equal(sealed.decision, "vetoed");
    assert.equal(verifyReceipt(sealed), true);
  });

  it("detects tampering with projectedLiquidationPrice", () => {
    const sealed = sealReceipt({
      tradeId: "trade-tamper-liq",
      decision: "approved",
      projectedLiquidationPrice: 61234.5,
      netEdgePct: 1.25,
      guard: { ...guardPass },
      rationale: "Baseline receipt for liquidation-price tamper test.",
    });
    assert.equal(verifyReceipt(sealed), true);
    const tampered = { ...sealed, projectedLiquidationPrice: 99999.99 };
    assert.equal(verifyReceipt(tampered), false);
  });

  it("detects tampering with netEdgePct", () => {
    const sealed = sealReceipt({
      tradeId: "trade-tamper-edge",
      decision: "approved",
      projectedLiquidationPrice: 61234.5,
      netEdgePct: 1.25,
      guard: { ...guardPass },
      rationale: "Baseline receipt for net-edge tamper test.",
    });
    assert.equal(verifyReceipt(sealed), true);
    const tampered = { ...sealed, netEdgePct: 9.99 };
    assert.equal(verifyReceipt(tampered), false);
  });

  it("is key-order independent: differently ordered inputs yield identical receiptHash", () => {
    const orderedA = {
      tradeId: "trade-order-001",
      decision: "approved",
      projectedLiquidationPrice: 61234.5,
      netEdgePct: 1.25,
      guard: {
        guardVersion: "scg-1.4.0",
        verdict: "pass",
        structuralChangeDetected: false,
        maxDrawdownBps: 120,
      },
      rationale: "Key-order independence check.",
    } as const;

    // Same logical payload, keys inserted in reverse order (incl. nested guard).
    const orderedB = {
      rationale: "Key-order independence check.",
      guard: {
        maxDrawdownBps: 120,
        structuralChangeDetected: false,
        verdict: "pass",
        guardVersion: "scg-1.4.0",
      },
      netEdgePct: 1.25,
      projectedLiquidationPrice: 61234.5,
      decision: "approved",
      tradeId: "trade-order-001",
    } as unknown as Record<string, unknown>;

    const sealedA = sealReceipt(orderedA as unknown as Record<string, unknown>);
    const sealedB = sealReceipt(orderedB);

    assert.equal(verifyReceipt(sealedA), true);
    assert.equal(verifyReceipt(sealedB), true);
    assert.equal(sealedB.receiptHash, sealedA.receiptHash);
  });
});
