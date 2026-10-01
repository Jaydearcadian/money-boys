/**
 * Deterministic fixture server for the desk Playwright suite.
 *
 * Serves the built `dist/` and backs the engine API with checked-in JSON
 * fixtures. It makes NO outbound network call and reads no credentials.
 *
 * Scenario is selected by the request path:
 *   /api/desk/evidence              -> evidence-fresh.json
 *   /api/desk/evidence?scenario=...  -> evidence-<scenario>.json
 *   /api/desk/state                 -> desk-state.json
 *   /api/desk/receipts              -> { receipts: [valid, tampered?] }
 *   /api/desk/stream                -> SSE: INIT, then one NEW_RECEIPT
 *   /api/desk/halt                  -> { systemHalt: <flip> }
 *   /api/desk/simulate-cycle        -> { receipt } (never executes anything)
 *
 * PORT is read from EVIDENCE_PORT so the Playwright config controls it.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DIST = join(here, "..", "dist");
const FIX = join(here, "fixtures");
/**
 * MUST be 3001. The built bundle has `API_BASE` compiled in as
 * `http://localhost:3001` (see packages/desk/src/lib/api.ts), so serving the
 * fixture API on any other port silently sends every page request to nothing.
 * The page and the API are therefore same-origin here.
 */
const PORT = Number(process.env.EVIDENCE_PORT ?? 3001);

function fixture(name) {
  return JSON.parse(readFileSync(join(FIX, name), "utf8"));
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sse(res, event) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  res.write("data: " + JSON.stringify(event) + "\n\n");
}

/** Desk state used for SSE INIT and the /state read. */
function deskState() {
  return fixture("desk-state.json");
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  if (req.method === "OPTIONS") { json(res, 204, {}); return; }

  if (path === "/api/desk/evidence") {
    const scenario = url.searchParams.get("scenario") ?? "fresh";
    const file = `evidence-${scenario}.json`;
    if (!existsSync(join(FIX, file))) { json(res, 404, { error: "no such fixture: " + file }); return; }
    json(res, 200, fixture(file));
    return;
  }

  if (path === "/api/desk/state") { json(res, 200, deskState()); return; }

  if (path === "/api/desk/receipts") {
    const scenario = url.searchParams.get("scenario") ?? "valid";
    const receipts = [fixture("receipt-valid.json")];
    if (scenario === "tampered") receipts.push(fixture("receipt-tampered.json"));
    json(res, 200, { receipts });
    return;
  }

  if (path === "/api/desk/stream") {
    sse(res, { type: "INIT", state: deskState() });
    // One NEW_RECEIPT, delivered on a timer so the test can assert the DOM
    // BEFORE it arrives and AFTER it arrives.
    const scenario = url.searchParams.get("scenario") ?? "valid";
    const receipt = scenario === "tampered" ? fixture("receipt-tampered.json") : fixture("receipt-valid.json");
    const t = setTimeout(() => {
      try { sse(res, { type: "NEW_RECEIPT", receipt, execution: null }); } catch { /* closed */ }
    }, Number(process.env.EVIDENCE_SSE_DELAY_MS ?? 400));
    const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* closed */ } }, 5000);
    req.on("close", () => { clearTimeout(t); clearInterval(ping); });
    return;
  }

  if (path === "/api/desk/halt") { json(res, 200, { systemHalt: true }); return; }

  if (path === "/api/desk/simulate-cycle") { json(res, 200, fixture("receipt-valid.json")); return; }

  // ---- Static assets (SPA fallback to index.html) ----
  const rel = path === "/" ? "index.html" : path.replace(/^\/+/, "");
  let file = join(DIST, rel);
  if (!existsSync(file) || extname(file) === "") file = join(DIST, "index.html");
  if (!existsSync(file)) { res.writeHead(404); res.end("build output not found — run `pnpm build` first"); return; }
  const body = readFileSync(file);
  res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(body);
});

server.listen(PORT, () => {
  process.stdout.write(`[fixture-server] dist=${DIST} fixtures=${FIX} :${PORT}\n`);
});
