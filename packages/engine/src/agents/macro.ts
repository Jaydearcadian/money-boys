import {
  MacroCatalystProposalSchema,
  type MacroCatalystProposal,
} from "../skills/noema-qa/schemas.js";
import { hashCatalystPayload } from "../skills/noema-qa/provenance.js";

/**
 * CLM-005 / GAP-005 — Macro Boy Catalyst Ingestion.
 *
 * Adapted from upstream noema (`/tmp/upstream/noema/packages/noema-ai/src/extract-claims.ts`):
 * upstream `extractClaims()` deterministically mines structured claims
 * (identity/CUSIP/ISIN/NAV/yield/issuer + regex text fallback) from source
 * snapshots + evidence refs. This port keeps that shape — strict-parse raw
 * model JSON into a proposal, regex-free — but swaps the substrate: instead
 * of local snapshots, the warm path proposes via Alibaba Cloud DashScope
 * Qwen-Plus over native `fetch`, then binds the result to a SHA-256
 * `evidenceHash` (see `skills/noema-qa/provenance.ts`).
 *
 * Invariants (I-01, I-05):
 * - Macro Boy proposes ONLY. No order authority, no keys, no trades.
 * - Plain TypeScript + Zod + node:crypto/fetch. No LangChain/LangGraph/
 *   CrewAI/AutoGen, no external LLM frameworks.
 * - Fail-closed: missing `DASHSCOPE_API_KEY`, any network/parse error, or
 *   any schema violation → `fallbackToNeutral()` (direction NEUTRAL,
 *   score 0). `parseCatalystProposal()` itself THROWS on malformed input
 *   so callers can distinguish rejection from proposal; the async fetch
 *   entrypoint never throws (returns the NEUTRAL fallback).
 */

export const DASHSCOPE_MODEL = "qwen-plus";
export const DASHSCOPE_ENDPOINT =
  "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/text-generation/generation";

/** Fail-closed NEUTRAL proposal. Never throws. Always schema-valid. */
export function fallbackToNeutral(symbol: string, reason: string): MacroCatalystProposal {
  const sym = symbol && symbol.trim().length > 0 ? symbol : "UNKNOWN";
  const rationale = reason && reason.trim().length > 0 ? reason : "neutral fallback";
  return MacroCatalystProposalSchema.parse({
    symbol: sym,
    direction: "NEUTRAL",
    score: 0,
    confidence: 0,
    catalysts: [],
    evidenceHash: hashCatalystPayload({ symbol: sym, direction: "NEUTRAL", reason: rationale }),
    rationale,
    modelId: "fallback-neutral",
  });
}

/** Strip ```json fences / surrounding prose around the first {...} block. */
function extractJsonPayload(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const inner = (fenced?.[1] ?? text).trim();
  if (inner.startsWith("{")) return inner;
  const start = inner.indexOf("{");
  const end = inner.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) return inner.slice(start, end + 1);
  return inner;
}

function coerceToProposalText(rawJson: unknown): string {
  if (typeof rawJson === "string") return rawJson;
  if (rawJson !== null && typeof rawJson === "object") {
    const obj = rawJson as Record<string, unknown>;
    // DashScope generation shapes: { output: { text } } and
    // { output: { choices: [{ message: { content } }] } }.
    const output = obj["output"];
    if (typeof output === "object" && output !== null) {
      const out = output as Record<string, unknown>;
      if (typeof out["text"] === "string") return out["text"] as string;
      const choices = out["choices"];
      if (Array.isArray(choices) && choices.length > 0) {
        const first = choices[0] as Record<string, unknown>;
        const message = first["message"] as Record<string, unknown> | undefined;
        const content = message?.["content"];
        if (typeof content === "string") return content;
      }
    }
    const choices = obj["choices"];
    if (Array.isArray(choices) && choices.length > 0) {
      const first = choices[0] as Record<string, unknown>;
      const message = first["message"] as Record<string, unknown> | undefined;
      const content = message?.["content"];
      if (typeof content === "string") return content;
      if (typeof first["text"] === "string") return first["text"] as string;
    }
    // Otherwise the object IS the proposal candidate.
    return JSON.stringify(obj);
  }
  throw new Error("catalyst parse rejected: unsupported payload type");
}

/**
 * Strict-parse raw model output into a `MacroCatalystProposal`, bound to
 * `evidenceHash`. Throws on conversational noise, unformatted text, or any
 * schema violation (strict: unknown keys rejected). Callers that need a
 * non-throwing path use `fallbackToNeutral()` / `fetchCatalystProposal()`.
 */
export function parseCatalystProposal(
  rawJson: unknown,
  evidenceHash: string,
): MacroCatalystProposal {
  if (!/^[0-9a-f]{64}$/.test(evidenceHash)) {
    throw new Error("catalyst parse rejected: evidenceHash must be 64-char sha256 hex");
  }
  const text = coerceToProposalText(rawJson);
  let candidate: unknown;
  try {
    candidate = JSON.parse(extractJsonPayload(text));
  } catch {
    throw new Error("catalyst parse rejected: payload is not valid JSON");
  }
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("catalyst parse rejected: proposal must be a JSON object");
  }
  return MacroCatalystProposalSchema.parse({
    ...(candidate as Record<string, unknown>),
    evidenceHash,
  });
}

function buildPrompt(symbol: string, context: string): { system: string; user: string } {
  const system =
    "You are Macro Boy, a proposal-only macro catalyst extractor. " +
    "Respond with a SINGLE JSON object and nothing else — no markdown, no prose. " +
    "Keys (exactly): symbol, direction (BULLISH|BEARISH|NEUTRAL), score (0-100), " +
    "confidence (0-1), catalysts (array of {title, detail, sentiment, confidence}), " +
    "rationale, modelId. Do NOT include evidenceHash (the caller binds it).";
  const user =
    `Symbol: ${symbol}\n` +
    `Context: ${context && context.trim().length > 0 ? context : "(no context provided)"}\n` +
    `Return the JSON proposal object only.`;
  return { system, user };
}

/**
 * Warm-path DashScope Qwen-Plus catalyst fetch. NEVER throws: missing
 * `DASHSCOPE_API_KEY` or any network/schema failure returns
 * `fallbackToNeutral()` (direction NEUTRAL, score 0).
 */
export async function fetchCatalystProposal(
  symbol: string,
  context = "",
  fetchImpl: typeof fetch = fetch,
): Promise<MacroCatalystProposal> {
  const sym = symbol && symbol.trim().length > 0 ? symbol : "UNKNOWN";
  const apiKey = process.env["DASHSCOPE_API_KEY"];
  if (!apiKey || apiKey.trim().length === 0) {
    return fallbackToNeutral(sym, "missing DASHSCOPE_API_KEY: fail-closed NEUTRAL");
  }
  const evidenceHash = hashCatalystPayload({ symbol: sym, context });
  try {
    const { system, user } = buildPrompt(sym, context);
    const res = await fetchImpl(DASHSCOPE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DASHSCOPE_MODEL,
        input: {
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        },
        parameters: { result_format: "message" },
      }),
    });
    if (!res.ok) {
      return fallbackToNeutral(sym, `dashscope http ${res.status}: fail-closed NEUTRAL`);
    }
    const body: unknown = await res.json();
    return parseCatalystProposal(body, evidenceHash);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fallbackToNeutral(sym, `dashscope fetch failed (${msg}): fail-closed NEUTRAL`);
  }
}

export const MacroBoy = {
  parse: parseCatalystProposal,
  fallback: fallbackToNeutral,
  fetch: fetchCatalystProposal,
};
