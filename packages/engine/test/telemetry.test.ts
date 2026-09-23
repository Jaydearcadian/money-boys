import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import type { Server } from "node:http";
import { verifyReceipt } from "../src/council/receipts.js";

/**
 * Phase 05 Batch 2 — telemetry server gates.
 * Binds an ephemeral port; asserts health/state/halt/simulate + SSE INIT.
 */

let PORT = 0;
let startServer: (port?: number) => Promise<Server>;
let stopServer: (server: Server) => Promise<void>;
let server: Server;

async function req(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown; text: string; headers: Headers }> {
  const res = await fetch("http://127.0.0.1:" + PORT + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { status: res.status, json: parsed, text, headers: res.headers };
}

describe("telemetry server (Phase 05 Batch 2)", () => {
  before(async () => {
    const mod = await import("../src/server.js");
    startServer = mod.startServer as (port?: number) => Promise<Server>;
    stopServer = mod.stopServer as (server: Server) => Promise<void>;
    server = await startServer(0);
    const addr = server.address();
    PORT = typeof addr === "object" && addr !== null ? (addr as { port: number }).port : 0;
    assert.ok(PORT > 0, "ephemeral port assigned");
  });

  after(async () => {
    await stopServer(server);
  });

  it("GET /health reports ok + commit", async () => {
    const r = await req("GET", "/health");
    assert.equal(r.status, 200);
    const body = r.json as Record<string, unknown>;
    assert.equal(body["status"], "ok");
    assert.ok(typeof body["commit"] === "string");
  });

  it("GET /api/desk/state has halt/nodes/account/receipt + CORS", async () => {
    const r = await req("GET", "/api/desk/state");
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("access-control-allow-origin"), "*");
    const body = r.json as Record<string, unknown>;
    assert.equal(body["systemHalt"], false);
    const nodes = body["activeNodes"] as Record<string, Record<string, unknown>>;
    assert.equal(nodes["macro"]?.["model"], "qwen3.8-max");
    const account = body["account"] as Record<string, unknown>;
    assert.equal(account["equityUsd"], 21795.18);
    assert.ok(body["latestReceipt"] !== null);
  });

  it("T3 simulate-cycle executes PAPER deliberation: valid receiptHash + PAPER orderId", async () => {
    const sim = await req("POST", "/api/desk/simulate-cycle");
    assert.equal(sim.status, 200);
    const body = sim.json as Record<string, unknown>;
    const receipt = body["receipt"] as Record<string, unknown>;
    assert.ok(receipt, "DeliberationCycleOutput.receipt present");
    assert.equal(verifyReceipt(receipt), true);
    assert.match(String(receipt["receiptHash"]), /^[0-9a-f]{64}$/);
    const exec = body["executionRecord"] as Record<string, unknown> | undefined;
    assert.ok(exec, "PAPER executionRecord attached");
    assert.equal(String(exec["orderId"]).length, 25);
    assert.match(String(exec["orderId"]), /^bg-paper-[0-9a-f]{16}$/);
  });

  it("T3b simulate-cycle honors body params (risk veto probe)", async () => {
    const r = await req("POST", "/api/desk/simulate-cycle", { quantity: 100, priceUsd: 200 });
    assert.equal(r.status, 200);
    const body = r.json as Record<string, unknown>;
    assert.ok(body["receipt"]);
    assert.equal(verifyReceipt(body["receipt"]), true);
  });

  it("T4 halt toggles flag; simulate-cycle 403 while halted", async () => {
    const halt = await req("POST", "/api/desk/halt", {});
    assert.equal((halt.json as Record<string, unknown>)["systemHalt"], true);
    const blocked = await req("POST", "/api/desk/simulate-cycle");
    assert.equal(blocked.status, 403);
    assert.match(String((blocked.json as Record<string, unknown>)["error"]), /halt/i);
    const unhalt = await req("POST", "/api/desk/halt", { systemHalt: false });
    assert.equal((unhalt.json as Record<string, unknown>)["systemHalt"], false);
  });

  it("GET /api/desk/stream emits INIT SSE event", async () => {
    const res = await fetch("http://127.0.0.1:" + PORT + "/api/desk/stream", {
      headers: { Accept: "text/event-stream" },
    });
    assert.equal(res.headers.get("content-type"), "text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      if (buf.includes("INIT")) break;
    }
    reader.cancel();
    assert.ok(buf.includes("INIT"), buf.slice(0, 200));
  });
});
