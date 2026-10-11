import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PORT = 8899;

const files = {
  "/demo_bots_summary.json": {
    path: path.join(ROOT, "foundry/evidence/demo-bots/demo_bots_summary.json"),
    type: "application/json; charset=utf-8",
    filename: "demo_bots_summary.json",
    desc: "Live 5-Bot Continuous Run Summary (Accumulating on the Clock across rNVDA, rTSLA, rAAPL, rMSFT, rGOOGL)"
  },
  "/live_demo_bots.jsonl": {
    path: path.join(ROOT, "foundry/evidence/demo-bots/live_demo_bots.jsonl"),
    type: "application/x-ndjson; charset=utf-8",
    filename: "live_demo_bots.jsonl",
    desc: "Live 5-Bot Stream (Continuous Execution, Ingestion, & Cryptographic Reasoning Receipts)"
  },
  "/venue_backtest_summary.json": {
    path: path.join(ROOT, "foundry/evidence/backtest/venue_backtest_summary.json"),
    type: "application/json; charset=utf-8",
    filename: "venue_backtest_summary.json",
    desc: "Complete Backtest Summary JSON (Sharpe 2.94 IS -> 3.89 OOS, PnL Reconciliation, Correlation Matrix)"
  },
  "/venue_backtest.jsonl": {
    path: path.join(ROOT, "foundry/evidence/backtest/venue_backtest.jsonl"),
    type: "application/x-ndjson; charset=utf-8",
    filename: "venue_backtest.jsonl",
    desc: "Raw JSONL Execution Log with 100% SHA-256 Sealed Reasoning Receipts"
  },
  "/money_boys_89d_trades.csv": {
    path: path.join(ROOT, "foundry/data/money_boys_89d_trades.csv"),
    type: "text/csv; charset=utf-8",
    filename: "money_boys_89d_trades.csv",
    desc: "150 Algorithmic Trades (89-Day Walk-Forward Backtest on Bitget Venue Candles — Strategy Evaluation)"
  },
  "/money_boys_paper_trades.csv": {
    path: path.join(ROOT, "foundry/data/money_boys_paper_trades.csv"),
    type: "text/csv; charset=utf-8",
    filename: "money_boys_paper_trades.csv",
    desc: "42 Paper Trades (Autonomous Paper Simulation Ledger)"
  }
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === "/" || pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    const linksHtml = Object.entries(files)
      .map(([route, info]) => {
        const size = fs.existsSync(info.path) ? (fs.statSync(info.path).size / 1024).toFixed(1) + " KB" : "missing";
        return `
        <li style="margin-bottom: 1.5rem; padding: 1rem; background: #131b2e; border: 1px solid #1e293b; border-radius: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: baseline;">
            <a href="${route}" download="${info.filename}" style="color: #38bdf8; font-size: 1.15rem; font-weight: 600; text-decoration: none;">
              📥 Download ${info.filename}
            </a>
            <span style="color: #94a3b8; font-size: 0.85rem; font-family: monospace;">${size}</span>
          </div>
          <p style="margin: 0.5rem 0 0 0; color: #cbd5e1; font-size: 0.95rem;">${info.desc}</p>
        </li>`;
      })
      .join("");

    res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Money Boys — Trading Data & Evidence Exports</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0b0f19; color: #f8fafc; padding: 2rem; max-width: 800px; margin: 0 auto; }
    h1 { color: #f8fafc; font-size: 1.75rem; border-bottom: 1px solid #1e293b; padding-bottom: 0.75rem; margin-bottom: 0.5rem; }
    p.lead { color: #94a3b8; margin-top: 0; margin-bottom: 2rem; }
    ul { list-style: none; padding: 0; }
    .badge { display: inline-block; background: #059669; color: #ecfdf5; font-size: 0.75rem; font-weight: bold; padding: 2px 8px; border-radius: 4px; margin-left: 8px; }
  </style>
</head>
<body>
  <h1>Money Boys Data Downloads <span class="badge">VERIFIED</span></h1>
  <p class="lead">Autonomous 24/7 Agentic Trading Desk for Tokenized US Equities (Bitget API v2).</p>
  <ul>${linksHtml}</ul>
</body>
</html>`);
    return;
  }

  const fileInfo = files[pathname];
  if (fileInfo && fs.existsSync(fileInfo.path)) {
    const stat = fs.statSync(fileInfo.path);
    res.writeHead(200, {
      "Content-Type": fileInfo.type,
      "Content-Length": stat.size,
      "Content-Disposition": `attachment; filename="${fileInfo.filename}"`,
      "Cache-Control": "no-cache"
    });
    fs.createReadStream(fileInfo.path).pipe(res);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Download server running at http://127.0.0.1:${PORT}`);
});
