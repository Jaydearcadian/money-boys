import { chromium } from "@playwright/test";
const ROUTES = ["#/", "#/track1", "#/track2", "#/track3", "#/sandbox", "#/repro", "#/desk", "#/evidence", "#/copilot", "#/v1"];
const b = await chromium.launch();
const findings = [];
for (const vp of [{w:1440,h:900,tag:"desktop"},{w:390,h:844,tag:"mobile"}]) {
  const p = await b.newPage({ viewport: { width: vp.w, height: vp.h } });
  const errs = [], failed = [];
  p.on("console", m => { if (m.type() === "error") errs.push(m.text().slice(0,120)); });
  p.on("requestfailed", r => failed.push(r.url().replace(/^https?:\/\//,"").slice(0,70)));
  for (const r of ROUTES) {
    errs.length = 0; failed.length = 0;
    await p.goto("http://127.0.0.1:4174/" + r, { waitUntil: "networkidle" }).catch(()=>{});
    await p.waitForTimeout(700);
    const res = await p.evaluate(() => {
      const out = {};
      out.title = document.title;
      out.textLen = (document.body.innerText || "").trim().length;
      out.h1 = document.querySelector("h1")?.textContent?.trim().slice(0,60) ?? null;
      out.hasNav = !!document.querySelector("header nav, nav");
      out.navLabels = [...document.querySelectorAll("header nav a")].map(a=>a.textContent.trim()).slice(0,9);
      out.hOverflow = document.documentElement.scrollWidth > window.innerWidth + 2;
      out.scrollW = document.documentElement.scrollWidth;
      out.winW = window.innerWidth;
      const t = [...document.querySelectorAll("button,a[href]")].filter(e=>/403|Forbidden/i.test(e.textContent||""));
      out.raw403 = t.length;
      return out;
    }).catch(e => ({ error: String(e).slice(0,80) }));
    findings.push({ route:r, vp:vp.tag, ...res, consoleErrs: errs.slice(0,2), failedReq: failed.slice(0,2) });
  }
  await p.close();
}
await b.close();
for (const f of findings) {
  const bad = [];
  if (f.error) bad.push("LOAD_FAIL");
  if (f.textLen !== undefined && f.textLen < 400) bad.push("THIN("+f.textLen+")");
  if (f.hOverflow) bad.push(`H-OVERFLOW ${f.scrollW}>${f.winW}`);
  if (f.raw403) bad.push("RAW_403 x"+f.raw403);
  if (f.consoleErrs?.length) bad.push("CONSOLE:"+f.consoleErrs[0].slice(0,50));
  if (f.failedReq?.length) bad.push("REQFAIL:"+f.failedReq[0]);
  if (f.vp === "desktop" && f.route === "#/" ) console.log("NAV LABELS:", JSON.stringify(f.navLabels));
  console.log(`${f.vp.padEnd(8)} ${f.route.padEnd(12)} ${String(f.textLen).padStart(6)}ch h1=${(f.h1||"-").slice(0,34).padEnd(34)} ${bad.length?"⚠ "+bad.join(" | "):"ok"}`);
}
