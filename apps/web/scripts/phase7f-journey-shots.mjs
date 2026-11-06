// Phase 7F shared payment journey: screenshots + mobile QA (production build, read-only).
// Same safety model as phase7d-mobile-qa.mjs: an injected read-only Testnet account
// whose signing always throws; only the app origin and the configured RPC host are
// reachable; every RPC method is recorded.
//
// Real data: the pilot's FINAL_PAID request 9b9a…4502 on taply-pay-pilot-1.testnet
// (docs/EVIDENCE.md). Nothing is created, signed or sent. OPEN-state screens cannot
// be captured without creating a request, so they are covered by unit tests only.
//
// Usage: node apps/web/scripts/phase7f-journey-shots.mjs <playwright/index.mjs> <out dir> <env file>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [pwIndex, outDir, envFile] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(pwIndex).href);
const BASE = 'http://127.0.0.1:3207';
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const rpcHost = new URL(env.NEXT_PUBLIC_TAPLY_RPC_URL).host;
const ID = '9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502';
const FUNDING = 'CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su';
const MERCHANT = 'taplytest.testnet';
const CUSTOMER = 'taply-pilot-funder-1101.testnet';
mkdirSync(outDir, { recursive: true });

const rpcMethods = new Set();
const pageErrors = [];
const results = [];

const injectWallet = (account) => {
  localStorage.setItem('selected-wallet', 'taply-qa-readonly');
  const never = async () => {
    throw new Error('QA harness never signs');
  };
  const wallet = {
    manifest: { id: 'taply-qa-readonly', name: 'QA harness (read-only)', features: { testnet: true, signInWithoutAddKey: true, signAndSendTransaction: true } },
    signIn: async () => [{ accountId: account, publicKey: '' }],
    signOut: async () => undefined,
    getAccounts: async () => [{ accountId: account, publicKey: '' }],
    signAndSendTransaction: never,
    signAndSendTransactions: never,
    signMessage: never,
  };
  window.addEventListener('near-selector-ready', () => window.dispatchEvent(new CustomEvent('near-wallet-injected', { detail: wallet })));
};

const browser = await chromium.launch({ headless: true });

