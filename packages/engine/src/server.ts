/**
 * Phase 05 Batch 2 — part 2b: HTTP + SSE entrypoint.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { executeDeliberationCycle } from "./council/adapter.js";
import { TELEMETRY_PORT, COMMIT, state, snapshot, pushReceipt, broadcastReceipt, broadcastHalt, seedLatest } from "./server-state.js";
import { fixture, setCors, json, readBody } from "./server-helpers.js";

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "OPTIONS") { setCors(res); res.writeHead(204); res.end(); return; }
  if (method === "GET" && path === "/health") { json(res, 200, { status: "ok", uptime: process.uptime(), commit: COMMIT }); return; }
  if (method === "GET" && path === "/api/desk/state") { json(res, 200, snapshot()); return; }
  if (method === "GET" && path === "/api/desk/receipts") { json(res, 200, { receipts: [...state.recentReceipts].reverse() }); return; }
  if (method === "GET" && path === "/api/desk/stream") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "Access-Control-Allow-Origin": "*" });
    state.sseClients.add(res);
    res.write("data: " + JSON.stringify({ type: "INIT", state: snapshot() }) + "\n\n");
    const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* noop */ } }, 15_000);
    req.on("close", () => { clearInterval(ping); state.sseClients.delete(res); });
    return;
  }
  if (method === "POST" && path === "/api/desk/halt") {
    const raw = await readBody(req);
    if (raw.trim().length > 0) {
      try {
        const parsed = JSON.parse(raw) as { systemHalt?: unknown };
        if (typeof parsed.systemHalt === "boolean") state.systemHalt = parsed.systemHalt;
        else state.systemHalt = !state.systemHalt;
      } catch { state.systemHalt = !state.systemHalt; }
    } else { state.systemHalt = !state.systemHalt; }
    state.activeNodes.risk.hardVetoActive = state.systemHalt;
    broadcastHalt();
    json(res, 200, { systemHalt: state.systemHalt });
    return;
  }
  if (method === "POST" && path === "/api/desk/simulate-cycle") {
    if (state.systemHalt === true) { json(res, 403, { error: "System emergency halt engaged. Deliberation prohibited." }); return; }
    try {
      const fx = fixture();
      const out = await executeDeliberationCycle(fx.catalyst, fx.depth, fx.account, fx.params);
      pushReceipt(out.receipt);
      state.activeNodes.quant.lastNetEdgePct = Math.round(out.quant.netEdge * 10000) / 100;
      state.activeNodes.quant.latencyMs = Math.round(out.latencies.quantMs * 100) / 100;
      state.activeNodes.macro.latencyMs = Math.round(out.latencies.macroMs * 100) / 100;
      state.activeNodes.exec.latencyMs = Math.round(out.latencies.execMs * 100) / 100;
      state.activeNodes.risk.marginUtilizationPct = Math.round(out.risk.projectedMarginUtilization * 10000) / 100;
      state.activeNodes.risk.hardVetoActive = out.risk.decision !== "APPROVED";
      broadcastReceipt(out.receipt, { deliberation: out.deliberation, passNumber: out.passNumber, executionQuantity: out.executionQuantity });
      json(res, 200, { receipt: out.receipt, deliberation: out.deliberation, passNumber: out.passNumber, executionQuantity: out.executionQuantity, executionExposureUsd: out.executionExposureUsd, latencies: out.latencies });
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

export { TELEMETRY_PORT, COMMIT };

const isMain = process.argv[1] != null && (process.argv[1].endsWith("server.ts") || process.argv[1].endsWith("server.js"));
if (isMain) {
  const server = createTelemetryServer();
  server.listen(TELEMETRY_PORT, () => { console.log("[telemetry] listening on :" + TELEMETRY_PORT + " commit=" + COMMIT); });
}
