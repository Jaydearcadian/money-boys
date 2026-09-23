import { useState } from "react";
import type { SealedReasoningReceipt } from "../../lib/api";
import { verifyReceiptInBrowser } from "../../lib/verify";

export function Verifier({ receipt }: { receipt: SealedReasoningReceipt | null }) {
  const [status, setStatus] = useState<"idle" | "busy" | "ok" | "bad">("idle");
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
    <section id="verifier" className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
      <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Cryptographic proof verifier</h2>
      <pre className="mt-3 max-h-64 overflow-auto border border-zinc-200 bg-zinc-50 p-3 font-mono text-[11px] text-zinc-950">{receipt ? JSON.stringify(receipt, null, 2) : "No receipt yet — run a cycle."}</pre>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button disabled={!receipt || status === "busy"} onClick={() => void onVerify()} className="bg-zinc-950 px-4 py-2 font-mono text-xs text-white hover:bg-zinc-800 disabled:opacity-40">Verify Cryptographic Seal In-Browser</button>
        {status === "ok" && <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">✔ SHA-256 PROVENANCE INTACT — 0 TAMPERING DETECTED</span>}
        {status === "bad" && <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">✗ SEAL MISMATCH</span>}
        {status === "busy" && <span className="font-mono text-xs text-zinc-500">hashing…</span>}
      </div>
    </section>
  );
}