async function open({ width, height = 844, account = null, locale = 'en', reducedMotion = 'no-preference', init = null }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, locale: locale === 'tr' ? 'tr-TR' : 'en-US', reducedMotion });
  await context.addCookies([{ name: 'taply_locale', value: locale, url: BASE }]);
  if (account !== null) await context.addInitScript(injectWallet, account);
  if (init !== null) await context.addInitScript(init.fn, init.arg);
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === BASE) return route.continue();
    if (url.host === rpcHost) {
      try {
        const body = JSON.parse(route.request().postData() ?? '{}');
        rpcMethods.add(body.method === 'query' ? `query:${body.params?.request_type}:${body.params?.method_name ?? ''}` : body.method);
      } catch {
        rpcMethods.add('unparsed');
      }
      return route.continue();
    }
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${page.url()}: ${e.message}`));
  return { context, page };
}

async function audit(page, name, { screenshot = true, full = true } = {}) {
  await page.waitForTimeout(1600); // let entry animations settle
  const report = await page.evaluate(() => {
    const visible = (el) => el.offsetParent !== null || el.getClientRects().length > 0;
    const controls = [...document.querySelectorAll('main a, main button, main input, main summary')].filter(visible);
    const unnamed = controls
      .filter((el) => !(el.getAttribute('aria-label') || el.textContent?.trim() || el.getAttribute('title') || (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent)))
      .map((el) => el.outerHTML.slice(0, 80));
    const small = controls
      .filter((el) => !(el instanceof HTMLInputElement && el.type === 'checkbox'))
      .map((el) => ({ text: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 30), h: Math.floor(el.getBoundingClientRect().height) }))
      .filter((x) => x.h > 0 && x.h < 44);
    const wide = [...document.querySelectorAll('main *')]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .map((el) => `${el.tagName}.${String(el.className).slice(0, 40)}`)
      .slice(0, 5);
    const hero = document.querySelector('.journey-hero');
    return {
      overflowPx: document.documentElement.scrollWidth - window.innerWidth,
      unnamed,
      small,
      wide,
      heroTone: hero?.getAttribute('data-tone') ?? null,
      heroTitle: hero?.querySelector('h2')?.textContent ?? null,
    };
  });
  if (screenshot) await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: full });
  results.push({ name, ...report });
  return report;
}

const posHint = { fn: (id) => localStorage.setItem('taply.posSales.v1', JSON.stringify([id])), arg: ID };
const checkoutHint = {
  fn: (account) => sessionStorage.setItem('taply.checkout.v1', JSON.stringify({ accountId: account, at: Date.now() })),
  arg: MERCHANT,
};

// 1. Merchant phone (receiver) and customer phone (payer) on the same paid request.
for (const width of [360, 390, 430]) {
  {
    const { context, page } = await open({ width, account: MERCHANT, init: posHint });
    await page.goto(`${BASE}/pay/${ID}`);
    await page.locator('.journey-hero').first().waitFor({ timeout: 20000 });
    await audit(page, `merchant-paid-${width}`, { screenshot: width !== 430 });
    await context.close();
  }
  {
    const { context, page } = await open({ width, account: CUSTOMER, init: checkoutHint });
    await page.goto(`${BASE}/pay/${ID}`);
    await page.locator('.journey-hero').first().waitFor({ timeout: 20000 });
    await audit(page, `customer-paid-${width}`, { screenshot: width !== 430 });
    await context.close();
  }
}

// 2. Independent verification on the receipt (real chain receipts, read-only).
for (const width of [360, 390]) {
  const { context, page } = await open({ width, account: CUSTOMER });
  await page.goto(`${BASE}/receipt/${ID}?ftx=${FUNDING}`);
  try {
    await page.getByTestId('verified-evidence').waitFor({ timeout: 30000 });
    const burst = await page.evaluate(() => document.querySelectorAll('.celebrate-burst').length);
    await page.screenshot({ path: `${outDir}/receipt-verified-burst-${width}.png` });
    await audit(page, `receipt-verified-${width}`);
    results.push({ name: `receipt-celebration-${width}`, burstRings: burst });
  } catch (e) {
    results.push({ name: `receipt-verified-${width}`, error: String(e).slice(0, 200) });
  }
  await context.close();
}

// 3. Turkish, narrowest width.
{
  const { context, page } = await open({ width: 360, account: MERCHANT, locale: 'tr', init: posHint });
  await page.goto(`${BASE}/pay/${ID}`);
  await page.locator('.journey-hero').first().waitFor({ timeout: 20000 });
  await audit(page, 'tr-merchant-paid-360');
  await context.close();
}

// 4. DEMO Handshake walkthrough (synthetic, no network): coordinated status + timeline.
{
  const { context, page } = await open({ width: 390 });
  await page.goto(`${BASE}/demo/handshake`);
  const next = page.getByRole('button', { name: /Next/ });
  await next.waitFor({ timeout: 15000 });
  await next.click();
  await audit(page, 'demo-joined-390');
  await next.click();
  await next.click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Confirm review' }).click();
  await next.click();
  await audit(page, 'demo-wallet-390');
  await context.close();
}

// 5. Reduced motion: the session card and the burst stand still.
{
  const { context, page } = await open({ width: 390, account: MERCHANT, reducedMotion: 'reduce', init: posHint });
  await page.goto(`${BASE}/pay/${ID}`);
  await page.locator('.journey-hero').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  const motion = await page.evaluate(() => ({
    hero: getComputedStyle(document.querySelector('.journey-hero')).animationName,
    connect: getComputedStyle(document.querySelector('.journey-connect') ?? document.body).animationName,
  }));
  results.push({ name: 'reduced-motion', ...motion });
  await context.close();
}

await browser.close();
const summary = {
  results,
  failures: results.filter((r) => r.error || r.overflowPx > 0 || (r.unnamed && r.unnamed.length) || (r.small && r.small.length)),
  rpcMethods: [...rpcMethods],
  broadcastAttempted: [...rpcMethods].some((m) => /broadcast|send_tx/.test(m)),
  pageErrors,
};
writeFileSync(`${outDir}/phase7f-qa.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ failures: summary.failures, rpc: summary.rpcMethods, broadcast: summary.broadcastAttempted, pageErrors, motion: results.find((r) => r.name === 'reduced-motion'), heroes: results.filter((r) => r.heroTitle).map((r) => `${r.name}: ${r.heroTitle} [${r.heroTone}]`), celebration: results.filter((r) => r.name.startsWith('receipt-celebration')) }, null, 2));
