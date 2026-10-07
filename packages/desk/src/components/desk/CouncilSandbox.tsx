import { useCallback, useMemo, useState } from "react";
import {
  runSandboxDeliberation,
  sandboxCanonicalJson,
  SANDBOX_PRESETS,
  type SandboxResult,
} from "@money-boys/engine/council/browser-sandbox";
import { verifyReceiptInBrowser } from "../../lib/verify";
import type { SealedReasoningReceipt } from "../../lib/api";

/**
 * COUNCIL SANDBOX — run a real deliberation in the browser, seal it with Web
 * Crypto, and never touch the server.
 *
 * The point is not a toy. It is the claim: "the council you just ran computed
 * entirely in your browser and the receipt verified with Web Crypto. The server
 * was never asked."
 *
 * Deliberate design points:
 *  - It never calls /api/desk/simulate-cycle. That endpoint appends to the
 *    shared receipt ledger and rewrites the node matrix every viewer sees, so
 *    exposing it to the public tunnel would corrupt the audit trail.
 *  - The verdicts are NOT hardcoded per preset. They are derived from the real
 *    engine, so a judge clicking "Too big for this account" gets a genuine
 *    HARD_VETO with the rule that fired.
 *  - There is a preset that is deliberately REFUSED, so this is not a
 *    success path that always says yes.
 */

type Sealed = { receipt: SealedReasoningReceipt; recomputed: string; ok: boolean };

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sealInBrowser(
  payload: Record<string, unknown>,
): Promise<{ receipt: SealedReasoningReceipt; recomputed: string; ok: boolean }> {
  const bytes = new TextEncoder().encode(sandboxCanonicalJson(payload));
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  const receiptHash = hex(digest);
  const receipt = {
    ...payload,
    receiptId: crypto.randomUUID(),
    sealedAt: new Date().toISOString(),
    receiptHash,
  } as unknown as SealedReasoningReceipt;
  const v = await verifyReceiptInBrowser(receipt);
  return { receipt, recomputed: v.recomputed, ok: v.ok };
}

function Node({ name, score, note }: { name: string; score: string; note: string }) {
  return (
    <div className="sb-node">
      <div className="sb-node-head">
        <span className="sb-node-name">{name}</span>
        <span className="sb-node-score">{score}</span>
      </div>
      <div className="sb-node-note">{note}</div>
    </div>
  );
}

export function CouncilSandbox() {
  const [result, setResult] = useState<SandboxResult | null>(null);
  const [sealed, setSealed] = useState<Sealed | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async (id: string) => {
    setBusy(true);
    setErr(null);
    setSealed(null);
    try {
      const preset = SANDBOX_PRESETS.find((p) => p.id === id);
      if (!preset) throw new Error(`unknown preset: ${id}`);
      const r = runSandboxDeliberation(preset);
      setResult(r);
      setSealed(await sealInBrowser(r.receiptPayload));
    } catch (e: unknown) {
      // An error must be a sentence, not a red banner. A judge who sees
      // "Could not run the council" learns nothing; one who sees the reason
      // learns something.
      setErr(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const blocked = useMemo(() => result !== null && result.council.status !== "APPROVED", [result]);

  return (
    <section className="sandbox" aria-label="Council sandbox">
      <header className="sandbox-head">
        <h2>Try it yourself</h2>
        <p>
          Pick a situation. A real deliberation runs <strong>in your browser</strong>, a
          receipt is sealed with Web Crypto, and the server is never contacted. The desk
          still cannot trade — that is the entire point of the design.
        </p>
      </header>

      <div className="sandbox-presets" role="group" aria-label="Sandbox scenarios">
        {SANDBOX_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="sandbox-preset"
            onClick={() => void run(p.id)}
            disabled={busy}
            aria-pressed={result?.presetId === p.id}
          >
            <span className="sandbox-preset-label">{p.label}</span>
            <span className="sandbox-preset-intent">{p.intent}</span>
          </button>
        ))}
      </div>

      {busy ? <p className="sandbox-status">Running the council…</p> : null}
      {err ? (
        <p className="sandbox-status sandbox-error">
          Could not run this scenario: {err}. Try another one, or reload the page.
        </p>
      ) : null}

      {!busy && !err && result === null ? (
        <p className="sandbox-status">Choose a scenario above to see what the desk decides.</p>
      ) : null}

      {result !== null ? (
        <div className="sandbox-result">
          <div className={`sandbox-verdict ${blocked ? "is-blocked" : "is-open"}`}>
            <strong>{blocked ? "Refused" : "Approved"}</strong>
            <span>{result.verdictPlain}</span>
          </div>

          <p className="sandbox-plain">{result.plainMeaning}</p>

          <div className="sandbox-nodes">
            <Node
              name="Macro Boy"
              score={`${result.quant.executionStyle} thesis`}
              note={`Sees the catalyst. Advisory only — it has no keys and cannot trade.`}
            />
            <Node
              name="Quant Boy"
              score={`net ${result.quant.netEdgePct.toFixed(4)}%`}
              note={`Gap ${result.quant.rawBasisPct.toFixed(4)}% minus a ${result.quant.hurdleRatePct.toFixed(4)}% cost of trading.`}
            />
            <Node
              name="Risk Boy"
              score={result.risk.permitted ? "permitted" : "HARD VETO"}
              note={
                result.risk.permitted
                  ? `Exposure $${result.risk.exposureUsd.toFixed(2)} on a $${result.notionalUsd.toFixed(0)} order.`
                  : result.risk.reasons.join(" ")
              }
            />
            <Node
              name="Execution Boy"
              score={`quorum ${result.council.quorum}/4`}
              note={`Council ${result.council.status} at score ${result.council.compositeScore.toFixed(1)}.`}
            />
          </div>

          <div className="sandbox-nodispatch">
            <span className="sandbox-nodispatch-key">dispatched</span>
            <span className="sandbox-nodispatch-value">false</span>
            <span className="sandbox-nodispatch-note">
              This sandbox cannot place an order. No API key exists in this page.
            </span>
          </div>

          {sealed !== null ? (
            <div className="sandbox-receipt">
              <div className="sandbox-receipt-row">
                <span>SHA-256 receipt</span>
                <code>{sealed.receipt.receiptHash}</code>
              </div>
              <div className="sandbox-receipt-row">
                <span>Verified in your browser</span>
                <strong>{sealed.ok ? "untampered ✓" : "MISMATCH ✗"}</strong>
              </div>
              <p className="sandbox-receipt-note">
                Sealed with <code>crypto.subtle.digest</code> using canonical JSON — the same
                scheme the server uses. Edit any field and this flips to MISMATCH.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default CouncilSandbox;
