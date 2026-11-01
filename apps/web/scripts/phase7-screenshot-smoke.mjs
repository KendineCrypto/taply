// Phase 7 screenshot + smoke harness. Lives OUTSIDE the repo.
// - Injects a read-only fake NEAR Testnet account through near-connect's
//   injected-wallet event. Its signAndSendTransaction always throws: nothing
//   can be signed or sent.
// - Allows only the app origin and the configured RPC host; every other
//   request is aborted. Records every RPC method to prove no broadcast.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [pwIndex, outDir, envFile] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(pwIndex).href);
const BASE = 'http://127.0.0.1:3207';
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const rpcHost = new URL(env.NEXT_PUBLIC_TAPLY_RPC_URL).host;
const ACCOUNT = 'taply-merchant.testnet';
mkdirSync(outDir, { recursive: true });

const rpcMethods = [];
const blocked = [];
const pageErrors = [];
const results = [];

const injectWallet = (account) => {
  localStorage.setItem('selected-wallet', 'taply-screenshot-readonly');
  const wallet = {
    manifest: {
      id: 'taply-screenshot-readonly',
      name: 'Screenshot harness (read-only)',
      icon: '',
      website: '',
      description: '',
      version: '1.0.0',
      type: 'injected',
      features: { testnet: true, signInWithoutAddKey: true, signAndSendTransaction: true },
      permissions: {},
    },
    signIn: async () => [{ accountId: account, publicKey: '' }],
    signOut: async () => undefined,
    getAccounts: async () => [{ accountId: account, publicKey: '' }],
    signAndSendTransaction: async () => {
      throw new Error('screenshot harness never signs');
    },
    signAndSendTransactions: async () => {
      throw new Error('screenshot harness never signs');
    },
    signMessage: async () => {
      throw new Error('screenshot harness never signs');
    },
  };
  const announce = () => window.dispatchEvent(new CustomEvent('near-wallet-injected', { detail: wallet }));
  window.addEventListener('near-selector-ready', announce);
};

const browser = await chromium.launch({ headless: true });

