/**
 * Stack smoke-test — end-to-end capture across all 3 tiers.
 * engine : http://localhost:3001, desk : http://localhost:3000
 * Run: pnpm exec tsx scripts/smoke-test-stack.ts (exit 0/1)
 */
import { verifyReceipt } from "../packages/engine/src/council/receipts.js";

const ENGINE = process.env["SMOKE_ENGINE_URL"] ?? "http://localhost:3001";
const DESK = process.env["SMOKE_DESK_URL"] ?? "http://localhost:3000";

let failures = 0;

function ok(name: string, detail = ""): void {
  console.log(`✔ ${name}${detail ? " — " + detail : ""}`);
}

function bad(name: string, detail = ""): void {
  failures += 1;
  console.log(`✘ ${name}${detail ? " — " + detail : ""}`);
}

async function fetchJson(
  url: string,
  init?: RequestInit,
  timeoutMs = 8000,
): Promise<{ status: number; headers: Headers; text: string; json: unknown }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { status: res.status, headers: res.headers, text, json: parsed };
  } finally {
    clearTimeout(t);
  }
}

async function check1EngineHealth(): Promise<void> {
  const name = "Check 1 (Engine Health): GET /health -> 200 status ok";
  try {
    const r = await fetchJson(`${ENGINE}/health`);
    const body = (r.json ?? {}) as Record<string, unknown>;
    if (r.status === 200 && body["status"] === "ok") ok(name, `200 ok commit=${String(body["commit"] ?? "?")}`);
    else bad(name, `expected 200 {status:"ok"}, got ${r.status} ${r.text.slice(0, 160)}`);
  } catch (err) {
    bad(name, err instanceof Error ? err.message : String(err));
  }
}

async function check2DeskPreview(): Promise<void> {
  const name = "Check 2 (Desk Preview): GET / -> 200 text/html";
  try {
    const r = await fetchJson(DESK + "/", undefined, 8000);
    const ct = r.headers.get("content-type") ?? "";
    if (r.status === 200 && ct.includes("text/html")) ok(name, `200 ${ct}`);
    else bad(name, `expected 200 text/html, got ${r.status} ct=${ct} body=${r.text.slice(0, 120)}`);
  } catch (err) {
    bad(name, err instanceof Error ? err.message : String(err));
  }
}

