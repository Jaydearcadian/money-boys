import type { SealedReasoningReceipt } from "../lib/api";

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return (value as unknown[]).map(canonicalize);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>).sort()) {
    const v = (value as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = canonicalize(v);
  }
  return out;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

const SEAL_KEYS = new Set(["receiptId", "sealedAt", "receiptHash"]);

export async function verifyReceiptInBrowser(receipt: SealedReasoningReceipt): Promise<{ ok: boolean; recomputed: string }> {
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(receipt as unknown as Record<string, unknown>)) {
    if (!SEAL_KEYS.has(k)) payload[k] = v;
  }
  const bytes = new TextEncoder().encode(canonicalJson(payload));
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  const recomputed = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const a = receipt.receiptHash.toLowerCase();
  const b = recomputed.toLowerCase();
  // Timing-safe-ish equality over hex (constant length 64).
  let diff = a.length === b.length ? 0 : 1;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return { ok: diff === 0, recomputed };
}
