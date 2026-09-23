import { useState } from "react";
import { useDeskState } from "../hooks/useDeskState";
import { TopTelemetryBar } from "../components/desk/TopBar";
import { NodeMatrix } from "../components/desk/NodeMatrix";
import { QuorumGate } from "../components/desk/QuorumGate";
import { AuditLedger } from "../components/desk/AuditLedger";

export function DeskPage() {
  const { state, receipts, isConnected, isHalted, error, triggerSimulateCycle, triggerHalt } = useDeskState();
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function onSimulate(params?: { symbol?: string; side?: string; quantity?: number; priceUsd?: number }) {
    if (busy) return;
    setBusy(true);
    setLocalError(null);
    try {
      await triggerSimulateCycle(params);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onHalt() {
    if (busy) return;
    setBusy(true);
    setLocalError(null);
    try {
      await triggerHalt();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#FAF9F5" }}>
      <div className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <a href="#/" className="font-mono text-xs text-zinc-500 hover:text-orange-600">← MONEY BOYS // DESK-01</a>
          <span className="font-mono text-xs text-zinc-500">engine :3001 · desk :3000 · <span className={isConnected ? "text-orange-600" : "text-emerald-700"}>{isConnected ? "SSE LIVE" : "POLL"}</span>{isHalted ? " · HALTED" : ""}</span>
        </div>
      </div>
      <TopTelemetryBar
        state={state}
        isConnected={isConnected}
        busy={busy}
        error={localError ?? error}
        onSimulate={(p) => void onSimulate(p)}
        onVetoProbe={() => void onSimulate({ quantity: 100, priceUsd: 200 })}
        onHalt={() => void onHalt()}
      />
      <main className="mx-auto grid max-w-6xl gap-4 px-6 py-6 md:grid-cols-2">
        <NodeMatrix state={state} />
        <QuorumGate receipt={state?.latestReceipt ?? receipts[0] ?? null} />
        <div className="md:col-span-2">
          <AuditLedger receipts={receipts} />
        </div>
      </main>
    </div>
  );
}
