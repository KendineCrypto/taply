// Local preview only. Browser interaction evidence, never live payment proof.
// node scripts/mainnet-product-qa.mjs <playwright/index.mjs> <out> <base>
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const out = process.argv[3]; const base = process.argv[4] ?? 'http://127.0.0.1:3113';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('LOCAL_PREVIEW_ONLY');
fs.mkdirSync(out, { recursive: true });
const results = []; const errors = []; const scripts = new Map();
function check(name, ok) { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); }
const browser = await chromium.launch();
try {
  for (const [locale, width] of [['en', 390], ['tr', 1280]]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'taply_locale', value: locale, url: base }]);
    // No wallet manifest or live RPC is needed for this product UI check.
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    page.on('response', async response => { if (response.request().resourceType() === 'script') { try { scripts.set(response.url(), await response.text()); } catch { /* closed */ } } });
    for (const path of ['wallet', 'wallet/create', 'wallet/restore', 'send', 'receive', 'pay', 'scan', 'activity', 'contacts', 'split', 'recurring', 'merchant', 'merchant/setup', 'merchant/register', 'settings', 'protected/new', 'gift/new', 'gift/p', 'handshake', 'tools']) {
      await page.goto(`${base}/${path}`); await page.getByTestId('mainnet-product').waitFor();
      check(`${locale} ${path}: isolated Mainnet destination`, new URL(page.url()).pathname === `/m/${path}`);
      check(`${locale} ${path}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.goto(`${base}/m/wallet/restore`);
    check(`${locale} restore: no phrase input`, await page.locator('textarea,input[type=password]').count() === 0);
    await page.goto(`${base}/m/send`);
    check(`${locale} send: disabled`, await page.getByRole('button', { name: locale === 'tr' ? 'Gönder' : 'Send', exact: true }).isDisabled());
    await page.goto(`${base}/m/split`);
    await page.getByLabel(locale === 'tr' ? 'Tutar' : 'Amount', { exact: true }).fill('0.000005');
    await page.getByRole('button', { name: locale === 'tr' ? 'Kesin payları hesapla' : 'Calculate exact shares' }).click();
    check(`${locale} split: exact remainder`, (await page.locator('ol').textContent()).includes('0.000003 USDC'));
    await page.goto(`${base}/m/gift/new`);
    await page.getByLabel(locale === 'tr' ? 'Mesaj / not' : 'Message / memo').fill('Taply 💚');
    await page.getByRole('button', { name: locale === 'tr' ? 'Zarfı önizle' : 'Preview envelope' }).click();
    check(`${locale} Gift: opened preview only`, await page.locator('.gift-env').getAttribute('data-open') === 'true');
    check(`${locale} Gift: no funded link`, await page.locator('a[href*="#k="]').count() === 0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${out}/gift-${locale}-${width}.png`, fullPage: true });
    await page.goto(`${base}/m/tools`); await page.screenshot({ path: `${out}/tools-${locale}-${width}.png`, fullPage: true });
    const unknown = await page.goto(`${base}/m/not-a-product`); check(`${locale}: unknown route 404`, unknown.status() === 404);
    await context.close();
  }
  const forbidden = ['taply.testnet-vault.v1', 'taply-pay-pilot-1.testnet', 'taply-e2e-ce38a238', 'rpc.testnet.near.org', 'testnet.nearblocks.io'];
  for (const token of forbidden) check(`loaded product scripts omit ${token}`, ![...scripts.values()].some(text => text.includes(token)));
  check('no browser runtime errors', errors.length === 0);
} finally {
  await browser.close(); fs.writeFileSync(`${out}/product-results.json`, JSON.stringify({ evidence: 'local preview UI; no live payment or camera proof', results, errors }, null, 2));
}
if (results.some(r => !r.ok)) process.exitCode = 1;
