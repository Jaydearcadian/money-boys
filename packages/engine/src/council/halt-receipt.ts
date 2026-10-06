/**
 * EMERGENCY HALT RECEIPT — a SHA-256 seal over a system state mutation.
 *
 * WHY THIS EXISTS SEPARATELY FROM ReasoningReceipt
 *   A ReasoningReceipt authorises an ORDER. A halt does the opposite: it
 *   withdraws authority. It is still a mutation of trading-relevant system
 *   state, and I-03 as restated covers "every system state mutation", so it
 *   gets the same cryptographic treatment.
 *
 * THE HOLE THIS CLOSES
 *   packages/engine/src/server.ts handled POST /api/desk/halt by flipping
 *   state.systemHalt with NO receipt of any kind. A kill switch that can be
 *   thrown and cleared without an audit trail is exactly the unaudited write
 *   path this project exists to prevent — and an emergency halt is the single
 *   most consequential state change the desk can make.
 *
 *   Both the HTTP route and the MCP tool now seal one of these.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const HaltActionSchema = z.enum(["ENGAGE", "RELEASE"]);
export type HaltAction = z.infer<typeof HaltActionSchema>;

export const EmergencyHaltPayloadSchema = z.object({
  action: HaltActionSchema,
  /** Caller identity: MCP tool name, or "http:/api/desk/halt". */
  caller: z.string().min(1),
  reason: z.string().min(1),
  /** ISO instant the operator or agent requested the change. */
  requestedAt: z.string().min(1),
});
export type EmergencyHaltPayload = z.infer<typeof EmergencyHaltPayloadSchema>;

export const EmergencyHaltReceiptSchema = EmergencyHaltPayloadSchema.extend({
  receiptId: z.string().uuid(),
  sealedAt: z.string().datetime({ offset: true }),
  receiptHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type EmergencyHaltReceipt = z.infer<typeof EmergencyHaltReceiptSchema>;

/**
 * Canonical JSON: object keys sorted recursively so the digest is stable
 * regardless of property insertion order. Mirrors the reasoning-receipt
 * hashing so a single hashing convention governs the whole project.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

export function sealHaltReceipt(payload: EmergencyHaltPayload): EmergencyHaltReceipt {
  const parsed = EmergencyHaltPayloadSchema.parse(payload);
  const sealedAt = new Date().toISOString();
  const digest = createHash("sha256").update(canonical({ ...parsed, sealedAt })).digest("hex");
  // uuid v4 shape without pulling in node:crypto randomUUID ordering concerns.
  const receiptId = `${crypto.randomUUID()}`;
  return EmergencyHaltReceiptSchema.parse({ ...parsed, receiptId, sealedAt, receiptHash: digest });
}

/**
 * Constant-time verification. Returns false for ANY malformed input and never
 * throws, so untrusted MCP or HTTP input cannot crash the verifier.
 */
export function verifyHaltReceipt(receipt: unknown): boolean {
  const parsed = EmergencyHaltReceiptSchema.safeParse(receipt);
  if (!parsed.success) return false;
  const { receiptHash, receiptId, sealedAt, ...payload } = parsed.data as unknown as Record<string, unknown>;
  void receiptId;
  const recomputed = createHash("sha256").update(canonical({ ...payload, sealedAt })).digest("hex");
  const a = Buffer.from(String(receiptHash), "utf8");
  const b = Buffer.from(recomputed, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}