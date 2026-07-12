// Headless smoke harness for the BeepBite React app.
// Logs in by injecting the signin response into localStorage, then visits each
// route, capturing console errors, page errors, failed network calls, and a
// screenshot. Writes a JSON report.
//
//   node scripts/smoke.mjs
//
// Env:
//   BASE   front-end origin (default http://localhost:5174)
//   AUTH   path to signin-response JSON (default /tmp/bb-auth.json)
//   OUT    output dir (default scratchpad)
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5174';
const AUTH = process.env.AUTH || '/tmp/bb-auth.json';
const OUT = process.env.OUT || '/tmp/claude-1000/-home-exo-Documents-beepbite-mono/f7a6e698-a388-4056-8b6f-3e65d134a7c3/scratchpad/smoke';
const CHROME = '/usr/bin/google-chrome-stable';

const auth = JSON.parse(fs.readFileSync(AUTH, 'utf8'));

// Curated route list: [label, path, {full?:bool}]
const ROUTES = [
  ['landing', '/'],
  ['home', '/home'],
  ['reports', '/reports'],
  ['reviews', '/reviews'],
  ['menu', '/menu'],
  ['categories', '/categories'],
  ['menu-courses', '/menu/courses'],
  ['menu-schedules', '/menu/schedules'],
  ['ai-menu-creator', '/menu/ai-menu-creator'],
  ['members', '/members'],
  ['staff', '/staff'],
  ['staff-manage', '/staff/manage'],
  ['timeclock', '/timeclock'],
  ['floor', '/floor'],
  ['floor-edit', '/floor/edit'],
  ['cash', '/cash'],
  ['gift-cards', '/gift-cards'],
  ['house-accounts', '/house-accounts'],
  ['reservations', '/reservations'],
  ['waitlist', '/waitlist'],
  ['invoices', '/invoices'],
  ['inventory-suppliers', '/inventory/suppliers'],
  ['inventory-pos', '/inventory/purchase-orders'],
  ['inventory-grns', '/inventory/grns'],
  ['inventory-invoice-match', '/inventory/invoice-match'],
  ['assistant', '/assistant'],
  ['manager', '/manager'],
  ['manager-audit', '/manager/audit'],
  ['kds-expo', '/kds/expo'],
  ['pos-workspace', '/pos/workspace'],
  ['work', '/work'],
  ['settings-org', '/settings/organization'],
  ['settings-payouts', '/settings/payouts'],
  ['settings-promotions', '/settings/promotions'],
  ['settings-billing', '/settings/billing'],
  ['settings-billing-wallet', '/settings/billing/wallet'],
  ['settings-api-keys', '/settings/api-keys'],
  ['settings-kitchen', '/settings/kitchen'],
  ['settings-domains', '/settings/domains'],
  ['settings-hardware', '/settings/hardware'],
  ['settings-delivery-zones', '/settings/delivery-zones'],
  ['settings-loyalty', '/settings/loyalty'],
  ['account', '/account'],
  ['admin', '/admin'],
  ['discover', '/discover'],
];

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

// Inject auth + consent before any app code runs.
await context.addInitScript((authData) => {
  localStorage.setItem('bb.auth', JSON.stringify(authData));
  localStorage.setItem('bb.cookie-consent', JSON.stringify({ necessary: true, analytics: true, marketing: false }));
}, auth);

const report = [];

for (const [label, path] of ROUTES) {
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const netErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
  page.on('response', (r) => {
    const s = r.status();
    if (s >= 400 && new URL(r.url()).port === '8080') netErrors.push(`${s} ${r.request().method()} ${new URL(r.url()).pathname}`);
  });

  let nav = 'ok';
  try {
    await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 20000 });
  } catch (e) {
    nav = 'timeout/' + String(e.message).slice(0, 80);
  }
  await page.waitForTimeout(1200);

  // Detect error-boundary / blank pages.
  let bodyText = '';
  try { bodyText = (await page.locator('body').innerText()).slice(0, 4000); } catch {}
  const crashed = /Something went wrong|Unexpected Application Error|Cannot read prop|is not a function|ChunkLoadError/i.test(bodyText);
  const blank = bodyText.trim().length < 20;

  const shot = `${OUT}/${label}.png`;
  try { await page.screenshot({ path: shot, fullPage: false }); } catch {}

  report.push({
    label, path, nav,
    crashed, blank,
    bodyLen: bodyText.trim().length,
    consoleErrors: [...new Set(consoleErrors)].slice(0, 8),
    pageErrors: [...new Set(pageErrors)].slice(0, 5),
    netErrors: [...new Set(netErrors)].slice(0, 12),
  });
  const flag = (pageErrors.length || crashed) ? '❌' : (netErrors.length || consoleErrors.length || blank) ? '⚠️ ' : '✅';
  console.log(`${flag} ${label.padEnd(26)} nav=${nav.padEnd(8)} body=${String(bodyText.trim().length).padStart(5)} cerr=${consoleErrors.length} perr=${pageErrors.length} net=${netErrors.length}`);
  await page.close();
}

fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
await browser.close();

const broken = report.filter((r) => r.pageErrors.length || r.crashed);
const warn = report.filter((r) => !r.pageErrors.length && !r.crashed && (r.netErrors.length || r.blank || r.consoleErrors.length));
console.log(`\n=== SUMMARY: ${report.length} routes | ${broken.length} broken | ${warn.length} warnings ===`);
console.log('Report:', `${OUT}/report.json`);
