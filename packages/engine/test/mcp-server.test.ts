import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyHalt,
  callTool,
  dispatchVerbLeaks,
  handleRpc,
  state,
  TOOL_DEFINITIONS,
  TOOL_NAMES,
} from "../src/mcp/server.js";
import { verifyHaltReceipt, sealHaltReceipt } from "../src/council/halt-receipt.js";
import { verifyReceipt } from "../src/council/receipts.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");

// ---------------------------------------------------------------------------
// GUARDRAIL 2 — the surface can never grow a dispatch path
// ---------------------------------------------------------------------------

describe("GUARDRAIL 2 — no dispatch capability", () => {
  it("exposes exactly the five declared tools", () => {
    assert.equal(TOOL_NAMES.length, 5);
  });

  it("no tool name contains a verb that could place, cancel or dispatch", () => {
    const leaks = dispatchVerbLeaks();
    assert.deepEqual(leaks, [], `dispatch verbs leaked into the tool surface: ${leaks.join(", ")}`);
  });

  it("no advertised tool mentions order placement", () => {
    for (const t of TOOL_DEFINITIONS) {
      assert.ok(!/place_order|cancel_order|submit_order/i.test(t.name), `${t.name} looks dispatch-capable`);
    }
  });

  it("the MCP module imports no dispatch or credential path", () => {
    const src = readFileSync(join(ROOT, "packages/engine/src/mcp/server.ts"), "utf8");
    // Strip comment lines so prose about dispatch does not trip the check.
    const code = src
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//") && !l.trimStart().startsWith("/*"))
      .join("\n");
    for (const forbidden of ["BitgetClient", "OrderDispatcher", "placeOrderWithLifecycle", "cancelOrder", "readPositions"]) {
      assert.ok(!code.includes(forbidden), `mcp/server.ts must not reference ${forbidden}`);
    }
  });

  it("the MCP module reads no credential environment variable", () => {
    const src = readFileSync(join(ROOT, "packages/engine/src/mcp/server.ts"), "utf8");
    for (const cred of ["BITGET_API_KEY", "BITGET_SECRET_KEY", "BITGET_PASSPHRASE", "DASHSCOPE_API_KEY", "API_KEY"]) {
      assert.ok(!src.includes(cred), `mcp/server.ts must not reference ${cred}`);
    }
  });

  it("rejects an unknown tool rather than dispatching something adjacent", async () => {
    await assert.rejects(() => callTool("money_boys_place_order", {}), /unknown tool/);
  });
});

// ---------------------------------------------------------------------------
// GUARDRAIL 1 — halt is receipt-sealed
// ---------------------------------------------------------------------------

describe("GUARDRAIL 1 — emergency halt is receipt-sealed", () => {
  it("seals a verifiable receipt on engage", async () => {
    const r = (await callTool("money_boys_emergency_halt", {
      halt: true, reason: "operator drill", caller: "test",
    })) as { receiptHash: string; receiptVerified: boolean; systemHalt: boolean };
    assert.equal(r.systemHalt, true);
    assert.equal(r.receiptVerified, true);
    assert.match(r.receiptHash, /^[0-9a-f]{64}$/);
    assert.equal(verifyHaltReceipt(state.haltReceipt), true);
  });

  it("records every mutation append-only", async () => {
    const before = state.haltHistory.length;
    applyHalt({ halt: false, reason: "drill complete", caller: "test" });
    assert.equal(state.haltHistory.length, before + 1);
    assert.equal(state.systemHalt, false);
  });

  it("records the action and caller on the receipt", () => {
    const r = sealHaltReceipt({ action: "ENGAGE", caller: "test", reason: "why", requestedAt: new Date().toISOString() });
    assert.equal(r.action, "ENGAGE");
    assert.equal(r.caller, "test");
    assert.equal(r.reason, "why");
  });

  it("rejects a halt with no reason — an unlogged halt is not auditable", () => {
    assert.throws(() => applyHalt({ halt: true, reason: "   ", caller: "test" }));
  });

  it("detects a tampered halt receipt", () => {
    const r = sealHaltReceipt({ action: "ENGAGE", caller: "x", reason: "y", requestedAt: new Date().toISOString() });
    assert.equal(verifyHaltReceipt(r), true);
    assert.equal(verifyHaltReceipt({ ...r, reason: "z" }), false, "reason edit must fail verification");
    assert.equal(verifyHaltReceipt({ ...r, receiptHash: "0".repeat(64) }), false);
    assert.equal(verifyHaltReceipt(null), false, "must not throw on malformed input");
    assert.equal(verifyHaltReceipt({ nope: true }), false);
  });
});

// ---------------------------------------------------------------------------
// Tool behaviour
// ---------------------------------------------------------------------------

