import { chromium } from '@playwright/test';
import fs from 'fs';
const out = '/home/ubuntu/money-boys/packages/desk/dogfood-output';
fs.mkdirSync(out+'/screenshots', {recursive:true});
const browser = await chromium.launch();
const issues = [];
const log = (sev, title, detail) => issues.push({sev, title, detail});

async function check(page, name) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  if (over) log('high', `overflow ${name}`, await page.evaluate(() => ({w:innerWidth, sw:document.documentElement.scrollWidth})));
  const errs = await page.evaluate(() => window.__errs || []);
  if (errs.length) log('high', `console ${name}`, errs);
  const bad = await page.evaluate(() => {
    const t = document.body.innerText;
    const m = t.match(/.{0,30}\b(undefined|NaN)\b.{0,30}/g);
    return m || [];
  });
  if (bad.length) log('high', `bad tokens ${name}`, bad);
}

const page = await browser.newPage();
await page.addInitScript(() => {
  window.__errs = [];
  window.addEventListener('error', e => window.__errs.push(String(e.message||e.error)));
  window.addEventListener('unhandledrejection', e => window.__errs.push('rej:'+String(e.reason)));
});

// Landing desktop
await page.setViewportSize({width:1440, height:900});
await page.goto('http://127.0.0.1:3000/index.html#/', {waitUntil:'networkidle'});
await page.screenshot({path: out+'/screenshots/landing-desktop.png', fullPage:true});
await check(page, 'landing-desktop');

// Landing mobile
await page.setViewportSize({width:390, height:844});
await page.goto('http://127.0.0.1:3000/index.html#/', {waitUntil:'networkidle'});
await page.screenshot({path: out+'/screenshots/landing-mobile.png', fullPage:true});
await check(page, 'landing-mobile');