async function check3StateStore(): Promise<void> {
  const name = "Check 3 (State Store): 4 nodes, equity >= 20000, halt false";
  try {
    let r = await fetchJson(`${ENGINE}/api/desk/state`);
    let body = (r.json ?? {}) as Record<string, unknown>;
    if (r.status === 200 && body["systemHalt"] === true) {
      await fetchJson(`${ENGINE}/api/desk/halt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemHalt: false }),
      });
      r = await fetchJson(`${ENGINE}/api/desk/state`);
      body = (r.json ?? {}) as Record<string, unknown>;
    }
    if (r.status !== 200) {
      bad(name, `state status ${r.status}: ${r.text.slice(0, 160)}`);
      return;
    }
    const nodes = (body["activeNodes"] ?? {}) as Record<string, unknown>;
    const nodeKeys = Object.keys(nodes);
    const account = (body["account"] ?? {}) as Record<string, unknown>;
    const equity = Number(account["equityUsd"]);
    const problems: string[] = [];
    if (nodeKeys.length !== 4) problems.push(`nodes=${nodeKeys.length} (want 4)`);
    for (const k of ["macro", "quant", "risk", "exec"]) {
      if (!(k in nodes)) problems.push(`missing node ${k}`);
    }
    if (!Number.isFinite(equity) || equity < 20000) problems.push(`equity=${String(account["equityUsd"])} (want >= 20000)`);
    if (body["systemHalt"] !== false) problems.push(`systemHalt=${String(body["systemHalt"])} (want false)`);
    if (problems.length === 0) ok(name, `nodes=4 equity=${equity} halt=false`);
    else bad(name, problems.join("; "));
  } catch (err) {
    bad(name, err instanceof Error ? err.message : String(err));
  }
}
async function check4SseStream(): Promise<void> {
  const name = "Check 4 (SSE Stream): INIT within 3000ms";
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 3000);
    let buf = "";
    try {
      const res = await fetch(`${ENGINE}/api/desk/stream`, {
        headers: { Accept: "text/event-stream" },
        signal: ctrl.signal,
      });
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("text/event-stream")) {
        bad(name, `content-type=${ct} (want text/event-stream)`);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        bad(name, "empty response body");
        return;
      }
      const decoder = new TextDecoder();
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        if (buf.includes("INIT")) break;
      }
      try {
        reader.cancel();
      } catch {
        /* noop */
      }
    } catch (err) {
      if (!buf.includes("INIT")) {
        bad(name, err instanceof Error ? err.message : String(err));
        return;
      }
    } finally {
      clearTimeout(timeout);
    }
    if (buf.includes("INIT")) ok(name, `INIT received (${buf.length}b)`);
    else bad(name, `no INIT in 3000ms: ${buf.slice(0, 160)}`);
  } catch (err) {
    bad(name, err instanceof Error ? err.message : String(err));
  }
}

async function check5DeliberationLoop(): Promise<void> {
  const name = "Check 5 (Deliberation & Dispatch): simulate-cycle receipt + FILLED";
  try {
    const r = await fetchJson(`${ENGINE}/api/desk/simulate-cycle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: "rNVDAUSDT", side: "BUY", quantity: 10, priceUsd: 130 }),
    });
    if (r.status !== 200) {
      bad(name, `simulate status ${r.status}: ${r.text.slice(0, 200)}`);
      return;
    }
    const body = (r.json ?? {}) as Record<string, unknown>;
    const receipt = body["receipt"] as Record<string, unknown> | undefined;
    const exec = body["executionRecord"] as Record<string, unknown> | undefined;
    const problems: string[] = [];
    const hash = typeof receipt?.["receiptHash"] === "string" ? (receipt["receiptHash"] as string) : "";
    if (!/^[0-9a-f]{64}$/.test(hash)) problems.push("receiptHash not 64-hex");
    let verified = false;
    try {
      verified = verifyReceipt(receipt);
    } catch {
      verified = false;
    }
    if (!verified) problems.push("verifyReceipt() !== true");
    const orderId = typeof exec?.["orderId"] === "string" ? (exec["orderId"] as string) : "";
    if (!/^bg-paper-[0-9a-f]{16}$/.test(orderId)) problems.push(`orderId=${orderId} (want bg-paper-16hex)`);
    if (exec?.["status"] !== "FILLED") problems.push(`status=${String(exec?.["status"])} (want FILLED)`);
    if (problems.length === 0) ok(name, `verified order=${orderId} FILLED`);
    else bad(name, problems.join("; "));
  } catch (err) {
    bad(name, err instanceof Error ? err.message : String(err));
  }
}

async function check6HaltBreaker(): Promise<void> {
  const name = "Check 6 (Halt Breaker): halt -> 403 -> unhalt";
  try {
    const halt = await fetchJson(`${ENGINE}/api/desk/halt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemHalt: true }),
    });
    const haltBody = (halt.json ?? {}) as Record<string, unknown>;
    if (halt.status !== 200 || haltBody["systemHalt"] !== true) {
      bad(name, `halt engage failed: ${halt.status} ${halt.text.slice(0, 160)}`);
      return;
    }
    const blocked = await fetchJson(`${ENGINE}/api/desk/simulate-cycle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: "rNVDAUSDT", side: "BUY", quantity: 10, priceUsd: 130 }),
    });
    if (blocked.status !== 403) {
      await fetchJson(`${ENGINE}/api/desk/halt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemHalt: false }),
      });
      bad(name, `simulate while halted = ${blocked.status} (want 403)`);
      return;
    }
    const unhalt = await fetchJson(`${ENGINE}/api/desk/halt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemHalt: false }),
    });
    const unhaltBody = (unhalt.json ?? {}) as Record<string, unknown>;
    if (unhalt.status === 200 && unhaltBody["systemHalt"] === false) ok(name, "halt=true -> 403 -> halt=false");
    else bad(name, `unhalt failed: ${unhalt.status} ${unhalt.text.slice(0, 160)}`);
  } catch (err) {
    try {
      await fetchJson(`${ENGINE}/api/desk/halt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemHalt: false }),
      });
    } catch {
      /* noop */
    }
    bad(name, err instanceof Error ? err.message : String(err));
  }
}

async function main(): Promise<void> {
  console.log(`== money-boys stack smoke-test ==\nengine=${ENGINE} desk=${DESK}`);
  await check1EngineHealth();
  await check2DeskPreview();
  await check3StateStore();
  await check4SseStream();
  await check5DeliberationLoop();
  await check6HaltBreaker();
  if (failures === 0) console.log("SMOKE OK (6/6)");
  else {
    console.log(`SMOKE FAILED (${failures} failing)`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  bad("smoke-test", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

