// Final-build screenshots for the judge demo and submission. Offline: every
// request outside the local production server is blocked, so no wallet, RPC or
// chain read happens. DEMO screens are synthetic; fixture screens are labelled.
// Usage (repo root, production server on :3219):
//   node apps/web/scripts/phase7i-fixtures.mjs        # optional synthetic states
//   node apps/web/scripts/final-shots.mjs <path-to-playwright/index.mjs>
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const base = 'http://127.0.0.1:3219';
const out = 'apps/web/docs/screenshots/final';
mkdirSync(out, { recursive: true });

const routes = {
  home: '/', wallet: '/wallet', activity: '/activity', merchant: '/merchant',
  sale: '/merchant/register', checkout: '/checkout/shop.testnet', request: '/request/new',
  // No 'share' step: the demo share link and its QR use the page origin, which
  // is a loopback address in offline capture and must not appear in published media.
  ...Object.fromEntries(['receive', 'create', 'review', 'progress', 'receipt'].map(s => [`demo-${s}`, `/demo?step=${s}`])),
};
const shots = [
  { locale: 'en', width: 390 },
  { locale: 'tr', width: 390 },
  { locale: 'en', width: 1280, only: ['home', 'checkout', 'demo-receipt'] },
];
const browser = await chromium.launch({ headless: true });
const errors = [], results = [];
for (const { locale, width, only } of shots) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
  await context.addCookies([{ name: 'taply_locale', value: locale, url: base }]);
  await context.route('**/*', r => (new URL(r.request().url()).origin === base ? r.continue() : r.abort()));
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(`${locale}/${width}: ${e.message}`));
  for (const [name, route] of Object.entries(routes)) {
    if (only && !only.includes(name)) continue;
    await page.goto(base + route);
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    results.push({ locale, width, name, overflow });
    // Grow the viewport to the page height so the fixed bottom nav sits at the
    // bottom instead of being stamped over content mid-page by fullPage capture.
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width, height: Math.max(844, height) });
    await page.waitForTimeout(100);
    await page.screenshot({ path: `${out}/${locale}-${name}-${width}.png` });
    await page.setViewportSize({ width, height: 844 });
  }
  await context.close();
}

// Synthetic payment-status states rendered from real components (see phase7i-fixtures.tsx).
let fixtureScreens = 0;
const fixturePath = 'apps/web/.next/phase7i-fixtures.json';
if (existsSync(fixturePath)) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await page.goto(`${base}/demo`);
  const styles = await page.locator('link[rel="stylesheet"]').evaluateAll(els => els.map(el => el.href));
  for (const fixture of JSON.parse(readFileSync(fixturePath, 'utf8')).filter(f => f.locale === 'en')) {
    await page.setContent(`<html lang="en"><head>${styles.map(h => `<link rel="stylesheet" href="${h}">`).join('')}</head><body><main style="max-width:480px;margin:auto;padding:16px"><p style="padding:12px;color:#C7FC75">DEMO · Synthetic UI fixture · No chain evidence</p>${fixture.html}</main></body></html>`);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/en-fixture-${fixture.stage}-390.png`, fullPage: true });
    fixtureScreens++;
  }
  await page.close();
}
await browser.close();
writeFileSync(`${out}/qa.json`, JSON.stringify({ mode: 'offline production UI; DEMO and fixtures are synthetic; no signing or chain proof', results, fixtureScreens, errors }, null, 2));
console.log(JSON.stringify({ screens: results.length, fixtureScreens, overflow: results.filter(r => r.overflow > 0), errors }, null, 2));