describe("MCP tools", () => {
  beforeEach(() => { state.systemHalt = false; });

  it("get_desk_state reports no dispatch authority", async () => {
    const r = (await callTool("money_boys_get_desk_state", {})) as { dispatchAuthority: string; systemHalt: boolean };
    assert.equal(r.dispatchAuthority, "none");
    assert.equal(typeof r.systemHalt, "boolean");
  });

  it("get_desk_state rejects unexpected arguments", async () => {
    await assert.rejects(() => callTool("money_boys_get_desk_state", { placeOrder: true }));
  });

  it("calculate_basis_dislocation clears on a large passive edge", async () => {
    const r = (await callTool("money_boys_calculate_basis_dislocation", {
      tokenPrice: 235.5, tradFiClosePrice: 234.0, executionStyle: "passive",
    })) as { action: string; netEdgePct: number; executionStyle: string };
    assert.equal(r.executionStyle, "passive");
    assert.notEqual(r.action, "NEUTRAL");
    assert.ok(r.netEdgePct > 0);
  });

  it("calculate_basis_dislocation reports the passive hurdle, not the taker hurdle", async () => {
    const aggressive = (await callTool("money_boys_calculate_basis_dislocation", {
      tokenPrice: 235.5, tradFiClosePrice: 235.4, executionStyle: "aggressive",
    })) as { hurdleRatePct: number };
    const passive = (await callTool("money_boys_calculate_basis_dislocation", {
      tokenPrice: 235.5, tradFiClosePrice: 235.4, executionStyle: "passive",
    })) as { hurdleRatePct: number };
    assert.ok(passive.hurdleRatePct < aggressive.hurdleRatePct);
  });

  it("verify_reasoning_receipt reports a non-receipt as unverified, not as valid", async () => {
    // The contract under test is honest reporting, not receipt construction.
    for (const junk of [{}, { receiptHash: "0".repeat(64) }, null, "a string", 42]) {
      const r = (await callTool("money_boys_verify_reasoning_receipt", { receipt: junk })) as {
        verified: boolean; receiptType: string;
      };
      assert.equal(r.verified, false, `junk input ${JSON.stringify(junk)} must not verify`);
      assert.equal(r.receiptType, "UNKNOWN_OR_TAMPERED");
    }
  });

  it("verify_reasoning_receipt reports a halt receipt as its own type, not tampered", async () => {
    const r = (await callTool("money_boys_verify_reasoning_receipt", {
      receipt: sealHaltReceipt({ action: "RELEASE", caller: "t", reason: "r", requestedAt: new Date().toISOString() }),
    })) as { receiptType: string; verified: boolean };
    assert.equal(r.receiptType, "EMERGENCY_HALT");
    assert.equal(r.verified, true);
  });

  it("verify_reasoning_receipt rejects a tampered halt receipt", async () => {
    const r = (await callTool("money_boys_verify_reasoning_receipt", {
      receipt: { ...sealHaltReceipt({ action: "ENGAGE", caller: "t", reason: "r", requestedAt: new Date().toISOString() }), reason: "edited" },
    })) as { verified: boolean; receiptType: string };
    assert.equal(r.verified, false);
    assert.equal(r.receiptType, "UNKNOWN_OR_TAMPERED");
  });

  it("simulate_deliberation seals a receipt that verifies", async () => {
    // The documented demo flow is deliberate -> verify the seal. That only works
    // if simulate_deliberation actually seals one; it previously did not.
    const r = (await callTool("money_boys_simulate_deliberation", {
      symbol: "rNVDAUSDT", side: "BUY_BASIS", tokenPrice: 235.5, tradFiClosePrice: 230.0,
    })) as { receipt: unknown; receiptHash: string; dispatched: boolean; decision: string };

    assert.match(r.receiptHash, /^[0-9a-f]{64}$/);
    assert.equal(verifyReceipt(r.receipt), true, "sealed proposal must verify");
    assert.equal(r.dispatched, false);

    // And it must be verifiable through the public tool too.
    const viaTool = (await callTool("money_boys_verify_reasoning_receipt", { receipt: r.receipt })) as {
      verified: boolean; receiptType: string;
    };
    assert.equal(viaTool.verified, true);
    assert.equal(viaTool.receiptType, "REASONING");
  });

  it("a tampered simulated receipt fails verification", async () => {
    const r = (await callTool("money_boys_simulate_deliberation", {
      symbol: "rNVDAUSDT", side: "BUY_BASIS", tokenPrice: 235.5, tradFiClosePrice: 230.0,
    })) as { receipt: Record<string, unknown> };
    // Flip to the OPPOSITE decision. Hard-coding APPROVED was a no-op when the
    // council had already approved, so the seal correctly still verified.
    const was = r.receipt["decision"] === "APPROVED" ? "VETOED" : "APPROVED";
    const viaTool = (await callTool("money_boys_verify_reasoning_receipt", {
      receipt: { ...r.receipt, decision: was },
    })) as { verified: boolean };
    assert.equal(viaTool.verified, false, `flipping decision to ${was} must break the seal`);
  });

  it("simulate_deliberation never claims to dispatch", async () => {
    const r = (await callTool("money_boys_simulate_deliberation", {
      symbol: "rNVDAUSDT", side: "BUY_BASIS", tokenPrice: 235.5, tradFiClosePrice: 230.0,
    })) as { dispatched: boolean; mode: string };
    assert.equal(r.dispatched, false);
    assert.equal(r.mode, "PAPER_PROPOSAL_ONLY");
  });

  it("simulate_deliberation refuses while halted", async () => {
    applyHalt({ halt: true, reason: "drill", caller: "test" });
    const r = (await callTool("money_boys_simulate_deliberation", {
      symbol: "rNVDAUSDT", side: "BUY_BASIS", tokenPrice: 235.5, tradFiClosePrice: 230.0,
    })) as { executed: boolean; dispatched: boolean };
    assert.equal(r.executed, false);
    assert.equal(r.dispatched, false);
    applyHalt({ halt: false, reason: "drill over", caller: "test" });
  });
});

