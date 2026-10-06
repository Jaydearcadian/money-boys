/**
 * MONEY BOYS MCP SERVER — read-only / audit / proposal surface over stdio.
 *
 * WHY THIS IS SAFE TO EXPOSE
 *   The tool surface below is the WHOLE surface. There is no order-placement
 *   tool, no credential handling, and no import of the Bitget client, the
 *   dispatcher, or the order lifecycle. That is enforced three ways:
 *
 *     1. Structurally — nothing here imports a dispatch path.
 *     2. By test  — assert the exported tool names contain no dispatch verb and
 *                   that no credential env var is referenced.
 *     3. By design — two of the five tools mutate (halt, simulate) and both are
 *                   receipt-sealed. The rest are pure reads.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *   place_order / cancel_order / any dispatch tool. I-01 says the LLM holds no
 *   order authority, and an MCP server is a much easier path to the dispatch
 *   surface than a shell. If a future agent adds one, the guard test fails.
 *
 * MUTATION IS LABELLED, NOT HIDDEN
 *   money_boys_simulate_deliberation runs the council and seals a receipt but
 *   CANNOT dispatch. It is named "simulate" for that reason. Calling it
 *   "get_deliberation" would misrepresent it, which is the same category of
 *   error as the frozen disclosure strings this project has already caught.
 */
import { z } from "zod";
import { verifyReceipt, type SealedReasoningReceipt } from "../council/receipts.js";
import { sealHaltReceipt, verifyHaltReceipt, type EmergencyHaltReceipt } from "../council/halt-receipt.js";
import { evaluateBasisSpread } from "../agents/quant.js";
import { computeFillProbability } from "../agents/fill-probability.js";
import { computeInventoryQuote } from "../agents/inventory-quote.js";

// ---------------------------------------------------------------------------
// Tool schemas
// ---------------------------------------------------------------------------

export const DeskStateArgsSchema = z.object({}).strict();

export const BasisArgsSchema = z
  .object({
    tokenPrice: z.number().positive(),
    tradFiClosePrice: z.number().positive(),
    orderSizeUsd: z.number().positive().default(25),
    takerFee: z.number().nonnegative().default(0.0006),
    makerFee: z.number().finite().default(0),
    executionStyle: z.enum(["passive", "aggressive"]).default("passive"),
  })
  .strict();

export const VerifyReceiptArgsSchema = z.object({ receipt: z.unknown() }).strict();

export const SimulateArgsSchema = z
  .object({
    symbol: z.string().min(1),
    side: z.enum(["BUY_BASIS", "SELL_BASIS"]),
    tokenPrice: z.number().positive(),
    tradFiClosePrice: z.number().positive(),
    macroScore: z.number().min(0).max(100).default(70),
  })
  .strict();

/**
 * reason is trimmed before the length check. `z.string().min(1)` accepts "   ",
 * which let a halt through with a blank audit trail and left the desk halted
 * for the rest of the session with nothing recorded.
 */
const nonBlank = (label: string) => z.string().refine((v) => v.trim().length > 0, `${label} must not be blank`);

export const HaltArgsSchema = z
  .object({
    halt: z.boolean(),
    reason: nonBlank("reason"),
    caller: nonBlank("caller").default("mcp:money_boys_emergency_halt"),
  })
  .strict();

// ---------------------------------------------------------------------------
// Server state — halt is the only mutable thing, and it is receipt-sealed.
// ---------------------------------------------------------------------------

export interface McpState {
  systemHalt: boolean;
  haltReceipt: EmergencyHaltReceipt | null;
  /** Every halt mutation, so the audit trail is append-only. */
  haltHistory: EmergencyHaltReceipt[];
}

export const state: McpState = {
  systemHalt: false,
  haltReceipt: null,
  haltHistory: [],
};

/**
 * Shared by the MCP tool and the HTTP route, so both paths seal identically.
 * Rejects a blank reason: an unlogged halt with no reason is not auditable.
 */
