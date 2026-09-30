// Bitget MCP read-only transport (agent.bitget.com/mcp).
//
// Injected transport, NOT an SDK. The engine does not link an MCP client and
// does not own a session. A host supplies the transport; the engine only sees
// the return value of `callReadTool` and validates it.
//
// NO ORDER AUTHORITY: this file has no method that can sign, submit, cancel,
// or mutate anything. `McpReadOnlyTransport` in contracts.ts has exactly one
// method, so an order-capable implementation cannot satisfy the interface
// without changing it.

import { z } from "zod";
import {
  EquityQuoteSchema,
  type EquityQuote,
  type McpReadOnlyTransport,
} from "./contracts.js";

/** Tool names this adapter is willing to call. Anything else is refused. */
export const ALLOWED_READ_TOOLS = [
  "bitget.getEquityQuote",
  "bitget.searchEquityNews",
] as const;
export type AllowedReadTool = (typeof ALLOWED_READ_TOOLS)[number];

/**
 * Fail-closed allowlist check.
 *
 * Returns false for anything not explicitly permitted, so a misconfigured
 * transport cannot reach a mutating tool even if it would happily call one.
 */
export function isAllowedReadTool(tool: string): tool is AllowedReadTool {
  return (ALLOWED_READ_TOOLS as readonly string[]).includes(tool);
}

export class McpToolNotAllowedError extends Error {
  constructor(tool: string) {
    super(
      `MCP tool '${tool}' is not on the read-only allowlist. ` +
        `Permitted: ${ALLOWED_READ_TOOLS.join(", ")}. Refusing.`,
    );
    this.name = "McpToolNotAllowedError";
  }
}

export const EquityQuoteArraySchema = z.array(EquityQuoteSchema).max(200);
export type EquityQuoteArray = z.infer<typeof EquityQuoteArraySchema>;

/**
 * Coerce an untrusted MCP result into validated quotes.
 *
 * Accepts either a bare array or `{ quotes: [...] }`. Returns null when the
 * payload cannot be trusted, so the caller degrades to NEUTRAL rather than
 * reasoning over half-valid data.
 */
export function parseEquityQuotes(raw: unknown): EquityQuote[] | null {
  const candidate = Array.isArray(raw)
    ? raw
    : (raw as { quotes?: unknown } | null)?.quotes;
  const parsed = EquityQuoteArraySchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export interface EquityQuoteProvider {
  getQuote(symbol: string): Promise<EquityQuote | null>;
}

/**
 * Build an equity quote provider over an injected read-only transport.
 *
 * Never throws: an unavailable or malformed provider yields null, which the
 * Macro path treats as "no fresh benchmark" -> fail closed.
 */
export function createMcpEquityQuoteProvider(
  transport: McpReadOnlyTransport,
  tool: AllowedReadTool = "bitget.getEquityQuote",
): EquityQuoteProvider {
  return {
    async getQuote(symbol: string): Promise<EquityQuote | null> {
      const sym = (symbol ?? "").trim().toUpperCase();
      if (sym.length === 0) return null;
      if (!isAllowedReadTool(tool)) throw new McpToolNotAllowedError(tool);
      let raw: unknown;
      try {
        raw = await transport.callReadTool(tool, { symbol: sym });
      } catch {
        return null;
      }
      const quotes = parseEquityQuotes(raw);
      if (!quotes || quotes.length === 0) return null;
      return quotes.find((q) => q.symbol.toUpperCase() === sym) ?? null;
    },
  };
}
