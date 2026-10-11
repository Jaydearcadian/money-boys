import { sandboxCanonicalJson } from "@money-boys/engine/council/browser-sandbox";
import type { SandboxResult } from "@money-boys/engine/council/browser-sandbox";

export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return "unavailable-in-this-browser";
  const buf = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Seal a receipt payload. Pure and deterministic: same payload, same digest. */
export const seal = (payload: Record<string, unknown>) => sha256Hex(sandboxCanonicalJson(payload));

export async function verify(payload: Record<string, unknown>, expected: string) {
  const recomputed = await seal(payload);
  return { recomputed, ok: recomputed === expected };
}

export type Tone = "ok" | "warn" | "bad";

/** Same precedence the engine uses: risk veto, then cost, then council. */
export function verdictOf(r: SandboxResult): { label: string; tone: Tone } {
  if (!r.risk.permitted) return { label: "Risk veto", tone: "bad" };
  if (r.quant.netEdgePct <= 0) return { label: "No edge", tone: "warn" };
  if (r.council.status !== "APPROVED") return { label: "Council veto", tone: "bad" };
  return { label: "Approved (not traded)", tone: "ok" };
}
