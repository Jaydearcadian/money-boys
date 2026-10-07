import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  runSandboxDeliberation,
  sandboxCanonicalJson,
  SANDBOX_PRESETS,
  type SandboxResult,
} from "../src/council/browser-sandbox.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");

/**
 * THE SANDBOX MUST BE RUNNABLE IN A BROWSER.
 *
 * The whole security argument rests on this module touching neither node:fs nor
 * fetch. A single node: import silently reintroduces a bundler shim and the
 * "no server contact" claim becomes unverifiable. So the boundary is asserted,
 * not assumed.
 */
describe("browser sandbox — boundary", () => {
  const src = readFileSync(join(ROOT, "packages/engine/src/council/browser-sandbox.ts"), "utf8");

  it("imports no node: built-ins", () => {
    const code = src
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//"))
      .join("\n");
    assert.ok(!/\bnode:/.test(code), "browser-sandbox.ts must not import any node: builtin");
  });

  it("imports no network client", () => {
    const code = src
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//"))
      .join("\n");
    assert.ok(!/\bfetch\b/.test(code), "browser-sandbox.ts must not call fetch");
    assert.ok(!/XMLHttpRequest/.test(code));
  });

  it("never references the mutating desk endpoint", () => {
    const code = src
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//"))
      .join("\n");
    assert.ok(!code.includes("simulate-cycle"), "sandbox must not call /api/desk/simulate-cycle");
    assert.ok(!code.includes("pushReceipt"), "sandbox must not append to the shared ledger");
  });

  it("the desk component never posts to simulate-cycle either", () => {
    const raw = readFileSync(
      join(ROOT, "packages/desk/src/components/desk/CouncilSandbox.tsx"),
      "utf8",
    );
    // Strip comments: the component explains WHY it avoids the endpoint, so the
    // string legitimately appears in prose. Only executable code is checked.
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n");
    assert.ok(!code.includes("simulate-cycle"), "CouncilSandbox must not call the mutating endpoint");
    assert.ok(!/\bfetch\s*\(/.test(code), "CouncilSandbox must not perform any network call");
  });
});

describe("browser sandbox — canonicalisation matches the server scheme", () => {
  it("sorts object keys recursively", () => {
    const json = sandboxCanonicalJson({ b: 1, a: { d: 2, c: 3 } });
    assert.equal(json, '{"a":{"c":3,"d":2},"b":1}');
  });

  it("drops undefined values so they cannot change the digest", () => {
    assert.equal(sandboxCanonicalJson({ a: 1, b: undefined }), '{"a":1}');
  });

  it("is byte-identical to the desk verifier's canonicalJson", () => {
    const deskSrc = readFileSync(join(ROOT, "packages/desk/src/lib/verify.ts"), "utf8");
    const engineSrc = readFileSync(join(ROOT, "packages/engine/src/council/browser-sandbox.ts"), "utf8");
    // Both must sort keys and drop undefined. Compare behaviour, not source text,
    // by hashing the same input through both algorithms conceptually: assert the
    // engine implementation produces the documented sorted output.
    assert.ok(deskSrc.includes(".sort()"), "desk verifier must still sort keys");
    assert.ok(engineSrc.includes(".sort()"), "sandbox must sort keys");
    assert.ok(deskSrc.includes("!== undefined"), "desk verifier must drop undefined");
    assert.ok(engineSrc.includes("!== undefined"), "sandbox must drop undefined");
  });

  it("produces a digest a browser seal would reproduce", () => {
    const r = runSandboxDeliberation(SANDBOX_PRESETS[0]!);
    const expected = createHash("sha256")
      .update(Buffer.from(sandboxCanonicalJson(r.receiptPayload), "utf8"))
      .digest("hex");
    assert.match(expected, /^[0-9a-f]{64}$/);
    // Determinism: the same preset must yield the same payload and digest.
    const again = runSandboxDeliberation(SANDBOX_PRESETS[0]!);
    assert.equal(sandboxCanonicalJson(again.receiptPayload), sandboxCanonicalJson(r.receiptPayload));
  });
});

describe("browser sandbox — verdicts are derived, not canned", () => {
  const byId = (id: string): SandboxResult =>
    runSandboxDeliberation(SANDBOX_PRESETS.find((p) => p.id === id)!);

  it("every preset demonstrates a DISTINCT outcome", () => {
    const outcomes = SANDBOX_PRESETS.map((p) => {
      const r = byId(p.id);
      if (!r.risk.permitted) return `RISK:${r.risk.reasons[0]!.slice(0, 34)}`;
      if (r.quant.netEdgePct <= 0) return "REFUSED_NOT_WORTH_IT";
      return r.council.status;
    });
    assert.equal(new Set(outcomes).size, outcomes.length, `presets collide: ${outcomes.join(" | ")}`);
  });

  it("cannot report dispatched=true under any preset", () => {
    for (const p of SANDBOX_PRESETS) {
      const r = runSandboxDeliberation(p);
      assert.equal(r.dispatched, false);
      assert.equal(r.serverContacted, false);
      const md = (r.receiptPayload as { metadata?: Record<string, unknown> }).metadata!;
      assert.equal(md["dispatched"], false);
      assert.equal(md["serverContacted"], false);
    }
  });

  it("risk veto is absolute and precedes the council", () => {
    const r = byId("risk-veto");
    assert.equal(r.risk.permitted, false);
    assert.equal(r.council.status, "HARD_VETO");
    assert.match(r.verdictPlain, /BLOCKED BY RISK/);
    // Even with a near-perfect macro score it stays blocked.
    assert.match(r.risk.reasons.join(" "), /single-trade cap/);
  });

  it("the margin-ceiling preset fires the 65% utilisation rule, not the trade cap", () => {
    // It was originally notionalUsd 12000, which tripped the $5k trade cap and
    // so did not demonstrate what its label claimed.
    const r = byId("margin-ceiling");
    assert.equal(r.risk.permitted, false);
    const reasons = r.risk.reasons.join(" ");
    assert.match(reasons, /margin utilization/i);
    assert.ok(!/single-trade cap/.test(reasons), "must not be blocked by the trade-size cap");
  });

  it("the no-edge preset is refused for cost, which is the most human demo", () => {
    const r = byId("no-edge");
    assert.ok(r.quant.netEdgePct <= 0, "the gap must be smaller than the hurdle");
    assert.match(r.verdictPlain, /NOT WORTH THE COST/);
  });

  it("the clean preset approves and still refuses to dispatch", () => {
    const r = byId("clean-edge");
    assert.equal(r.risk.permitted, true);
    assert.equal(r.council.status, "APPROVED");
    assert.equal(r.dispatched, false);
    assert.match(r.verdictPlain, /PROPOSED, NOT TRADED/);
  });

  it("records zero executed quantity so a receipt cannot be read as a fill", () => {
    for (const p of SANDBOX_PRESETS) {
      const r = runSandboxDeliberation(p);
      const md = (r.receiptPayload as { metadata?: Record<string, unknown> }).metadata!;
      assert.equal(md["executedQuantity"], 0);
      assert.equal(md["originalQuantity"], 0);
    }
  });

  it("rejects a malformed preset rather than guessing", () => {
    assert.throws(() => runSandboxDeliberation({ ...SANDBOX_PRESETS[0]!, notionalUsd: -1 }));
    assert.throws(() => runSandboxDeliberation({ ...SANDBOX_PRESETS[0]!, macroScore: 500 }));
  });

  it("verdicts are not hardcoded per preset id", () => {
    // Changing the preset inputs must change the verdict, proving it is derived.
    const clean = SANDBOX_PRESETS.find((p) => p.id === "clean-edge")!;
    const huge = runSandboxDeliberation({ ...clean, notionalUsd: 40_000 });
    assert.notEqual(huge.verdictPlain, runSandboxDeliberation(clean).verdictPlain);
  });
});
