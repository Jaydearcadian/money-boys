import { useState } from "react";
import type { SealedReasoningReceipt } from "../../lib/api";
import { verifyReceiptInBrowser } from "../../lib/verify";
import { LockIcon, CheckIcon, ShieldIcon } from "../icons";

export function Verifier({ receipt }: { receipt: SealedReasoningReceipt | null }) {
  const [status, setStatus] = useState<"idle" | "busy" | "ok" | "bad">("idle");
  const [showRaw, setShowRaw] = useState(false);

  async function onVerify() {
    if (!receipt) return;
    setStatus("busy");
    try {
      const out = await verifyReceiptInBrowser(receipt);
      setStatus(out.ok ? "ok" : "bad");
    } catch {
      setStatus("bad");
    }
  }

  return (
    <section 
      id="verifier" 
      aria-labelledby="verifier-heading"
      className="rounded-3xl border border-zinc-200/80 bg-white p-6 sm:p-8 shadow-sm transition-all duration-300 hover:shadow-md"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-100 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-zinc-700">
              <LockIcon className="h-3 w-3 text-zinc-500" />
              IMMUTABLE PROVENANCE
            </span>
            <span className="font-mono text-xs text-zinc-400 hidden sm:inline">|</span>
            <span className="font-mono text-xs text-zinc-500 hidden sm:inline">W3C SubtleCrypto Native</span>
          </div>
          <h2 id="verifier-heading" className="mt-2 text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl">
            Cryptographic Receipt Verifier
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Recompute and verify the SHA-256 seal client-side over canonical JSON to prove zero off-chain tampering.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {receipt && (
            <button
              type="button"
              onClick={() => setShowRaw(!showRaw)}
              className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 font-mono text-xs text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 transition-colors"
            >
              {showRaw ? "Hide Canonical JSON" : "Inspect Canonical JSON"}
            </button>
          )}
        </div>
      </div>

      {/* Digital Receipt Card Container */}
      <div className="mt-6 rounded-2xl border border-zinc-200/90 bg-zinc-50/70 p-5 sm:p-6">
        {receipt ? (
          <div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 border-b border-zinc-200 pb-4">
              <div>
                <span className="block text-[11px] uppercase tracking-wider text-zinc-400">Receipt ID</span>
                <span className="mt-1 block font-mono text-xs font-semibold text-zinc-900">
                  {receipt.receiptId.slice(0, 16)}…
                </span>
              </div>
              <div>
                <span className="block text-[11px] uppercase tracking-wider text-zinc-400">Contract</span>
                <span className="mt-1 block font-mono text-xs font-semibold text-zinc-900">
                  {receipt.symbol} ({receipt.action})
                </span>
              </div>
              <div>
                <span className="block text-[11px] uppercase tracking-wider text-zinc-400">Council Decision</span>
                <span className="mt-1 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-700">
                  {receipt.decision}
                </span>
              </div>
              <div>
                <span className="block text-[11px] uppercase tracking-wider text-zinc-400">Audit Status</span>
                <span className="mt-1 inline-flex items-center gap-1 font-mono text-xs font-semibold text-zinc-700">
                  <ShieldIcon className="h-3.5 w-3.5 text-emerald-600" />
                  Pre-flight Sealed
                </span>
              </div>
            </div>

            <div className="mt-4">
              <span className="block text-[11px] uppercase tracking-wider text-zinc-400">Expected SHA-256 Digest</span>
              <p className="mt-1 break-all rounded-xl border border-zinc-200 bg-white p-3 font-mono text-xs font-medium text-zinc-800 shadow-inner">
                {receipt.receiptHash}
              </p>
            </div>

            {showRaw && (
              <div className="mt-4">
                <span className="block text-[11px] uppercase tracking-wider text-zinc-400">Canonical Serialized Payload</span>
                <pre className="mt-1 max-h-64 overflow-auto rounded-xl border border-zinc-200 bg-white p-4 font-mono text-[11px] leading-relaxed text-zinc-900 shadow-inner">
                  {JSON.stringify(receipt, null, 2)}
                </pre>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-200/60 text-zinc-500">
              <LockIcon className="h-6 w-6" />
            </div>
            <p className="mt-3 font-medium text-zinc-700">No receipt in buffer</p>
            <p className="mt-1 text-xs text-zinc-500">
              Simulate a trading cycle in the Operator Cockpit to produce a sealed receipt.
            </p>
            <pre className="mt-4 hidden font-mono text-xs text-zinc-400">No receipt yet — run a cycle.</pre>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3 pt-2">
          <button
            data-testid="verify-seal"
            disabled={!receipt || status === "busy"}
            onClick={() => void onVerify()}
            className="inline-flex items-center gap-2 rounded-full bg-zinc-950 px-5 py-2.5 font-sans text-xs font-semibold text-white shadow-sm transition-all duration-150 hover:bg-zinc-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <CheckIcon className="h-4 w-4 text-emerald-400" />
            Verify Cryptographic Seal In-Browser
          </button>

          {status === "ok" && (
            <span
              data-testid="verify-ok"
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3.5 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm"
            >
              <CheckIcon className="h-4 w-4 text-emerald-600" />
              ✔ SHA-256 PROVENANCE INTACT — 0 TAMPERING DETECTED
            </span>
          )}

          {status === "bad" && (
            <span
              data-testid="verify-bad"
              className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3.5 py-1.5 text-xs font-semibold text-rose-700 shadow-sm"
            >
              ✗ SEAL MISMATCH
            </span>
          )}

          {status === "busy" && (
            <span
              data-testid="verify-busy"
              className="inline-flex items-center gap-2 font-mono text-xs font-medium text-zinc-600"
            >
              <span className="h-2 w-2 animate-ping rounded-full bg-zinc-400" />
              hashing…
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
