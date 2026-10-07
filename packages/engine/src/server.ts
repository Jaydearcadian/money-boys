/**
 * Phase 05 Batch 2 — part 2b: HTTP + SSE entrypoint.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { executeDeliberationCycle } from "./council/adapter.js";
import { OrderDispatcher } from "./bitget/dispatcher.js";
import { TELEMETRY_PORT, COMMIT, state, snapshot, pushReceipt, broadcastReceipt, broadcastHalt, seedLatest, syncLiveAccountState } from "./server-state.js";
import { applyHalt } from "./mcp/server.js";
import { verifyHaltReceipt } from "./council/halt-receipt.js";
import { fixture, setCors, json, readBody } from "./server-helpers.js";
import { buildEvidenceResponse } from "./evidence-surface.js";

function isOperatorAuthorized(req: IncomingMessage): boolean {
  const operatorToken = process.env["OPERATOR_TOKEN"];
  const isCloudflare = Boolean(req.headers["cf-ray"] || req.headers["cf-connecting-ip"]);
  if (isCloudflare) {
    if (!operatorToken) return false;
    const authHeader = req.headers["authorization"] ?? "";
    const bearer = typeof authHeader === "string" && authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const tokenHeader = req.headers["x-operator-token"];
    return tokenHeader === operatorToken || bearer === operatorToken;
  }
  if (operatorToken) {
    const authHeader = req.headers["authorization"] ?? "";
    const bearer = typeof authHeader === "string" && authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const tokenHeader = req.headers["x-operator-token"];
    if (tokenHeader === operatorToken || bearer === operatorToken) return true;
    const ip = req.socket.remoteAddress ?? "";
    return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  }
  return true;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "OPTIONS") { setCors(res); res.writeHead(204); res.end(); return; }
  if (method === "GET" && path === "/health") { json(res, 200, { status: "ok", uptime: process.uptime(), commit: COMMIT }); return; }
  if (method === "GET" && path === "/api/desk/state") { json(res, 200, snapshot()); return; }
  if (method === "POST" && path === "/api/desk/sync-account") {
    if (!isOperatorAuthorized(req)) { json(res, 403, { error: "Forbidden: Mutating desk operations via public tunnel require valid x-operator-token" }); return; }
    try {
      const synced = await syncLiveAccountState();
      json(res, 200, { synced, state: snapshot() });
    } catch (err) { json(res, 500, { error: err instanceof Error ? err.message : String(err) }); }
    return;
  }
  if (method === "GET" && path === "/api/desk/receipts") { json(res, 200, { receipts: [...state.recentReceipts] }); return; }
  // Phase 1 read-only evidence surface. GET only: no body, no state mutation,
  // no credentials, no execution authority. See evidence-surface.ts.
  if (method === "GET" && path === "/api/desk/evidence") {
    try {
      const symbol = url.searchParams.get("symbol") ?? undefined;
      json(res, 200, await buildEvidenceResponse({ symbol }));
    } catch (err) { json(res, 500, { error: err instanceof Error ? err.message : String(err) }); }
    return;
  }
  if (method === "GET" && path === "/api/desk/stream") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "Access-Control-Allow-Origin": "*" });
    state.sseClients.add(res);
    res.write("data: " + JSON.stringify({ type: "INIT", state: snapshot() }) + "\n\n");
    const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* noop */ } }, 15_000);
    req.on("close", () => { clearInterval(ping); state.sseClients.delete(res); });
    return;
  }
  if (method === "POST" && path === "/api/desk/halt") {
    if (!isOperatorAuthorized(req)) { json(res, 403, { error: "Forbidden: Mutating desk operations via public tunnel require valid x-operator-token" }); return; }
    // This route used to flip state.systemHalt with NO audit trail at all. An
    // emergency halt is the most consequential state change the desk can make,
    // so it is now SHA-256 receipt-sealed through the SAME applyHalt() the MCP
    // tool uses — two paths, one sealing implementation.
    const raw = await readBody(req);
    let halt: boolean;
    let reason = "operator toggled via /api/desk/halt";
    if (raw.trim().length > 0) {
      try {
        const parsed = JSON.parse(raw) as { systemHalt?: unknown; reason?: unknown };
        halt = typeof parsed.systemHalt === "boolean" ? parsed.systemHalt : !state.systemHalt;
        if (typeof parsed.reason === "string" && parsed.reason.trim().length > 0) reason = parsed.reason;
      } catch {
        halt = !state.systemHalt;
        reason = "operator toggled via /api/desk/halt (unparseable body)";
      }
    } else {
      halt = !state.systemHalt;
    }
    const haltReceipt = applyHalt({ halt, reason, caller: "http:/api/desk/halt" });
    state.systemHalt = haltReceipt ? halt : halt;
    state.activeNodes.risk.hardVetoActive = state.systemHalt;
    broadcastHalt();
    json(res, 200, {
      systemHalt: state.systemHalt,
      haltReceiptHash: haltReceipt.receiptHash,
      haltReceiptVerified: verifyHaltReceipt(haltReceipt),
    });
    return;
  }
  if (method === "POST" && path === "/api/desk/simulate-cycle") {
    if (!isOperatorAuthorized(req)) { json(res, 403, { error: "Forbidden: Mutating desk operations via public tunnel require valid x-operator-token" }); return; }
    if (state.systemHalt === true) { json(res, 403, { error: "System emergency halt engaged. Deliberation prohibited." }); return; }
    try {
      let overrides: { symbol?: unknown; side?: unknown; quantity?: unknown; priceUsd?: unknown } = {};
      const rawBody = await readBody(req);
      if (rawBody.trim().length > 0) {
        try { overrides = JSON.parse(rawBody) as typeof overrides; } catch { overrides = {}; }
      }
      const fx = fixture(overrides);
      const dispatcher = new OrderDispatcher("PAPER");
      const out = await executeDeliberationCycle(fx.catalyst, fx.depth, fx.account, fx.params, dispatcher);
      pushReceipt(out.receipt);
      state.activeNodes.quant.lastNetEdgePct = Math.round(out.quant.netEdge * 10000) / 100;
      state.activeNodes.quant.latencyMs = Math.round(out.latencies.quantMs * 100) / 100;
      state.activeNodes.macro.latencyMs = Math.round(out.latencies.macroMs * 100) / 100;
      state.activeNodes.exec.latencyMs = Math.round(out.latencies.execMs * 100) / 100;
      state.activeNodes.risk.marginUtilizationPct = Math.round(out.risk.projectedMarginUtilization * 10000) / 100;
      state.activeNodes.risk.hardVetoActive = out.risk.decision !== "APPROVED";
      broadcastReceipt(out.receipt, out.executionRecord ?? null);
      json(res, 200, out);
    } catch (err) { json(res, 500, { error: err instanceof Error ? err.message : String(err) }); }
    return;
  }
  json(res, 404, { error: "Not found: " + method + " " + path });
}

export function createTelemetryServer(): Server {
  seedLatest();
  return createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      try { setCors(res); res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) })); } catch { /* noop */ }
    });
  });
}

export function startServer(port: number = TELEMETRY_PORT, host: string = "127.0.0.1"): Promise<Server> {
  seedLatest();
  const server = createTelemetryServer();
  return new Promise<Server>((resolve) => { server.listen(port, host, () => resolve(server)); });
}

export function stopServer(server: Server): Promise<void> {
  return new Promise<void>((resolve) => {
    for (const c of state.sseClients) { try { c.end(); } catch { /* noop */ } }
    state.sseClients.clear();
    server.close(() => resolve());
  });
}

export { TELEMETRY_PORT, COMMIT };

const isMain =
  (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) ||
  process.argv.some((a) => typeof a === "string" && a.endsWith("server.ts")) ||
  process.env["RUN_SERVER"] === "1";
if (isMain) {
  const server = createTelemetryServer();
  server.listen(TELEMETRY_PORT, "127.0.0.1", () => { console.log("[telemetry] MONEY BOYS desk telemetry listening on 127.0.0.1:" + TELEMETRY_PORT + " commit=" + COMMIT); });
}
