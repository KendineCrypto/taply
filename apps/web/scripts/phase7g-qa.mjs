// Phase 7G browser QA: production build, real read-only Testnet data, two browser contexts.
//
// Safety model (same as phase7d/7f): an injected read-only Testnet wallet whose every
// signing method throws; only the app origin, the configured RPC host and the public
// archival RPC are reachable; every RPC method is recorded; any broadcast/send method is
// aborted and reported. Nothing is created, signed or sent.
//
// Historical reads (block by id, chunk, EXPERIMENTAL_tx_status, block-anchored query) that the
// configured RPC answers with UNKNOWN_BLOCK/UNKNOWN_TRANSACTION are RETRIED by this harness on
// https://archival-rpc.testnet.near.org, because the
// configured non-archival RPC has pruned the 2026-11-01 pilot blocks. Same chain, real
// data; the app's code and configuration are unchanged. Everything else goes to the
// configured RPC. Synthetic edge cases (RPC down, slow RPC) are labelled as such.
//
// Real data: the pilot's FINAL_PAID request 9b9a…4502 on taply-pay-pilot-1.testnet
// (docs/EVIDENCE.md). OPEN-state screens need a new request (a transaction), so they are
// covered by unit/integration tests, not here.
//
// Usage: node apps/web/scripts/phase7g-qa.mjs <playwright/index.mjs> <out dir> <env file>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [pwIndex, outDir, envFile] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(pwIndex).href);
const BASE = process.env.TAPLY_QA_BASE ?? 'http://127.0.0.1:3207';
const ARCHIVAL = 'https://archival-rpc.testnet.near.org';
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const rpcHost = new URL(env.NEXT_PUBLIC_TAPLY_RPC_URL).host;
const ID = '9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502';
const FUNDING = 'CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su';
const MERCHANT = 'taplytest.testnet';
const CUSTOMER = 'taply-pilot-funder-1101.testnet';
const STRANGER = 'someone-else-qa.testnet';
mkdirSync(outDir, { recursive: true });

const rpcMethods = new Set();
// Archival answers are cached by exact request body (minus the JSON-RPC id): the public
// archival RPC takes 3-15 s per call, near the app's 15 s per-call timeout. Cached answers
// are the same real chain data, re-served. Only successful results are cached.
const archivalCache = new Map();
const ONLY = process.env.TAPLY_QA_ONLY ?? 'all';
async function archival(postData) {
  const parsed = JSON.parse(postData);
  const key = JSON.stringify({ method: parsed.method, params: parsed.params });
  const hit = archivalCache.get(key);
  if (hit !== undefined) return { status: 200, text: hit.replace('__ID__', JSON.stringify(parsed.id)) };
  const response = await fetch(ARCHIVAL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: postData, signal: AbortSignal.timeout(60000) });
  const text = await response.text();
  try {
    const body = JSON.parse(text);
    if (response.ok && body.result !== undefined) archivalCache.set(key, JSON.stringify({ ...body, id: '__ID__' }).replace('"__ID__"', '__ID__'));
  } catch {
    // not cacheable
  }
  return { status: response.status, text };
}
const forwarded = new Set();
const blocked = [];
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

const historical = (body) =>
  body.method === 'chunk' ||
  body.method === 'EXPERIMENTAL_tx_status' ||
  (body.method === 'block' && body.params?.block_id !== undefined) ||
  (body.method === 'query' && body.params?.block_id !== undefined);

const browser = await chromium.launch({ headless: true });

