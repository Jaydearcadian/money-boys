import { useCallback, useEffect, useRef, useState } from "react";
import {
  API_BASE,
  fetchReceipts,
  fetchState,
  simulateCycle,
  toggleHalt,
  type DeliberationOutput,
  type DeskState,
  type SealedReasoningReceipt,
  type SimulateParams,
} from "../lib/api";

/**
 * SECTION 2 — useDeskState.
 * SSE-first (EventSource on /api/desk/stream) with 2s polling fallback.
 * Vite SPA port of the Next hook spec: INIT seeds state, NEW_RECEIPT
 * prepends + refreshes latest/latencies, HALT_CHANGE flips isHalted.
 */
export function useDeskState() {
  const [state, setState] = useState<DeskState | null>(null);
  const [receipts, setReceipts] = useState<SealedReasoningReceipt[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isHalted, setIsHalted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<number | null>(null);
  const stateRef = useRef<DeskState | null>(null);
  stateRef.current = state;

  const startPollFallback = useCallback(() => {
    if (pollRef.current !== null) return;
    pollRef.current = window.setInterval(() => {
      fetchState()
        .then((s) => {
          setState(s);
          setIsHalted(s.systemHalt);
          setIsConnected(false);
        })
        .catch(() => { /* keep last state */ });
      fetchReceipts().then((r) => {
        if (r.length > 0) setReceipts(r.slice(0, 50));
      }).catch(() => { /* noop */ });
    }, 2000);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchState().then((s) => {
      if (cancelled) return;
      setState(s);
      setIsHalted(s.systemHalt);
      if (s.latestReceipt) setReceipts((prev) => (prev.length > 0 ? prev : [s.latestReceipt as SealedReasoningReceipt]));
    }).catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });
    fetchReceipts().then((r) => {
      if (!cancelled && r.length > 0) setReceipts(r.slice(0, 50));
    }).catch(() => { /* noop */ });

    let es: EventSource | null = null;
    try {
      es = new EventSource(API_BASE + "/api/desk/stream");
      esRef.current = es;
      es.onopen = () => { if (!cancelled) { setIsConnected(true); setError(null); } };
      es.onmessage = (ev: MessageEvent) => {
        try {
          const msg = JSON.parse(ev.data as string) as Record<string, unknown>;
          if (msg["type"] === "INIT" && msg["state"]) {
            const s = msg["state"] as DeskState;
            setState(s);
            setIsHalted(s.systemHalt);
            setIsConnected(true);
            if (s.latestReceipt) {
              setReceipts((prev) => {
                const id = (s.latestReceipt as SealedReasoningReceipt).receiptId;
                if (prev.some((r) => r.receiptId === id)) return prev;
                return [s.latestReceipt as SealedReasoningReceipt, ...prev].slice(0, 50);
              });
            }
          } else if (msg["type"] === "NEW_RECEIPT" && msg["receipt"]) {
            const r = msg["receipt"] as SealedReasoningReceipt;
            setReceipts((prev) => (prev.some((x) => x.receiptId === r.receiptId) ? prev : [r, ...prev].slice(0, 50)));
            setState((prev) => (prev ? { ...prev, latestReceipt: r, recentCount: prev.recentCount + 1 } : prev));
            // Refresh node latencies/account after each receipt (cheap, keeps cards live).
            fetchState().then((s) => {
              if (!cancelled) { setState((prev) => (prev ? { ...prev, activeNodes: s.activeNodes, account: s.account } : s)); }
            }).catch(() => { /* noop */ });
          } else if (msg["type"] === "HALT_CHANGE") {
            setIsHalted(Boolean(msg["systemHalt"]));
            setState((prev) => (prev ? { ...prev, systemHalt: Boolean(msg["systemHalt"]) } : prev));
          }
        } catch { /* noop */ }
      };
      es.onerror = () => {
        if (!cancelled) { setIsConnected(false); startPollFallback(); }
      };
    } catch {
      startPollFallback();
    }
    return () => {
      cancelled = true;
      es?.close();
      esRef.current = null;
      if (pollRef.current !== null) { window.clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [startPollFallback]);

  const triggerSimulateCycle = useCallback(async (params?: SimulateParams): Promise<DeliberationOutput> => {
    const out = await simulateCycle(params);
    setReceipts((prev) => ([out.receipt, ...prev].slice(0, 50)));
    try {
      const s = await fetchState();
      setState({ ...s, latestReceipt: out.receipt });
      setIsHalted(s.systemHalt);
    } catch {
      setState((prev) => (prev ? { ...prev, latestReceipt: out.receipt } : prev));
    }
    return out;
  }, []);

  const triggerHalt = useCallback(async (): Promise<boolean> => {
    const current = stateRef.current?.systemHalt ?? isHalted;
    const out = await toggleHalt(current);
    setIsHalted(out.systemHalt);
    setState((prev) => (prev ? { ...prev, systemHalt: out.systemHalt } : prev));
    return out.systemHalt;
  }, [isHalted]);

  return { state, receipts, isConnected, isHalted, error, triggerSimulateCycle, triggerHalt };
}

export default useDeskState;