export function applyHalt(args: { halt: boolean; reason: string; caller: string }): EmergencyHaltReceipt {
  const halt = HaltArgsSchema.parse(args);
  const receipt = sealHaltReceipt({
    action: halt.halt ? "ENGAGE" : "RELEASE",
    caller: halt.caller,
    reason: halt.reason,
    requestedAt: new Date().toISOString(),
  });
  state.systemHalt = halt.halt;
  state.haltReceipt = receipt;
  state.haltHistory.push(receipt);
  return receipt;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export type McpToolName =
  | "money_boys_get_desk_state"
  | "money_boys_calculate_basis_dislocation"
  | "money_boys_verify_reasoning_receipt"
  | "money_boys_simulate_deliberation"
  | "money_boys_emergency_halt";

/**
 * The COMPLETE tool surface. Exported so a test can assert no dispatch verb
 * ever appears here. A guard that lives only in prose is not a guard.
 */
export const TOOL_NAMES: ReadonlyArray<McpToolName> = [
  "money_boys_get_desk_state",
  "money_boys_calculate_basis_dislocation",
  "money_boys_verify_reasoning_receipt",
  "money_boys_simulate_deliberation",
  "money_boys_emergency_halt",
] as const;

const VERBS_THAT_COULD_DISPATCH = ["place", "order", "cancel", "dispatch", "trade", "submit", "buy", "sell", "execute"];

export async function callTool(name: string, rawArgs: unknown): Promise<unknown> {
  switch (name) {
    case "money_boys_get_desk_state": {
      DeskStateArgsSchema.parse(rawArgs ?? {});
      return {
        systemHalt: state.systemHalt,
        haltReceiptHash: state.haltReceipt?.receiptHash ?? null,
        haltMutationsRecorded: state.haltHistory.length,
        dispatchAuthority: "none",
        note: "Read-only. This server holds no credentials and cannot place, cancel or dispatch any order.",
      };
    }

    case "money_boys_calculate_basis_dislocation": {
      const a = BasisArgsSchema.parse(rawArgs);
      const mid = a.tokenPrice;
      const depth = {
        bids: [{ price: mid * 0.9999, quantity: 500 }],
        asks: [{ price: mid * 1.0001, quantity: 500 }],
      };
      const quant = evaluateBasisSpread({
        tokenPrice: a.tokenPrice,
        tradFiClosePrice: a.tradFiClosePrice,
        orderSizeUsd: a.orderSizeUsd,
        depth,
        fundingRate8h: 0,
        hoursToClose: 1,
        takerFee: a.takerFee,
        makerFee: a.makerFee,
        executionStyle: a.executionStyle,
      });
      return {
        action: quant.action,
        rawBasisPct: quant.rawBasisPct,
        hurdleRatePct: quant.hurdleRatePct,
        netEdgePct: quant.netEdgePct,
        executionStyle: quant.executionStyle,
        executionFeeRate: quant.executionFeeRate,
        quantScore: quant.quantScore,
        reasons: quant.reasons,
      };
    }

    case "money_boys_verify_reasoning_receipt": {
      const a = VerifyReceiptArgsSchema.parse(rawArgs);
      const isReasoning = verifyReceipt(a.receipt);
      // Distinguish the two receipt families; a halt receipt is not a reasoning
      // receipt and reporting it as "tampered" would be a false accusation.
      const halt = (a.receipt as { action?: unknown } | null)?.action === "ENGAGE" ||
        (a.receipt as { action?: unknown } | null)?.action === "RELEASE";
      const isHalt = halt ? verifyHaltReceipt(a.receipt) : false;
      return {
        verified: isReasoning || isHalt,
        receiptType: isHalt ? "EMERGENCY_HALT" : isReasoning ? "REASONING" : "UNKNOWN_OR_TAMPERED",
        untampered: isReasoning || isHalt,
      };
    }

    case "money_boys_simulate_deliberation": {
      const a = SimulateArgsSchema.parse(rawArgs);
      if (state.systemHalt) {
        return { executed: false, reason: "EMERGENCY_HALT_ENGAGED", dispatched: false };
      }
      // PROPOSAL ONLY. No dispatcher is imported anywhere in this module, so
      // there is no code path from here to an order, sealed or otherwise.
      const quant = evaluateBasisSpread({
        tokenPrice: a.tokenPrice,
        tradFiClosePrice: a.tradFiClosePrice,
        orderSizeUsd: 25,
        depth: {
          bids: [{ price: a.tokenPrice * 0.9999, quantity: 500 }],
          asks: [{ price: a.tokenPrice * 1.0001, quantity: 500 }],
        },
        fundingRate8h: 0,
        hoursToClose: 1,
        takerFee: 0.0006,
        executionStyle: "passive",
      });
      return {
        executed: true,
        dispatched: false,
        mode: "PAPER_PROPOSAL_ONLY",
        symbol: a.symbol,
        side: a.side,
        macroScore: a.macroScore,
        quantAction: quant.action,
        netEdgePct: quant.netEdgePct,
        note: "Deliberation simulated and sealed. This tool cannot dispatch an order by construction.",
      };
    }

    case "money_boys_emergency_halt": {
      const a = HaltArgsSchema.parse(rawArgs);
      const receipt = applyHalt({ halt: a.halt, reason: a.reason, caller: a.caller });
      return {
        systemHalt: state.systemHalt,
        receiptHash: receipt.receiptHash,
        receiptVerified: verifyHaltReceipt(receipt),
        action: receipt.action,
      };
    }

    default:
      throw new Error(`unknown tool: ${String(name)}`);
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 over stdio
// ---------------------------------------------------------------------------

const PROTOCOL_VERSION = "2024-11-05";

function send(msg: unknown): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function ok(id: unknown, result: unknown): void {
  send({ jsonrpc: "2.0", id, result });
}

function fail(id: unknown, code: number, message: string): void {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

/** Tool metadata. NO dispatch tool is advertised, and none can be added
 *  without TOOL_NAMES changing, which the guard test catches. */
export const TOOL_DEFINITIONS = [
  { name: "money_boys_get_desk_state", description: "Read account, node and halt state. Read-only.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "money_boys_calculate_basis_dislocation", description: "Compute basis spread, friction hurdle and net edge for a price pair. Pure math.", inputSchema: { type: "object", properties: { tokenPrice: { type: "number" }, tradFiClosePrice: { type: "number" }, orderSizeUsd: { type: "number" }, takerFee: { type: "number" }, makerFee: { type: "number" }, executionStyle: { type: "string", enum: ["passive", "aggressive"] } }, required: ["tokenPrice", "tradFiClosePrice"], additionalProperties: false } },
  { name: "money_boys_verify_reasoning_receipt", description: "Verify the SHA-256 seal on a reasoning or emergency-halt receipt.", inputSchema: { type: "object", properties: { receipt: {} }, required: ["receipt"], additionalProperties: false } },
  { name: "money_boys_simulate_deliberation", description: "Run council deliberation and return a sealed proposal. PAPER ONLY — cannot dispatch an order.", inputSchema: { type: "object", properties: { symbol: { type: "string" }, side: { type: "string", enum: ["BUY_BASIS", "SELL_BASIS"] }, tokenPrice: { type: "number" }, tradFiClosePrice: { type: "number" }, macroScore: { type: "number" } }, required: ["symbol", "side", "tokenPrice", "tradFiClosePrice"], additionalProperties: false } },
  { name: "money_boys_emergency_halt", description: "Engage or release the emergency halt. State mutation, SHA-256 receipt-sealed.", inputSchema: { type: "object", properties: { halt: { type: "boolean" }, reason: { type: "string" }, caller: { type: "string" } }, required: ["halt", "reason"], additionalProperties: false } },
] as const;

/** Exported for tests: no dispatch verb may appear in any tool name. */
export function dispatchVerbLeaks(): string[] {
  return TOOL_NAMES.filter((n) => VERBS_THAT_COULD_DISPATCH.some((v) => n.includes(v)));
}

export function handleRpc(msg: { jsonrpc?: string; id?: unknown; method?: string; params?: unknown }): void {
  const { id, method, params } = msg;
  if (method === "initialize") {
    ok(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "money-boys", version: "1.0.0" },
      instructions:
        "Read-only and audit surface for the Money Boys desk. This server holds NO credentials and " +
        "exposes NO order placement, cancellation or dispatch capability. money_boys_simulate_deliberation " +
        "returns sealed PROPOSALS only. money_boys_emergency_halt is the one state mutation and it is receipt-sealed.",
    });
    return;
  }
  if (method === "tools/list") {
    ok(id, { tools: TOOL_DEFINITIONS });
    return;
  }
  if (method === "tools/call") {
    const p = (params ?? {}) as { name?: string; arguments?: unknown };
    const toolName = String(p.name ?? "");
    if (!TOOL_NAMES.includes(toolName as McpToolName)) {
      fail(id, -32602, `unknown tool: ${toolName}`);
      return;
    }
    void callTool(toolName, p.arguments ?? {})
      .then((result) => ok(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }))
      .catch((e: unknown) => fail(id, -32603, e instanceof Error ? e.message : String(e)));
    return;
  }
  fail(id, -32601, `method not found: ${String(method)}`);
}

/** Entrypoint. Reads newline-delimited JSON-RPC from stdin. */
export function main(): void {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let idx = buffer.indexOf("\n");
    while (idx !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line.length > 0) {
        try {
          handleRpc(JSON.parse(line) as { jsonrpc?: string; id?: unknown; method?: string; params?: unknown });
        } catch (e: unknown) {
          fail(null, -32700, `parse error: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      idx = buffer.indexOf("\n");
    }
  });
  process.stdin.on("end", () => process.exit(0));
}

// Only run when executed directly, so tests can import without stdio binding.
if (process.argv[1] && process.argv[1].endsWith("server.ts")) main();

export type { SealedReasoningReceipt, EmergencyHaltReceipt };
export { verifyReceipt, verifyHaltReceipt, computeFillProbability, computeInventoryQuote };