// ---------------------------------------------------------------------------
// JSON-RPC surface
// ---------------------------------------------------------------------------

describe("JSON-RPC 2.0 over stdio", () => {
  /**
   * Installs a stdout stub and returns the captured messages plus a restore
   * function. It deliberately does NOT auto-restore: tools/call resolves a
   * promise before writing, so a synchronous finally would un-stub stdout
   * before the response was ever emitted.
   */
  function capture(fn: () => void): { msgs: unknown[]; restore: () => void } {
    const msgs: unknown[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: unknown }).write = ((chunk: string) => {
      // The node:test reporter also writes to stdout. Capture ONLY JSON-RPC
      // frames and pass everything else straight through, or the stub swallows
      // the reporter's own output and JSON.parse throws on it.
      if (typeof chunk === "string" && chunk.startsWith('{"jsonrpc"')) {
        try { msgs.push(JSON.parse(chunk)); return true; } catch { /* fall through */ }
      }
      return orig(chunk);
    }) as typeof process.stdout.write;
    fn();
    return { msgs, restore: () => { (process.stdout as unknown as { write: unknown }).write = orig; } };
  }

  async function settle(msgs: unknown[]): Promise<void> {
    for (let i = 0; i < 100 && msgs.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
  }

  it("initialize returns protocol version and states the read-only contract", () => {
    const { msgs, restore } = capture(() => handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize" }));
    const msg = msgs[0] as Record<string, unknown>;
    restore();
    const result = msg["result"] as Record<string, unknown>;
    assert.equal(result["protocolVersion"], "2024-11-05");
    assert.match(String(result["instructions"]), /NO credentials/i);
    assert.match(String(result["instructions"]), /NO order placement/i);
  });

  it("tools/list advertises exactly the five tools", () => {
    const { msgs, restore } = capture(() => handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
    const result = (msgs[0] as Record<string, unknown>)["result"] as { tools: Array<{ name: string }> };
    restore();
    assert.deepEqual(result.tools.map((t) => t.name).sort(), [...TOOL_NAMES].sort());
  });

  it("tools/call returns a JSON content block", async () => {
    const { msgs, restore } = capture(() => handleRpc({
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "money_boys_get_desk_state", arguments: {} },
    }));
    await settle(msgs);
    restore();
    assert.equal(msgs.length, 1, "expected exactly one JSON-RPC response");
    const result = (msgs[0] as Record<string, unknown>)["result"] as { content: Array<{ type: string; text: string }> };
    assert.equal(result.content[0]!.type, "text");
    assert.match(result.content[0]!.text, /dispatchAuthority/);
  });

  it("returns a JSON-RPC error for an unknown method", () => {
    const { msgs, restore } = capture(() => handleRpc({ jsonrpc: "2.0", id: 4, method: "nope" }));
    const msg = msgs[0] as Record<string, unknown>;
    restore();
    assert.equal((msg["error"] as { code: number }).code, -32601);
  });

  it("returns a JSON-RPC error for an unknown tool", () => {
    const { msgs, restore } = capture(() => handleRpc({
      jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "money_boys_sell_everything", arguments: {} },
    }));
    const msg = msgs[0] as Record<string, unknown>;
    restore();
    assert.equal((msg["error"] as { code: number }).code, -32602);
  });
});