// CTA to sandbox
await page.setViewportSize({width:1440, height:900});
await page.goto('http://127.0.0.1:3000/index.html#/', {waitUntil:'networkidle'});
await page.locator('a.mh-pill', {hasText:'Try the sandbox'}).first().click();
await page.waitForURL(/#\/sandbox/);
await page.waitForSelector('.db-shell');
await page.screenshot({path: out+'/screenshots/sandbox.png', fullPage:true});
await check(page, 'sandbox');

// Run second scenario
const before = await page.getByTestId('seal-hash').textContent();
await page.getByRole('button', {name:/Run /}).nth(1).click();
await page.waitForTimeout(500);
const after = await page.getByTestId('seal-hash').textContent();
if (!/^[0-9a-f]{64}$/.test(after||'')) log('critical', 'seal not hex', after);
if (after === before) log('medium', 'seal unchanged after second run', {before, after});

// Tamper
await page.getByRole('button', {name:'Try tampering'}).click();
const st = await page.getByTestId('seal-status').textContent();
if (!/MISMATCH/.test(st||'')) log('critical', 'tamper failed', st);

// Custom slider run
await page.getByRole('button', {name:'Run custom scenario'}).click();
await page.waitForTimeout(400);
const customSeal = await page.getByTestId('seal-hash').textContent();
if (!/^[0-9a-f]{64}$/.test(customSeal||'')) log('high', 'custom seal bad', customSeal);

// Halt blocks runs (buttons disabled + banner)
await page.getByRole('button', {name:'Halt sandbox'}).click();
await page.waitForTimeout(200);
const disabled = await page.getByRole('button', {name:/Run A clear opportunity/}).isDisabled();
const banner = await page.getByTestId('halt-banner').count();
const bodyHalt = await page.locator('main').innerText();
if (!disabled) log('high', 'halt did not disable run buttons', null);
if (!banner && !/Halted|halted/i.test(bodyHalt)) log('high', 'halt banner missing', bodyHalt.slice(0,200));
await page.getByRole('button', {name:'Resume sandbox'}).click();
await page.waitForTimeout(200);
if (await page.getByRole('button', {name:/Run A clear opportunity/}).isDisabled()) log('high', 'resume did not re-enable run', null);

// Cockpit drawer
await page.goto('http://127.0.0.1:3000/index.html#/app', {waitUntil:'networkidle'});
await page.waitForSelector('[data-testid=decision-feed]');
await page.screenshot({path: out+'/screenshots/cockpit.png', fullPage:true});
await check(page, 'cockpit');
// daemon panel
const daemon = await page.locator('text=24/7 Autonomous Desk Daemon').count();
if (!daemon) log('medium', 'daemon panel missing on cockpit', null);
await page.getByTestId('decision-feed').locator('button').first().click();
await page.waitForSelector('[data-testid=drawer]');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
if (await page.getByTestId('drawer').count()) log('high', 'drawer did not close on Escape', null);

// Strategy
await page.goto('http://127.0.0.1:3000/index.html#/strategy', {waitUntil:'networkidle'});
await page.waitForSelector('[data-testid=equity-curve]');
await page.screenshot({path: out+'/screenshots/strategy.png', fullPage:true});
await check(page, 'strategy');

// Copilot blast
await page.goto('http://127.0.0.1:3000/index.html#/copilot', {waitUntil:'networkidle'});
await page.getByRole('button', {name:'+$7k rNVDA'}).click();
const hard = await page.getByTestId('blast-verdict').textContent();
if (hard !== 'HARD_VETO') log('critical', 'oversized not veto', hard);
await page.getByRole('button', {name:'+$2k rNVDA'}).click();
const ok = await page.getByTestId('blast-verdict').textContent();
if (!/PERMITTED|DE_RISKING/.test(ok||'')) log('high', 'moderate not permitted', ok);
await page.screenshot({path: out+'/screenshots/copilot.png', fullPage:true});
await check(page, 'copilot');

// Audit
await page.goto('http://127.0.0.1:3000/index.html#/audit', {waitUntil:'networkidle'});
await page.waitForSelector('[data-testid=lifecycle-proof]');
const life = await page.getByTestId('lifecycle-proof').innerText();
if (!life.includes('1491906882204499969')) log('critical', 'lifecycle order id missing', life.slice(0,100));
await page.screenshot({path: out+'/screenshots/audit.png', fullPage:true});
await check(page, 'audit');

// Responsive matrix
for (const w of [320,390,768,1024,1440,1920]) {
  await page.setViewportSize({width:w, height:900});
  for (const hash of ['#/','#/app','#/strategy','#/sandbox']) {
    await page.goto(`http://127.0.0.1:3000/index.html${hash}`, {waitUntil:'domcontentloaded'});
    await page.waitForTimeout(250);
    await check(page, `${hash}@${w}`);
  }
}

// Color parity: landing vs desk
await page.setViewportSize({width:1440,height:900});
await page.goto('http://127.0.0.1:3000/index.html#/', {waitUntil:'networkidle'});
const land = await page.evaluate(() => {
  const mh = document.querySelector('.mh');
  const card = document.querySelector('.mh-card');
  return {
    bg: getComputedStyle(mh).backgroundColor,
    card: getComputedStyle(card).backgroundImage || getComputedStyle(card).backgroundColor,
    pill: getComputedStyle(document.querySelector('.mh-pill')).backgroundColor,
  };
});
await page.goto('http://127.0.0.1:3000/index.html#/app', {waitUntil:'networkidle'});
const desk = await page.evaluate(() => {
  const sh = document.querySelector('.db-shell');
  const card = document.querySelector('.db-card');
  const nav = document.querySelector('.db-nav button.on');
  return {
    bg: getComputedStyle(sh).backgroundColor,
    card: getComputedStyle(card).backgroundImage || getComputedStyle(card).backgroundColor,
    navOn: nav ? getComputedStyle(nav).backgroundColor : null,
  };
});
if (land.bg !== desk.bg) log('medium', 'bg mismatch landing vs desk', {land:land.bg, desk:desk.bg});
if (!String(desk.card).includes('linear-gradient') && !String(desk.card).includes('rgb(18')) {
  log('medium', 'desk card not moneliq gradient', desk.card);
}

// accent var resolution on daemon panel
const accent = await page.evaluate(() => {
  const el = document.querySelector('.db-shell');
  const probe = document.createElement('div');
  probe.style.color = 'var(--accent)';
  el.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c;
});
if (accent === 'rgb(0, 0, 0)' || accent === '' || accent === 'rgba(0, 0, 0, 0)') {
  log('high', 'CSS --accent unresolved on desk', accent);
}

fs.writeFileSync(out+'/qa-issues.json', JSON.stringify({issues, land, desk, accent}, null, 2));
console.log(JSON.stringify({count:issues.length, issues, land, desk, accent}, null, 2));
await browser.close();
