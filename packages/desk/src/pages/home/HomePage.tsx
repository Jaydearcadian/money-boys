import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIcon,
  BrainIcon,
  CheckIcon,
  LayersIcon,
  LightningIcon,
  LockIcon,
  ShieldIcon,
  SparklesIcon,
  TerminalIcon,
  TrendingUpIcon,
} from "../../components/icons";
import "./home.css";

/* ───────────────────────── small building blocks ───────────────────────── */

function Tile({ children }: { children: ReactNode }) {
  return <span className="mh-tile">{children}</span>;
}

function Eyebrow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="mh-eyebrow">
      {icon}
      {children}
    </span>
  );
}

function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" focusable="false">
      <path d="M21 4a12 12 0 1 0 7 21.5A10 10 0 0 1 21 4Z" fill="currentColor" />
      <circle cx="23" cy="9" r="2" fill="currentColor" />
    </svg>
  );
}

/** Dark ribbed "waves" behind the hero, drawn as layered curves. */
function HeroWaves() {
  const lines = Array.from({ length: 34 }, (_, i) => i);
  return (
    <svg className="mh-waves" viewBox="0 0 1440 640" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
      <g fill="none" stroke="#fff" strokeWidth="1">
        {lines.map((i) => {
          const o = i * 9;
          return (
            <g key={i} opacity={0.12 + (i % 6) * 0.04}>
              <path d={`M-40 ${40 + o} C 180 ${-120 + o}, 300 ${520 + o}, 560 ${430 + o}`} />
              <path d={`M1480 ${40 + o} C 1260 ${-120 + o}, 1140 ${520 + o}, 880 ${430 + o}`} />
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function SectionHead({
  id,
  icon,
  tag,
  title,
  lead,
}: {
  id: string;
  icon: ReactNode;
  tag: string;
  title: string;
  lead: string;
}) {
  return (
    <>
      <Eyebrow icon={icon}>{tag}</Eyebrow>
      <h2 id={id}>{title}</h2>
      <p className="mh-lead">{lead}</p>
    </>
  );
}

/* ───────────────────────── real, computed session status ───────────────────────── */

/** US cash-equity session in New York time. Holidays are not modelled. */
function usSessionOpen(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday");
  const minutes = (Number(get("hour")) % 24) * 60 + Number(get("minute"));
  const isWeekday = !["Sat", "Sun"].includes(weekday);
  return isWeekday && minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

function useSession() {
  const [open, setOpen] = useState(() => usSessionOpen(new Date()));
  useEffect(() => {
    const t = window.setInterval(() => setOpen(usSessionOpen(new Date())), 30_000);
    return () => window.clearInterval(t);
  }, []);
  return open;
}

/* ───────────────────────── content ───────────────────────── */

const STACK = ["Bitget API v2", "Reality rTokens", "Alibaba Cloud", "Qwen", "TypeScript", "Node.js", "Zod", "Web Crypto", "Alpha Vantage"];

const WHAT_IS = [
  { icon: <ActivityIcon className="h-5 w-5" />, text: "Trades tokenized US stocks around the clock" },
  { icon: <ShieldIcon className="h-5 w-5" />, text: "Fixed safety rules that no AI can override" },
  { icon: <LockIcon className="h-5 w-5" />, text: "A sealed receipt for every decision" },
];

const GROUNDING = [
  {
    icon: <LayersIcon className="h-5 w-5" />,
    title: "Live token prices",
    body: "Bid, ask and midpoint of the tokenized stock, read from Bitget's order book.",
  },
  {
    icon: <TrendingUpIcon className="h-5 w-5" />,
    title: "The real stock price",
    body: "The latest official close of the underlying US stock, used as the reference.",
  },
  {
    icon: <ActivityIcon className="h-5 w-5" />,
    title: "The cost of trading",
    body: "Fees, slippage and funding are subtracted first. Only what is left counts as an opportunity.",
  },
];

const COUNCIL = [
  {
    icon: <BrainIcon className="h-5 w-5" />,
    name: "Macro Boy",
    role: "Reads the news",
    body: "Uses an AI model (Qwen on Alibaba Cloud) to read headlines and propose ideas. It only suggests, it holds no keys.",
  },
  {
    icon: <TrendingUpIcon className="h-5 w-5" />,
    name: "Quant Boy",
    role: "Does the math",
    body: "Measures the gap between token and stock, subtracts costs, and says whether any edge is left.",
  },
  {
    icon: <ShieldIcon className="h-5 w-5" />,
    name: "Risk Boy",
    role: "Says no",
    body: "A plain-code safety gate. It vetoes oversized trades or an overstretched account, and cannot be talked out of it.",
  },
  {
    icon: <LightningIcon className="h-5 w-5" />,
    name: "Execution Boy",
    role: "Places the order",
    body: "Sends the approved order to Bitget, but only after the sealed receipt exists.",
  },
];

const RULES = [
  { id: "I-01", text: "The AI proposes. It never holds keys or places orders." },
  { id: "I-02", text: "A hard veto over 65% account use, over $5,000 on one trade, or not enough free margin." },
  { id: "I-03", text: "A sealed receipt must exist before any order is sent." },
  { id: "I-04", text: "The order path targets under 50 ms. Slow thinking happens off to the side." },
  { id: "I-05", text: "Plain TypeScript. No hidden agent frameworks." },
];

/* ───────────────────────── interactive sandbox ───────────────────────── */

type Scenario = {
  id: string;
  label: string;
  story: string;
  symbol: string;
  tokenMid: number;
  benchmark: number;
  hurdlePct: number;
  marginPct: number;
  sizeUsd: number;
};

const SCENARIOS: Scenario[] = [
  {
    id: "earnings",
    label: "Weekend earnings surprise",
    story: "Good news lands on Saturday. The token jumps while the stock is shut.",
    symbol: "rNVDAUSDT",
    tokenMid: 133.4,
    benchmark: 130.0,
    hurdlePct: 0.62,
    marginPct: 38,
    sizeUsd: 3200,
  },
  {
    id: "thin",
    label: "Thin order book",
    story: "The token looks a little high, but the book is thin and costs eat the gap.",
    symbol: "rAAPLUSDT",
    tokenMid: 224.6,
    benchmark: 224.1,
    hurdlePct: 0.95,
    marginPct: 30,
    sizeUsd: 2000,
  },
  {
    id: "margin",
    label: "Overstretched account",
    story: "A real gap, but the account is already using too much of its margin.",
    symbol: "rTSLAUSDT",
    tokenMid: 261.5,
    benchmark: 255.0,
    hurdlePct: 0.62,
    marginPct: 71,
    sizeUsd: 2500,
  },
  {
    id: "oversize",
    label: "Trade too large",
    story: "A real gap, but the proposed trade is bigger than the single-trade limit.",
    symbol: "rNVDAUSDT",
    tokenMid: 133.4,
    benchmark: 130.0,
    hurdlePct: 0.62,
    marginPct: 40,
    sizeUsd: 7500,
  },
];

const MAX_MARGIN_PCT = 65;
const MAX_TRADE_USD = 5000;

type Step = { agent: string; text: string; ok: boolean };

function evaluate(s: Scenario) {
  const rawPct = ((s.tokenMid - s.benchmark) / s.benchmark) * 100;
  const edgePct = Math.abs(rawPct) - s.hurdlePct;
  const steps: Step[] = [
    {
      agent: "Macro Boy",
      ok: true,
      text: `Proposes an idea on ${s.symbol}. This is only a suggestion.`,
    },
    {
      agent: "Quant Boy",
      ok: edgePct > 0,
      text:
        edgePct > 0
          ? `Gap ${Math.abs(rawPct).toFixed(2)}% minus costs ${s.hurdlePct.toFixed(2)}% leaves ${edgePct.toFixed(2)}%. Worth a look.`
          : `Gap ${Math.abs(rawPct).toFixed(2)}% minus costs ${s.hurdlePct.toFixed(2)}% leaves ${edgePct.toFixed(2)}%. Nothing left.`,
    },
  ];
  let verdict: "APPROVED" | "REFUSED_NO_EDGE" | "VETOED";
  let reason = "";
  if (edgePct <= 0) {
    verdict = "REFUSED_NO_EDGE";
    reason = "Costs are larger than the gap.";
  } else if (s.marginPct > MAX_MARGIN_PCT) {
    verdict = "VETOED";
    reason = `Account use ${s.marginPct}% is over the ${MAX_MARGIN_PCT}% limit.`;
  } else if (s.sizeUsd > MAX_TRADE_USD) {
    verdict = "VETOED";
    reason = `Trade size $${s.sizeUsd.toLocaleString()} is over the $${MAX_TRADE_USD.toLocaleString()} limit.`;
  } else {
    verdict = "APPROVED";
    reason = `Account use ${s.marginPct}% and size $${s.sizeUsd.toLocaleString()} are inside the limits.`;
  }
  if (edgePct > 0) {
    steps.push({ agent: "Risk Boy", ok: verdict === "APPROVED", text: reason });
    steps.push({
      agent: "Execution Boy",
      ok: verdict === "APPROVED",
      text: verdict === "APPROVED" ? "Seals the receipt, then sends a practice order." : "Stands down. No order is sent.",
    });
  } else {
    steps.push({ agent: "Risk Boy", ok: false, text: "Nothing to check. The idea is dropped." });
    steps.push({ agent: "Execution Boy", ok: false, text: "Stands down. No order is sent." });
  }
  return { rawPct, edgePct, verdict, reason, steps };
}

async function sha256Hex(text: string): Promise<string> {
  if (!globalThis.crypto?.subtle) return "unavailable in this browser";
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function Sandbox() {
  const [idx, setIdx] = useState(0);
  const [shown, setShown] = useState(0);
  const [hash, setHash] = useState("");
  const scenario = SCENARIOS[idx]!;
  const result = useMemo(() => evaluate(scenario), [scenario]);

  const receiptBody = useMemo(
    () => ({
      scenario: scenario.id,
      symbol: scenario.symbol,
      tokenMid: scenario.tokenMid,
      benchmarkClose: scenario.benchmark,
      gapPct: Number(result.rawPct.toFixed(4)),
      costsPct: scenario.hurdlePct,
      edgePct: Number(result.edgePct.toFixed(4)),
      accountUsePct: scenario.marginPct,
      tradeSizeUsd: scenario.sizeUsd,
      verdict: result.verdict,
    }),
    [scenario, result],
  );
  const receiptText = JSON.stringify(receiptBody, null, 2);

  useEffect(() => {
    setShown(0);
    setHash("");
    const timers = result.steps.map((_, i) => window.setTimeout(() => setShown(i + 1), 280 * (i + 1)));
    return () => timers.forEach(window.clearTimeout);
  }, [result]);

  useEffect(() => {
    if (shown < result.steps.length) return;
    let live = true;
    void sha256Hex(JSON.stringify(receiptBody)).then((h) => live && setHash(h));
    return () => {
      live = false;
    };
  }, [shown, result.steps.length, receiptBody]);

  const done = shown >= result.steps.length;

  return (
    <div className="mh-sbx">
      <div className="mh-sbx-tabs" role="tablist" aria-label="Scenarios">
        {SCENARIOS.map((s, i) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={i === idx}
            className={`mh-tab ${i === idx ? "is-on" : ""}`}
            onClick={() => setIdx(i)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="mh-sbx-body">
        <div className="mh-card mh-sbx-col">
          <p className="mh-sbx-story">{scenario.story}</p>
          <dl className="mh-kv">
            <div><dt>Token midpoint</dt><dd>{scenario.tokenMid.toFixed(2)}</dd></div>
            <div><dt>Stock close</dt><dd>{scenario.benchmark.toFixed(2)}</dd></div>
            <div><dt>Costs</dt><dd>{scenario.hurdlePct.toFixed(2)}%</dd></div>
            <div><dt>Account use</dt><dd>{scenario.marginPct}%</dd></div>
            <div><dt>Trade size</dt><dd>${scenario.sizeUsd.toLocaleString()}</dd></div>
          </dl>
          <ol className="mh-steps" aria-live="polite">
            {result.steps.slice(0, shown).map((st) => (
              <li key={st.agent} className={st.ok ? "ok" : "no"}>
                <span className="mh-step-ic">{st.ok ? <CheckIcon className="h-3 w-3" /> : <span>×</span>}</span>
                <span>
                  <strong>{st.agent}</strong> {st.text}
                </span>
              </li>
            ))}
          </ol>
          {done && (
            <div className={`mh-verdict ${result.verdict === "APPROVED" ? "ok" : "no"}`} data-testid="verdict">
              {result.verdict === "APPROVED" ? "Approved" : result.verdict === "VETOED" ? "Vetoed by Risk Boy" : "Refused: no edge"}
            </div>
          )}
        </div>

        <div className="mh-card mh-sbx-col">
          <div className="mh-code-head">
            <div className="mh-code-dots"><i /><i /><i /></div>
            <span>receipt.json (example, computed in your browser)</span>
          </div>
          <pre className="mh-receipt">{receiptText}</pre>
          <div className="mh-hash">
            <span>SHA-256</span>
            <code data-testid="receipt-hash">{done ? hash || "sealing…" : "waiting for decision…"}</code>
          </div>
        </div>
      </div>
      <p className="mh-note">Illustrative inputs for practice. Nothing here moves money.</p>
    </div>
  );
}

/* ───────────────────────── page ───────────────────────── */

export function HomePage() {
  const open = useSession();

  return (
    <div className="mh">
      <header className="mh-nav">
        <a href="#/" className="mh-brand" aria-label="Money Boys home">
          <Logo size={22} />
          <span>Money Boys</span>
        </a>
        <nav aria-label="Primary" className="mh-nav-links">
          <a href="#about">What it is</a>
          <a href="#gap">The gap</a>
          <a href="#team">The four helpers</a>
          <a href="#rules">Safety</a>
          <a href="#tracks">Tracks</a>
          <a href="#sandbox">Try it</a>
          <a href="#built">How it was built</a>
        </nav>
        <a href="#/sandbox" className="mh-pill mh-pill-sm">Try the sandbox</a>
      </header>

      <main id="main">
        <section className="mh-hero" aria-labelledby="hero-h">
          <HeroWaves />
          <div className="mh-hero-glow" aria-hidden="true" />
          <div className="mh-hero-inner">
            <div className="mh-status" role="status" data-testid="session-status">
              <span className="mh-status-item">
                <i className={open ? "on" : "off"} />
                US stock market: {open ? "open" : "closed"}
              </span>
              <span className="mh-status-sep" />
              <span className="mh-status-item">
                <i className="on" />
                Tokenized stocks on Bitget: trading
              </span>
            </div>
            <h1 id="hero-h">
              A trading desk that works
              <br />
              while Wall Street sleeps.
            </h1>
            <p className="mh-sub">Four AI helpers. One strict safety gate. A sealed receipt for every decision.</p>
            <div className="mh-cta-row">
              <a href="#/sandbox" className="mh-pill">Try the sandbox</a>
              <a href="#evidence" className="mh-ghost">See the records</a>
            </div>

            <div className="mh-hero-mark" aria-hidden="true">
              <div className="mh-mark-tile">
                <Logo size={34} />
              </div>
              <div className="mh-beam" />
            </div>
          </div>
        </section>

        <section className="mh-strip" aria-label="Technology Money Boys is built on">
          {STACK.map((s) => (
            <span key={s}>{s}</span>
          ))}
        </section>

        <section id="about" className="mh-section" aria-labelledby="about-h">
          <SectionHead
            id="about-h"
            icon={<Logo size={12} />}
            tag="INTRODUCTION"
            title="What is Money Boys?"
            lead="Money Boys is an automatic trading desk for tokenized US stocks on Bitget. Stock markets close for the night and the weekend, but the tokens keep trading. Money Boys watches that gap and decides, calmly and by fixed rules, whether there is anything worth doing."
          />
          <div className="mh-cards3">
            {WHAT_IS.map((w) => (
              <div key={w.text} className="mh-card mh-card-row">
                <Tile>{w.icon}</Tile>
                <span>{w.text}</span>
              </div>
            ))}
          </div>
        </section>

        <section id="gap" className="mh-section" aria-labelledby="gap-h">
          <SectionHead
            id="gap-h"
            icon={<ActivityIcon className="h-3 w-3" />}
            tag="THE OPPORTUNITY"
            title="The gap that never sleeps"
            lead="US stocks trade about 32.5 hours a week. Their tokens on Bitget trade all 168. News, earnings and crypto demand move the token while the stock cannot move, and that is where prices drift apart."
          />
          <div className="mh-hours" aria-label="Trading hours per week">
            <div className="mh-hours-row">
              <span>US stock market</span>
              <div className="mh-bar"><i style={{ width: `${(32.5 / 168) * 100}%` }} /></div>
              <b>32.5 h</b>
            </div>
            <div className="mh-hours-row">
              <span>Tokens on Bitget</span>
              <div className="mh-bar"><i className="full" style={{ width: "100%" }} /></div>
              <b>168 h</b>
            </div>
          </div>
        </section>

        <section id="grounding" className="mh-section" aria-labelledby="grounding-h">
          <SectionHead
            id="grounding-h"
            icon={<LayersIcon className="h-3 w-3" />}
            tag="GROUNDED IN FACTS"
            title="Every decision starts from real numbers"
            lead="Money Boys never guesses a price. It reads live data, rejects anything stale, and does the sums in ordinary code before any AI opinion is allowed to matter."
          />
          <div className="mh-cards3">
            {GROUNDING.map((g) => (
              <article key={g.title} className="mh-card mh-card-col">
                <Tile>{g.icon}</Tile>
                <h3>{g.title}</h3>
                <p>{g.body}</p>
              </article>
            ))}
          </div>
          <div className="mh-formula mh-card" aria-label="How an opportunity is measured">
            <code>opportunity = |token − stock| ÷ stock − (fees + slippage + funding)</code>
            <span>If the result is zero or less, Money Boys does nothing. Data older than one second is rejected.</span>
          </div>
        </section>

        <section id="team" className="mh-section" aria-labelledby="team-h">
          <SectionHead
            id="team-h"
            icon={<SparklesIcon className="h-3 w-3" />}
            tag="THE DESK"
            title="Four helpers, one decision"
            lead="Instead of one opaque AI prompt, the work is split between four helpers with separate jobs. Only one of them is an AI."
          />
          <div className="mh-cards4">
            {COUNCIL.map((c, i) => (
              <article key={c.name} className="mh-card mh-agent">
                <div className="mh-agent-top">
                  <Tile>{c.icon}</Tile>
                  <span className="mh-agent-n">0{i + 1}</span>
                </div>
                <h3>{c.name}</h3>
                <b>{c.role}</b>
                <p>{c.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="rules" className="mh-section" aria-labelledby="rules-h">
          <SectionHead
            id="rules-h"
            icon={<ShieldIcon className="h-3 w-3" />}
            tag="SAFETY"
            title="Rules that never bend"
            lead="Five rules are written as ordinary code. They behave the same every time, whatever the AI says."
          />
          <ul className="mh-rules">
            {RULES.map((r) => (
              <li key={r.id} className="mh-card">
                <code>{r.id}</code>
                <span>{r.text}</span>
              </li>
            ))}
          </ul>
        </section>


        <section id="tracks" className="mh-section" aria-labelledby="tracks-h">
          <SectionHead
            id="tracks-h"
            icon={<LayersIcon className="h-3 w-3" />}
            tag="THREE COMPETITION TRACKS"
            title="One desk. Three proof surfaces."
            lead="Money Boys is built to be judged the way Bitget Hackathon S2 is scored: pure quant survival, agentic authority isolation, and institutional portfolio depth — each backed by sealed venue evidence, not slides."
          />
          <div className="mh-cards3">
            <article className="mh-card mh-card-col">
              <Tile><TrendingUpIcon className="h-5 w-5" /></Tile>
              <h3>Track 1 · Alpha Factory</h3>
              <p>89-day venue walk-forward on Bitget candles: +$1,228.83 net, 48 out-of-sample trades clearing the ≥30 gate, mean pairwise ρ = 0.197.</p>
              <a className="mh-link" href="#/strategy">Open strategy desk</a>
            </article>
            <article className="mh-card mh-card-col">
              <Tile><LightningIcon className="h-5 w-5" /></Tile>
              <h3>Track 2 · Agentic execution</h3>
              <p>Three-beat pipeline: LLM proposes without keys, deterministic veto with zero venue calls, then Bitget v2 paper fills sealed by SHA-256.</p>
              <a className="mh-link" href="#/audit">Open audit desk</a>
            </article>
            <article className="mh-card mh-card-col">
              <Tile><ShieldIcon className="h-5 w-5" /></Tile>
              <h3>Track 3 · Portfolio Copilot</h3>
              <p>Factor ceilings in code: net beta ≤ 2.50, sector ≤ 60%, single asset ≤ 40%, with an interactive blast-radius simulator.</p>
              <a className="mh-link" href="#/copilot">Open copilot desk</a>
            </article>
          </div>
        </section>

        <section id="sandbox" className="mh-section mh-wide" aria-labelledby="sandbox-h">
          <SectionHead
            id="sandbox-h"
            icon={<LightningIcon className="h-3 w-3" />}
            tag="TRY IT"
            title="Watch the desk decide"
            lead="Pick a situation and see each helper weigh in. The sums, the limits and the receipt seal below all run live in your browser."
          />
          <Sandbox />
        </section>

        <section id="evidence" className="mh-section" aria-labelledby="evidence-h">
          <SectionHead
            id="evidence-h"
            icon={<TerminalIcon className="h-3 w-3" />}
            tag="THE RECORDS"
            title="Read the actual records"
            lead="Practice trading logs from the desk, including the trades it approved and the ones it refused. Download them and check the numbers yourself."
          />
          <div className="mh-cards3 mh-dl">
            <a className="mh-card mh-card-col" href="/money_boys_paper_trades.csv" download>
              <Tile><LockIcon className="h-5 w-5" /></Tile>
              <h3>Practice trade log</h3>
              <p>Every decision with its time, symbol, outcome and receipt hash. Approvals and vetoes are both included.</p>
              <span className="mh-link">Download CSV</span>
            </a>
            <a className="mh-card mh-card-col" href="/money_boys_89d_trades.csv" download>
              <Tile><ActivityIcon className="h-5 w-5" /></Tile>
              <h3>89-day trade log</h3>
              <p>Entry and exit prices, fees and receipt hashes for each trade, with out-of-sample trades marked.</p>
              <span className="mh-link">Download CSV</span>
            </a>
          </div>
        </section>

        <section id="built" className="mh-section" aria-labelledby="built-h">
          <SectionHead
            id="built-h"
            icon={<TerminalIcon className="h-3 w-3" />}
            tag="UNDER THE HOOD"
            title="How it was built"
            lead="Money Boys is written in plain TypeScript. It reads prices and places practice orders through the Bitget trading API, and uses an AI model from Alibaba Cloud (Qwen) only to read news and suggest ideas."
          />
          <div className="mh-cards3">
            <div className="mh-card mh-card-col">
              <Tile><BrainIcon className="h-5 w-5" /></Tile>
              <h3>AI that only suggests</h3>
              <p>The AI reads headlines and proposes. It holds no keys and can never place an order.</p>
            </div>
            <div className="mh-card mh-card-col">
              <Tile><ShieldIcon className="h-5 w-5" /></Tile>
              <h3>Limits written as code</h3>
              <p>Safety limits are ordinary code with fixed numbers. They behave the same every time.</p>
            </div>
            <div className="mh-card mh-card-col">
              <Tile><LockIcon className="h-5 w-5" /></Tile>
              <h3>Proof, not promises</h3>
              <p>Receipts are sealed with the browser's built-in cryptography, so you can check them yourself.</p>
            </div>
          </div>
          <div className="mh-who">
            <h3>Who it is for</h3>
            <ul>
              <li><b>Arbitrage traders</b> who want off-hours gaps watched all night and all weekend.</li>
              <li><b>Tokenized-stock desks</b> who want an automatic, rule-bound way to act when stock markets are shut.</li>
              <li><b>Teams that need to explain every trade</b> and want a checkable record of why it happened.</li>
            </ul>
          </div>
        </section>

        <section className="mh-cta" aria-labelledby="cta-h">
          <h2 id="cta-h">See the desk decide.</h2>
          <p className="mh-sub">Practice mode only. No real money.</p>
          <a href="#/sandbox" className="mh-pill">Try the sandbox</a>
        </section>
      </main>

      <footer className="mh-foot">
        <span className="mh-brand"><Logo size={18} /> Money Boys</span>
        <span>Built for the Bitget AI Hackathon. Practice trading only. Not investment advice.</span>
      </footer>
    </div>
  );
}
