import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  runSandboxDeliberation,
  sandboxCanonicalJson,
  SANDBOX_PRESETS,
  type SandboxPreset,
  type SandboxResult,
} from "@money-boys/engine/council/browser-sandbox";
import { useRecords, baseTicker, type Decision, type Records } from "../../lib/records";
import { seal } from "../../lib/seal";
import { useSession } from "../../lib/session";

export type TabId = "cockpit" | "strategy" | "copilot" | "audit" | "sandbox";

export type Run = {
  n: number;
  result: SandboxResult;
  hash: string;
  ms: number;
  at: string;
};

export type DrawerItem = { kind: "record"; d: Decision } | { kind: "run"; run: Run } | null;

type Desk = {
  tab: TabId;
  go: (t: TabId) => void;
  records: Records | null;
  recordsError: string | null;
  sessionOpen: boolean;
  run: Run | null;
  history: Run[];
  runPreset: (p: SandboxPreset) => void;
  runCustom: (p: SandboxPreset) => void;
  runError: string | null;
  halted: boolean;
  setHalted: (h: boolean) => void;
  query: string;
  setQuery: (q: string) => void;
  symbol: string | null;
  setSymbol: (s: string | null) => void;
  drawer: DrawerItem;
  setDrawer: (d: DrawerItem) => void;
  bases: string[];
};

const Ctx = createContext<Desk | null>(null);

export function useDesk(): Desk {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDesk outside <DeskProvider>");
  return v;
}

export const TAB_HASH: Record<TabId, string> = {
  cockpit: "#/app",
  strategy: "#/strategy",
  copilot: "#/copilot",
  audit: "#/audit",
  sandbox: "#/sandbox",
};

export function DeskProvider({ initialTab, children }: { initialTab: TabId; children: ReactNode }) {
  const [tab, setTab] = useState<TabId>(initialTab);
  const { data, error } = useRecords();
  const sessionOpen = useSession();
  const [run, setRun] = useState<Run | null>(null);
  const [history, setHistory] = useState<Run[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [halted, setHaltedState] = useState(false);
  const [query, setQuery] = useState("");
  const [symbol, setSymbol] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerItem>(null);
  const counter = useRef(0);
  const haltedRef = useRef(false);

  useEffect(() => setTab(initialTab), [initialTab]);

  const go = useCallback((t: TabId) => {
    setTab(t);
    if (window.location.hash !== TAB_HASH[t]) window.history.replaceState(null, "", TAB_HASH[t]);
  }, []);

  const setHalted = useCallback((h: boolean) => {
    haltedRef.current = h;
    setHaltedState(h);
    setRunError(h ? "Halted. The sandbox refuses to run until you resume." : null);
  }, []);

  const execute = useCallback((p: SandboxPreset) => {
    if (haltedRef.current) {
      setRunError("Halted. The sandbox refuses to run until you resume.");
      return;
    }
    try {
      const t0 = performance.now();
      const result = runSandboxDeliberation(p);
      const ms = performance.now() - t0;
      const n = ++counter.current;
      setRunError(null);
      const base: Run = { n, result, hash: "", ms, at: new Date().toISOString() };
      setRun(base);
      void seal(result.receiptPayload).then((hash) => {
        const sealed = { ...base, hash };
        setRun((cur) => (cur && cur.n === n ? sealed : cur));
        setHistory((h) => [sealed, ...h].slice(0, 25));
      });
    } catch (e) {
      setRunError(e instanceof Error ? e.message.slice(0, 300) : String(e));
    }
  }, []);

  const runPreset = execute;
  const runCustom = execute;

  useEffect(() => {
    const first = SANDBOX_PRESETS[0];
    if (first) runPreset(first);
  }, [runPreset]);

  const bases = useMemo(() => {
    const set = new Set<string>();
    data?.decisions.forEach((d) => set.add(baseTicker(d.symbol)));
    data?.trades.forEach((t) => set.add(baseTicker(t.symbol)));
    return [...set].sort();
  }, [data]);

  const value: Desk = {
    tab,
    go,
    records: data,
    recordsError: error,
    sessionOpen,
    run,
    history,
    runPreset,
    runCustom,
    runError,
    halted,
    setHalted,
    query,
    setQuery,
    symbol,
    setSymbol,
    drawer,
    setDrawer,
    bases,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const canonicalJson = (v: unknown) => sandboxCanonicalJson(v);
