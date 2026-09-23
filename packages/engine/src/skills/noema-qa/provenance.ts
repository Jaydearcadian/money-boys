import { createHash, timingSafeEqual } from "node:crypto";

/**
 * CLM-005 / GAP-005 — Catalyst provenance hashing.
 *
 * Adapted from upstream noema (`/tmp/upstream/noema/packages/noema-core/src/evidence.ts`
 * + `packages/noema-ai/src/provenance.ts` + `packages/canonicalization/src/index.ts`
 * + `HASHING_SPEC.md`):
 * upstream commits evidence via RFC 8785 JCS canonical JSON + keccak-256
 * (`0x`-prefixed `Hex`, domains `noema:evidence-leaf:v1` /
 * `noema:ai-proposal:v1`, sorted Merkle leaves). This port keeps the
 * deterministic canonical-JSON idea but matches the engine substrate:
 * key-sorted compact JSON + plain SHA-256 hex (node:crypto), identical to
 * the ReasoningReceipt sealer (`council/receipts.ts` `canonicalJson` /
 * `hashPayload`). No `canonicalize` / `viem` dependencies — pure
 * TypeScript + node:crypto (I-05).
 */

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function canonicalize(value: unknown): JsonValue {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const out: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = canonicalize(v);
    }
    return out;
  }
  return value as JsonValue;
}

/** Deterministic canonical JSON: keys sorted at every depth, compact. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * SHA-256 hex digest of the canonical JSON encoding of `payload`.
 * Deterministic (same payload → same hash) and tamper-sensitive
 * (any field change → different hash).
 */
export function hashCatalystPayload(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
}

/** Constant-time provenance check: never throws on untrusted input. */
export function verifyCatalystProvenance(payload: unknown, expectedHash: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(expectedHash)) return false;
  const recomputed = hashCatalystPayload(payload);
  const a = Buffer.from(expectedHash, "utf8");
  const b = Buffer.from(recomputed, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