async function newPage({ width, height = 844, locale = 'en', wallet = true, reduced = false }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
    locale: locale === 'tr' ? 'tr-TR' : 'en-US',
  });
  await context.addCookies([{ name: 'taply_locale', value: locale, url: BASE }]);
  if (wallet) await context.addInitScript(injectWallet, ACCOUNT);
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === BASE) return route.continue();
    if (url.host === rpcHost) {
      if (route.request().method() === 'POST') {
        try {
          const body = JSON.parse(route.request().postData() ?? '{}');
          rpcMethods.push(body.method === 'query' ? `query:${body.params?.request_type}:${body.params?.method_name ?? ''}` : body.method);
        } catch {
          rpcMethods.push('unparsed');
        }
      }
      return route.continue();
    }
    blocked.push(url.host);
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${page.url()}: ${e.message}`));
  return { context, page };
}

async function shot(page, name) {
  await page.waitForTimeout(450);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
  results.push({ name, overflowPx: overflow });
}

const widths = [360, 390, 430];

// Connected merchant screens at every mobile width + desktop.
for (const width of [...widths, 1280]) {
  const { context, page } = await newPage({ width, height: width === 1280 ? 900 : 844 });
  await page.goto(`${BASE}/merchant`);
  await page.getByText('Receiving account').first().waitFor({ timeout: 15000 });
  await shot(page, `merchant-hub-${width}`);
  await page.goto(`${BASE}/merchant/setup`);
  await page.getByRole('img', { name: /Merchant discovery QR/ }).first().waitFor({ timeout: 15000 });
  await shot(page, `discovery-qr-${width}`);
  await page.goto(`${BASE}/merchant/register`);
  await page.getByLabel('Amount (NEAR)').first().waitFor({ timeout: 15000 });
  await page.getByLabel('Amount (NEAR)').fill('2.5');
  await page.getByLabel('Sale reference (optional)').fill('Order 42');
  await shot(page, `pos-amount-${width}`);
  await page.goto(`${BASE}/checkout/${ACCOUNT}`);
  await page.getByText('Waiting for a sale').first().waitFor({ timeout: 15000 });
  await shot(page, `checkout-own-${width}`);
  await context.close();
}

// POS review: needs a read-only quote from the configured contract.
{
  const { context, page } = await newPage({ width: 390 });
  await page.goto(`${BASE}/merchant/register`);
  await page.getByLabel('Amount (NEAR)').fill('0.01');
  await page.getByLabel('Sale reference (optional)').fill('Order 42');
  const cont = page.getByRole('button', { name: 'Continue' });
  try {
    await cont.waitFor({ timeout: 15000 });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Continue' && !b.disabled), null, { timeout: 20000 });
    await cont.click();
    await page.getByText('Check before you sign').first().waitFor({ timeout: 20000 });
    await shot(page, 'pos-review-390');
    results.push({ name: 'pos-review-wallet-button', present: await page.getByRole('button', { name: 'Create request in wallet' }).count() });
  } catch (e) {
    results.push({ name: 'pos-review-390', error: String(e).slice(0, 200) });
    await shot(page, 'pos-review-blocked-390');
  }
  await context.close();
}

// Customer screens without a wallet.
for (const width of widths) {
  const { context, page } = await newPage({ width, wallet: false });
  await page.goto(`${BASE}/checkout/cafe.testnet`);
  await page.getByText('Waiting for a sale').first().waitFor({ timeout: 15000 });
  await shot(page, `checkout-customer-${width}`);
  await context.close();
}
{
  const { context, page } = await newPage({ width: 1280, height: 900, wallet: false });
  await page.goto(`${BASE}/checkout/cafe.testnet`);
  await page.getByText('Waiting for a sale').first().waitFor({ timeout: 15000 });
  await shot(page, 'checkout-customer-1280');
  await context.close();
}
{
  const { context, page } = await newPage({ width: 390, wallet: false });
  await page.goto(`${BASE}/checkout/cafe.near`);
  await page.getByText('Not a NEAR Testnet account').first().waitFor({ timeout: 15000 });
  await shot(page, 'checkout-not-testnet-390');
  await page.goto(`${BASE}/checkout/cafe.testnet`);
  await page.getByRole('button', { name: 'Paste sale link' }).click();
  await page.getByRole('textbox').fill(`${BASE}/checkout/shop.near`);
  await page.getByRole('button', { name: /Open/ }).click();
  await page.getByText('That merchant QR is not for NEAR Testnet.').first().waitFor({ timeout: 5000 });
  await shot(page, 'checkout-paste-invalid-390');
  // Keyboard: Tab reaches the primary CTA with a visible focus ring.
  await page.goto(`${BASE}/checkout/cafe.testnet`);
  let focused = '';
  for (let i = 0; i < 12 && !focused.includes('Scan sale QR'); i++) {
    await page.keyboard.press('Tab');
    focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
  }
  results.push({ name: 'keyboard-reaches-scan-cta', ok: focused.includes('Scan sale QR') });
  await page.goto(`${BASE}/s/11111111-1111-4111-8111-111111111111`);
  await page.getByText('Live Handshake is not available yet').first().waitFor({ timeout: 15000 });
  await shot(page, 'session-unavailable-390');
  await page.goto(`${BASE}/s/not-a-session`);
  await page.getByText('Invalid session link').first().waitFor({ timeout: 15000 });
  await shot(page, 'session-invalid-390');
  // Handshake DEMO walk-through.
  await page.goto(`${BASE}/demo/handshake`);
  await page.getByText('Synthetic data · no network · no wallet').first().waitFor({ timeout: 15000 });
  await shot(page, 'demo-handshake-1-create-390');
  await page.getByRole('button', { name: /Next/ }).click();
  await page.getByRole('button', { name: /Next/ }).click();
  await shot(page, 'demo-handshake-3-compare-390');
  await page.getByRole('button', { name: 'Simulate a substituted code' }).click();
  await shot(page, 'demo-handshake-3-mismatch-390');
  await page.getByRole('button', { name: 'Restore the matching code' }).click();
  await page.getByRole('button', { name: /Next/ }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Confirm review' }).click();
  await page.getByRole('button', { name: /Next/ }).click();
  await shot(page, 'demo-handshake-5-wallet-390');
  await context.close();
}
{
  const { context, page } = await newPage({ width: 1280, height: 900, wallet: false });
  await page.goto(`${BASE}/demo/handshake`);
  await page.getByRole('button', { name: /Next/ }).click();
  await page.getByRole('button', { name: /Next/ }).click();
  await shot(page, 'demo-handshake-compare-1280');
  await context.close();
}

// Turkish.
{
  const { context, page } = await newPage({ width: 390, locale: 'tr' });
  await page.goto(`${BASE}/merchant`);
  await page.getByText('Alıcı hesap').first().waitFor({ timeout: 15000 });
  await shot(page, 'merchant-hub-390-tr');
  await page.goto(`${BASE}/merchant/setup`);
  await page.getByRole('img', { name: /Satıcı keşif QR/ }).first().waitFor({ timeout: 15000 });
  await shot(page, 'discovery-qr-390-tr');
  await context.close();
}
{
  const { context, page } = await newPage({ width: 390, locale: 'tr', wallet: false });
  await page.goto(`${BASE}/checkout/cafe.testnet`);
  await page.getByText('Satış bekleniyor').first().waitFor({ timeout: 15000 });
  await shot(page, 'checkout-customer-390-tr');
  await page.goto(`${BASE}/demo/handshake`);
  await page.getByRole('button', { name: /İleri/ }).click();
  await page.getByRole('button', { name: /İleri/ }).click();
  await shot(page, 'demo-handshake-compare-390-tr');
  await context.close();
}

// Reduced motion: the checkout pulse is off.
{
  const { context, page } = await newPage({ width: 390, wallet: false, reduced: true });
  await page.goto(`${BASE}/checkout/cafe.testnet`);
  await page.getByText('Waiting for a sale').first().waitFor({ timeout: 15000 });
  const anim = await page.evaluate(() => getComputedStyle(document.querySelector('.checkout-pulse')).animationName);
  results.push({ name: 'reduced-motion-pulse', animationName: anim });
  await context.close();
}
{
  const { context, page } = await newPage({ width: 390, wallet: false });
  await page.goto(`${BASE}/checkout/cafe.testnet`);
  await page.getByText('Waiting for a sale').first().waitFor({ timeout: 15000 });
  const anim = await page.evaluate(() => getComputedStyle(document.querySelector('.checkout-pulse')).animationName);
  results.push({ name: 'full-motion-pulse', animationName: anim });
  await context.close();
}

// 44px touch targets on the main merchant/checkout controls.
{
  const { context, page } = await newPage({ width: 360 });
  const small = [];
  for (const path of ['/merchant', '/merchant/setup', '/merchant/register', `/checkout/cafe.testnet`]) {
    await page.goto(`${BASE}${path}`);
    await page.waitForTimeout(1500);
    const found = await page.evaluate(() =>
      [...document.querySelectorAll('main a, main button, main input, main textarea, main select')]
        .filter((el) => el.offsetParent !== null)
        .map((el) => ({ text: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 40), h: el.getBoundingClientRect().height }))
        .filter((x) => x.h < 44),
    );
    for (const f of found) small.push({ path, ...f });
  }
  results.push({ name: 'touch-targets-under-44px', items: small });
  await context.close();
}

await browser.close();
const summary = {
  results,
  rpcMethods: [...new Set(rpcMethods)],
  broadcastAttempted: rpcMethods.some((m) => /broadcast|send_tx/.test(m)),
  blockedHosts: [...new Set(blocked)],
  pageErrors,
};
writeFileSync(`${outDir}/../phase7-smoke.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