async function open({ width, height = 844, account = null, locale = 'en', reducedMotion = 'no-preference', init = null, rpc = 'real', scale = 2 }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, locale: locale === 'tr' ? 'tr-TR' : 'en-US', reducedMotion });
  await context.addCookies([{ name: 'taply_locale', value: locale, url: BASE }]);
  if (account !== null) await context.addInitScript(injectWallet, account);
  if (init !== null) await context.addInitScript(init.fn, init.arg);
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === BASE) return route.continue();
    if (url.host !== rpcHost) return route.abort();
    let body = {};
    try {
      body = JSON.parse(request.postData() ?? '{}');
    } catch {
      rpcMethods.add('unparsed');
    }
    const name = body.method === 'query' ? `query:${body.params?.request_type}:${body.params?.method_name ?? ''}` : String(body.method);
    rpcMethods.add(name);
    if (/broadcast|send_tx/i.test(String(body.method))) {
      blocked.push(name);
      return route.abort();
    }
    if (rpc === 'down') return route.abort('connectionfailed'); // SYNTHETIC: RPC unavailable
    if (rpc === 'slow') await new Promise((r) => setTimeout(r, 6000)); // SYNTHETIC: slow finalized RPC
    if (request.method() !== 'POST') return route.continue();
    // Configured RPC first; only a pruned/unknown block or transaction is retried on archival.
    try {
      // A pruned transaction makes the configured FastNEAR RPC hold the request ~30 s and
      // answer TIMEOUT_ERROR (longer than the app's 15 s timeout), so the harness sends
      // EXPERIMENTAL_tx_status for the 2026-11-01 pilot straight to archival.
      if (body.method === 'EXPERIMENTAL_tx_status') {
        forwarded.add(name);
        const answer = await archival(request.postData());
        return route.fulfill({ status: answer.status, body: answer.text, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
      }
      const primary = await fetch(request.url(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: request.postData() });
      const text = await primary.text();
      let answer = { status: primary.status, text };
      if (/UNKNOWN_BLOCK|GARBAGE_COLLECTED_BLOCK|UNKNOWN_CHUNK|UNKNOWN_TRANSACTION|TIMEOUT_ERROR/.test(text) && historical(body)) {
        forwarded.add(name);
        answer = await archival(request.postData());
      }
      return route.fulfill({ status: answer.status, body: answer.text, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
    } catch {
      return route.abort();
    }
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${page.url()}: ${e.message}`));
  return { context, page };
}

async function audit(page, name, { screenshot = true, full = true, settle = 1600 } = {}) {
  await page.waitForTimeout(settle);
  const report = await page.evaluate(() => {
    const visible = (el) => el.offsetParent !== null || el.getClientRects().length > 0;
    const controls = [...document.querySelectorAll('main a, main button, main input, main summary, main select')].filter(visible);
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
    const status = document.querySelector('[data-testid="journey-status"]');
    return {
      overflowPx: document.documentElement.scrollWidth - window.innerWidth,
      unnamed,
      small,
      wide,
      liveRegions: document.querySelectorAll('main [role="status"], main [aria-live]').length,
      heroTone: hero?.getAttribute('data-tone') ?? null,
      heroTitle: hero?.querySelector('h2')?.textContent ?? null,
      status: status?.getAttribute('data-status') ?? null,
      receipt: document.querySelector('[data-receipt-status]')?.getAttribute('data-receipt-status') ?? null,
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
const shotWidths = new Set([360, 390]);

// Warm the slowest archival read once (same real data the verifier will request).
await archival(JSON.stringify({ jsonrpc: '2.0', id: 'warm', method: 'EXPERIMENTAL_tx_status', params: { tx_hash: FUNDING, sender_account_id: CUSTOMER, wait_until: 'FINAL' } })).catch(() => undefined);

// 1. Merchant and customer phones on the same paid request, all widths, EN and TR.
for (const locale of ONLY === 'all' ? ['en', 'tr'] : []) {
  for (const width of [360, 390, 430, 768, 1280]) {
    const shoot = (locale === 'en' && shotWidths.has(width)) || (locale === 'tr' && width === 360) || width === 1280;
    for (const [role, account, init] of [
      ['merchant', MERCHANT, posHint],
      ['customer', CUSTOMER, checkoutHint],
    ]) {
      const { context, page } = await open({ width, account, locale, init, scale: shoot ? 2 : 1 });
      const label = `${locale === 'tr' ? 'tr-' : ''}${role}-paid-${width}`;
      try {
        await page.goto(`${BASE}/pay/${ID}`);
        await page.locator('.journey-hero').first().waitFor({ timeout: 45000 });
        await audit(page, label, { screenshot: shoot });
      } catch (e) {
        await page.screenshot({ path: `${outDir}/FAILED-${label}.png`, fullPage: true });
        results.push({ name: label, error: String(e).slice(0, 160) });
      }
      await context.close();
    }
  }
}

// 2. Merchant receipt WITHOUT the customer's link: locator -> verifier -> Verified Paid (real chain).
for (const [locale, width] of [['en', 390], ['tr', 360], ['en', 1280]]) {
  const { context, page } = await open({ width, account: MERCHANT, locale });
  const t0 = Date.now();
  await page.goto(`${BASE}/receipt/${ID}`);
  let sawLocator = false;
  try {
    await page.getByTestId('locator-progress').waitFor({ timeout: 20000 });
    sawLocator = true;
    if (locale === 'en' && width === 390) await page.screenshot({ path: `${outDir}/merchant-receipt-locating-390.png` });
  } catch {
    // It may already be done.
  }
  try {
    await page.getByTestId('verified-evidence').waitFor({ timeout: 180000 });
    const located = await page.getByTestId('located-note').count();
    if (locale === 'en' && width === 390) await page.screenshot({ path: `${outDir}/merchant-receipt-verified-burst-390.png` });
    await audit(page, `${locale === 'tr' ? 'tr-' : ''}merchant-receipt-verified-${width}`, { screenshot: width !== 1280 || locale === 'en' });
    results.push({ name: `merchant-locator-${locale}-${width}`, sawLocator, locatedNote: located, seconds: Math.round((Date.now() - t0) / 1000) });
  } catch (e) {
    await page.screenshot({ path: `${outDir}/merchant-receipt-FAILED-${locale}-${width}.png`, fullPage: true });
    results.push({ name: `merchant-locator-${locale}-${width}`, error: String(e).slice(0, 200), sawLocator });
  }
  await context.close();
}

// 3. Customer receipt with its own verification link.
{
  const { context, page } = await open({ width: 390, account: CUSTOMER });
  await page.goto(`${BASE}/receipt/${ID}?ftx=${FUNDING}`);
  try {
    await page.getByTestId('verified-evidence').waitFor({ timeout: 180000 });
    await audit(page, 'customer-receipt-verified-390');
  } catch (e) {
    results.push({ name: 'customer-receipt-verified-390', error: String(e).slice(0, 200) });
  }
  await context.close();
}

if (ONLY === 'all') {
// 4. Two phones side by side (two browser contexts at once), composed into one image.
{
  const a = await open({ width: 390, account: MERCHANT, init: posHint });
  const b = await open({ width: 390, account: CUSTOMER, init: checkoutHint });
  await Promise.all([a.page.goto(`${BASE}/pay/${ID}`), b.page.goto(`${BASE}/pay/${ID}`)]);
  await Promise.all([a.page.locator('.journey-hero').first().waitFor({ timeout: 30000 }), b.page.locator('.journey-hero').first().waitFor({ timeout: 30000 })]);
  await a.page.waitForTimeout(1600);
  const facts = async (page) =>
    page.evaluate(() => {
      const hero = document.querySelector('.journey-hero');
      return {
        code: hero?.querySelector('[data-testid="sale-code"] [aria-label]')?.getAttribute('aria-label') ?? document.querySelector('[data-testid="sale-code"] [aria-label]')?.getAttribute('aria-label') ?? null,
        account: hero?.querySelector('.chain-id')?.textContent ?? null,
        amount: hero?.querySelector('.display-amount')?.textContent ?? null,
        stage: hero?.getAttribute('data-stage') ?? null,
        status: hero?.querySelector('[data-testid="journey-status"]')?.getAttribute('data-status') ?? null,
      };
    });
  const [m, c] = await Promise.all([facts(a.page), facts(b.page)]);
  results.push({ name: 'two-phone-consistency', merchant: m, customer: c, consistent: m.code === c.code && m.account === c.account && m.amount === c.amount && m.stage === c.stage });
  const [ma, cb] = await Promise.all([a.page.screenshot({ fullPage: false }), b.page.screenshot({ fullPage: false })]);
  const canvas = await (await browser.newContext({ viewport: { width: 860, height: 900 }, deviceScaleFactor: 2 })).newPage();
  await canvas.setContent(
    `<body style="margin:0;background:#0B120E;display:flex;gap:28px;padding:28px;font-family:sans-serif;color:#F4F3E8">` +
      `<figure style="margin:0"><img style="width:390px;border-radius:28px" src="data:image/png;base64,${ma.toString('base64')}"><figcaption style="margin-top:8px;font-size:13px;opacity:.7">Merchant phone (taplytest.testnet)</figcaption></figure>` +
      `<figure style="margin:0"><img style="width:390px;border-radius:28px" src="data:image/png;base64,${cb.toString('base64')}"><figcaption style="margin-top:8px;font-size:13px;opacity:.7">Customer phone (payer account)</figcaption></figure></body>`,
  );
  await canvas.screenshot({ path: `${outDir}/two-phones-paid-side-by-side.png` });
  await a.context.close();
  await b.context.close();
}

// 5. Other surfaces: merchant home, checkout, a third account on the same sale, Handshake room preview.
for (const [name, path, account] of [
  ['merchant-home-390', '/merchant', MERCHANT],
  ['checkout-390', `/checkout/${MERCHANT}`, CUSTOMER],
  ['stranger-paid-390', `/pay/${ID}`, STRANGER],
]) {
  const { context, page } = await open({ width: 390, account });
  await page.goto(`${BASE}${path}`);
  await page.waitForTimeout(3500);
  await audit(page, name);
  await context.close();
}
for (const width of [360, 1280]) {
  const { context, page } = await open({ width });
  await page.goto(`${BASE}/demo/handshake`);
  await page.getByTestId('room-demo').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  results.push({ name: `demo-room-count-${width}`, count: await page.getByTestId('room-demo').count() });
  for (const scenario of ['joined', 'pending', 'mismatch']) {
    await page.getByLabel('Room state').first().selectOption(scenario);
    await page.getByTestId('room-demo').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    if (width === 360 || scenario === 'pending') await page.getByTestId('room-demo').first().screenshot({ path: `${outDir}/demo-room-${scenario}-${width}.png` });
  }
  await audit(page, `demo-handshake-${width}`, { screenshot: false });
  await context.close();
}

// 6. SYNTHETIC edge states: RPC unavailable and slow finalized RPC.
{
  const { context, page } = await open({ width: 390, account: MERCHANT, rpc: 'down' });
  await page.goto(`${BASE}/pay/${ID}`);
  await page.waitForTimeout(9000);
  await audit(page, 'synthetic-rpc-down-390');
  await context.close();
}
{
  const { context, page } = await open({ width: 390, account: MERCHANT, rpc: 'slow', init: posHint });
  await page.goto(`${BASE}/pay/${ID}`);
  await page.waitForTimeout(2500);
  await audit(page, 'synthetic-slow-rpc-loading-390', { settle: 0 });
  await page.locator('.journey-hero').first().waitFor({ timeout: 60000 });
  results.push({ name: 'synthetic-slow-rpc-recovers', ok: true });
  await context.close();
}

// 7. Keyboard: the merchant's primary action is reachable by Tab and shows a focus ring.
{
  const { context, page } = await open({ width: 390, account: MERCHANT, init: posHint });
  await page.goto(`${BASE}/pay/${ID}`);
  await page.locator('.journey-hero').first().waitFor({ timeout: 30000 });
  const order = [];
  let reached = null;
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      const style = el ? getComputedStyle(el) : null;
      return { text: (el?.textContent ?? '').trim().slice(0, 40), tag: el?.tagName ?? '', ring: style ? style.outlineStyle !== 'none' || style.boxShadow !== 'none' : false };
    });
    order.push(`${info.tag}:${info.text}`);
    if (/Verify receipt/.test(info.text)) {
      reached = { tabs: i + 1, ring: info.ring };
      break;
    }
  }
  if (reached !== null) await page.screenshot({ path: `${outDir}/keyboard-verify-receipt-focus-390.png` });
  results.push({ name: 'keyboard-primary-action', reached, order: order.slice(0, 12) });
  await context.close();
}

// 8. Reduced motion: every Phase 7F/7G effect stands still.
{
  const { context, page } = await open({ width: 390, account: MERCHANT, reducedMotion: 'reduce', init: posHint });
  await page.goto(`${BASE}/pay/${ID}`);
  await page.locator('.journey-hero').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  const motion = await page.evaluate(() => {
    const name = (sel, pseudo) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el, pseudo).animationName : 'absent';
    };
    return {
      hero: name('.journey-hero'),
      heroGlow: name('.journey-hero', '::after'),
      status: name('.journey-status'),
      connect: name('.journey-connect'),
      settle: name('.journey-settle'),
      ripple: name('.journey-node-current', '::after'),
    };
  });
  results.push({ name: 'reduced-motion', ...motion, still: Object.values(motion).every((v) => v === 'none' || v === 'absent') });
  await context.close();
}

}

await browser.close();
const summary = {
  base: BASE,
  configuredRpcHost: rpcHost,
  forwardedToArchival: [...forwarded],
  results,
  failures: results.filter((r) => r.error || r.overflowPx > 0 || (r.unnamed && r.unnamed.length) || (r.small && r.small.length) || r.consistent === false || r.still === false),
  rpcMethods: [...rpcMethods],
  broadcastAttempted: blocked,
  pageErrors,
};
writeFileSync(`${outDir}/phase7g-qa.json`, JSON.stringify(summary, null, 2));
console.log(
  JSON.stringify(
    {
      failures: summary.failures,
      rpc: summary.rpcMethods,
      forwarded: summary.forwardedToArchival,
      broadcast: blocked,
      pageErrors,
      heroes: results.filter((r) => r.heroTitle && /390|1280/.test(r.name)).map((r) => `${r.name}: ${r.status} / ${r.heroTitle} [${r.heroTone}]`),
      special: results.filter((r) => /locator|consistency|keyboard|reduced|slow/.test(r.name)),
    },
    null,
    2,
  ),
);
