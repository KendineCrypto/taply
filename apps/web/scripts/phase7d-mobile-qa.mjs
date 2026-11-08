// Phase 7D mobile QA harness (production build, read-only).
// Same safety model as phase7-screenshot-smoke.mjs: an injected read-only
// Testnet account whose signing always throws; only the app origin and the
// configured RPC host are reachable; every RPC method is recorded.
//
// Usage: node apps/web/scripts/phase7d-mobile-qa.mjs <playwright/index.mjs> <out dir> <env file>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [pwIndex, outDir, envFile] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(pwIndex).href);
const BASE = 'http://127.0.0.1:3207';
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const rpcHost = new URL(env.NEXT_PUBLIC_TAPLY_RPC_URL).host;
const LONG = 'f'.repeat(64); // longest legal account ID (implicit)
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

const browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

async function open({ width, height = 844, account = null, locale = 'en' }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, locale: locale === 'tr' ? 'tr-TR' : 'en-US' });
  await context.addCookies([{ name: 'taply_locale', value: locale, url: BASE }]);
  if (account !== null) await context.addInitScript(injectWallet, account);
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

async function audit(page, name, { screenshot = true } = {}) {
  await page.waitForTimeout(500);
  const report = await page.evaluate(() => {
    const visible = (el) => el.offsetParent !== null || el.getClientRects().length > 0;
    const controls = [...document.querySelectorAll('main a, main button, main input, main textarea, main select, nav a, nav button, header a, header button')].filter(visible);
    const unnamed = controls
      .filter((el) => {
        const label = el.getAttribute('aria-label') || el.textContent?.trim() || el.getAttribute('title') || (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent);
        return !label;
      })
      .map((el) => el.outerHTML.slice(0, 80));
    const small = controls
      .filter((el) => !(el instanceof HTMLInputElement && el.type === 'checkbox'))
      .map((el) => ({ text: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 30), h: Math.floor(el.getBoundingClientRect().height) }))
      .filter((x) => x.h > 0 && x.h < 44);
    const wide = [...document.querySelectorAll('main *')]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .map((el) => `${el.tagName}.${String(el.className).slice(0, 40)}`)
      .slice(0, 5);
    return { overflowPx: document.documentElement.scrollWidth - window.innerWidth, unnamed, small, wide };
  });
  if (screenshot) await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
  results.push({ name, ...report });
}

// 1. Wallet-disconnected merchant screens, EN + TR, all widths.
for (const width of [360, 390, 430, 1280]) {
  const { context, page } = await open({ width, height: width === 1280 ? 900 : 844 });
  for (const path of ['/merchant', '/merchant/register', '/merchant/setup']) {
    await page.goto(`${BASE}${path}`);
    await page.getByText('Connect the NEAR Testnet wallet that should receive your sales.').first().waitFor({ timeout: 15000 });
    await audit(page, `disconnected${path.replaceAll('/', '-')}-${width}`, { screenshot: width === 360 });
  }
  await context.close();
}

// 2. Longest legal account ID on every merchant + checkout screen.
for (const width of [360, 430]) {
  const { context, page } = await open({ width, account: LONG });
  await page.goto(`${BASE}/merchant`);
  await page.getByText('Receiving account').first().waitFor({ timeout: 15000 });
  await audit(page, `long-account-hub-${width}`);
  await page.goto(`${BASE}/merchant/setup`);
  await page.getByRole('img', { name: /Merchant discovery QR/ }).first().waitFor({ timeout: 15000 });
  await audit(page, `long-account-discovery-${width}`);
  await page.goto(`${BASE}/merchant/register`);
  await page.getByLabel('Amount (NEAR)').first().waitFor({ timeout: 15000 });
  await audit(page, `long-account-pos-${width}`);
  await page.goto(`${BASE}/checkout/${LONG}`);
  await page.getByText('Waiting for a sale').first().waitFor({ timeout: 15000 });
  await audit(page, `long-account-checkout-${width}`);
  await context.close();
}

// 3. Large amount with 24 decimals on the POS form and review (read-only quote).
{
  const { context, page } = await open({ width: 360, account: 'taply-merchant.testnet' });
  await page.goto(`${BASE}/merchant/register`);
  const amount = page.getByLabel('Amount (NEAR)').first();
  await amount.waitFor({ timeout: 15000 });
  await amount.fill('123456789.123456789123456789123456');
  await audit(page, 'large-amount-form-360');
  await amount.fill('0.000000000000000000000001');
  await page.getByLabel('Sale reference (optional)').fill('Ödeme #42 — çok uzun bir referans metni burada ve satırı aşıyor');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Continue' && !b.disabled), null, { timeout: 20000 });
  await page.getByRole('button', { name: 'Continue' }).click();
  try {
    await page.getByText('Payment request').first().waitFor({ timeout: 20000 });
    await audit(page, 'tiny-amount-review-360');
  } catch (e) {
    results.push({ name: 'tiny-amount-review-360', error: String(e).slice(0, 160) });
  }
  await context.close();
}

// 4. Scanner dialog from checkout: focus moves in, Escape closes, focus returns, camera stops.
{
  const { context, page } = await open({ width: 390 });
  await context.grantPermissions(['camera'], { origin: BASE });
  await page.goto(`${BASE}/checkout/cafe.testnet`);
  const scanBtn = page.getByRole('button', { name: 'Scan sale QR' });
  await scanBtn.waitFor({ timeout: 15000 });
  await scanBtn.focus();
  await page.keyboard.press('Enter');
  await page.locator('dialog.taply-scanner[open]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(1200);
  const inside = await page.evaluate(() => document.querySelector('dialog.taply-scanner')?.contains(document.activeElement) ?? false);
  const liveTracks = await page.evaluate(() => {
    const v = document.querySelector('dialog.taply-scanner video');
    return v?.srcObject ? v.srcObject.getTracks().filter((t) => t.readyState === 'live').length : 0;
  });
  await page.screenshot({ path: `${outDir}/scanner-from-checkout-390.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const closed = (await page.locator('dialog.taply-scanner[open]').count()) === 0;
  const focusBack = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
  results.push({ name: 'scanner-dialog', focusInside: inside, liveTracksWhileOpen: liveTracks, closedByEscape: closed, focusReturnedTo: focusBack });
  await context.close();
}

// 5. Turkish long copy at the narrowest width.
{
  const { context, page } = await open({ width: 360, account: 'taply-merchant.testnet', locale: 'tr' });
  for (const path of ['/merchant', '/merchant/register', '/merchant/setup', '/checkout/cafe.testnet', '/demo/handshake']) {
    await page.goto(`${BASE}${path}`);
    await page.waitForTimeout(2500);
    await audit(page, `tr${path.replaceAll('/', '-')}-360`, { screenshot: false });
  }
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
writeFileSync(`${outDir}/phase7d-qa.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ failures: summary.failures, scanner: results.find((r) => r.name === 'scanner-dialog'), rpc: summary.rpcMethods, broadcast: summary.broadcastAttempted, pageErrors }, null, 2));
