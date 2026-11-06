// Phase 7H release-candidate browser QA: production build, real read-only Testnet data.
//
// Safety model (unchanged from phase7d/7f/7g): an injected read-only Testnet wallet whose
// every signing method throws; only the app origin, the configured RPC host and the public
// archival RPC are reachable; every RPC method is recorded; any broadcast/send method is
// aborted and reported. Nothing is created, signed or sent. Run with
// NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY=off so the app itself refuses to build a payment.
//
// Real data: the pilot's FINAL_PAID request 9b9a…4502 on taply-pay-pilot-1.testnet
// (docs/EVIDENCE.md). Historical reads the configured RPC has pruned are retried on the
// public archival RPC ONLY in sections that say so; section 4 deliberately does not, to
// show what a judge on a normal RPC sees. SYNTHETIC edge states are labelled as such.
//
// What this adds over phase7g-qa.mjs: every audited surface at 360/390/430/768/1280 in EN
// and TR (overflow, unnamed controls, touch targets, live regions, duplicate status text),
// account switching on one device, pruned history without archival, offline -> reconnect,
// receipt RPC failure, and judge-facing entry pages.
//
// Usage: node apps/web/scripts/phase7h-qa.mjs <playwright/index.mjs> <out dir> <env file>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [pwIndex, outDir, envFile] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(pwIndex).href);
const BASE = process.env.TAPLY_QA_BASE ?? 'http://127.0.0.1:3207';
const ARCHIVAL = 'https://archival-rpc.testnet.near.org';
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
if (env.NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY !== 'off') throw new Error('Phase 7H QA runs with the Instant Pay signing flag OFF');
const rpcHost = new URL(env.NEXT_PUBLIC_TAPLY_RPC_URL).host;
const ID = '9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502';
const FUNDING = 'CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su';
const MERCHANT = 'taplytest.testnet';
const CUSTOMER = 'taply-pilot-funder-1101.testnet';
const STRANGER = 'someone-else-qa.testnet';
const WIDTHS = [360, 390, 430, 768, 1280];
const ONLY = process.env.TAPLY_QA_ONLY ?? 'all';
// Optional: re-run only these matrix labels (comma-separated), e.g. after a provider 429.
const LABELS = process.env.TAPLY_QA_LABELS ? new Set(process.env.TAPLY_QA_LABELS.split(',')) : null;
const SUMMARY = process.env.TAPLY_QA_SUMMARY ?? 'phase7h-qa.json';
mkdirSync(outDir, { recursive: true });

const rpcMethods = new Set();
const archivalCache = new Map();
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

// The account comes from localStorage so one browser context can switch accounts (section 3).
const injectWallet = (fallback) => {
  const account = localStorage.getItem('taply.qa.account') ?? fallback;
  if (account === 'none') return;
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

/** rpc: 'real' (archival retry for pruned history) | 'pruned' (configured RPC only) | 'down' | 'slow' | 'history-down'. */
async function open({ width, height = 844, account = null, locale = 'en', reducedMotion = 'no-preference', init = null, rpc = 'real', scale = 1 }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, locale: locale === 'tr' ? 'tr-TR' : 'en-US', reducedMotion });
  await context.addCookies([{ name: 'taply_locale', value: locale, url: BASE }]);
  if (account !== null) await context.addInitScript(injectWallet, account);
  if (init !== null) await context.addInitScript(init.fn, init.arg);
  const state = { rpc };
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
    if (state.rpc === 'down') return route.abort('connectionfailed'); // SYNTHETIC
    if (state.rpc === 'history-down' && historical(body)) return route.abort('connectionfailed'); // SYNTHETIC
    if (state.rpc === 'slow') await new Promise((r) => setTimeout(r, 6000)); // SYNTHETIC
    if (request.method() !== 'POST') return route.continue();
    try {
      if (body.method === 'EXPERIMENTAL_tx_status' && state.rpc !== 'pruned') {
        forwarded.add(name);
        const answer = await archival(request.postData());
        return route.fulfill({ status: answer.status, body: answer.text, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
      }
      const primary = await fetch(request.url(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: request.postData(), signal: AbortSignal.timeout(40000) });
      const text = await primary.text();
      let answer = { status: primary.status, text };
      if (state.rpc !== 'pruned' && /UNKNOWN_BLOCK|GARBAGE_COLLECTED_BLOCK|UNKNOWN_CHUNK|UNKNOWN_TRANSACTION|TIMEOUT_ERROR/.test(text) && historical(body)) {
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
  return { context, page, state };
}

/** Layout/a11y facts plus duplicate-status detection (the same status sentence shown twice in main). */
async function audit(page, name, { screenshot = false, full = true, settle = 1600 } = {}) {
  await page.waitForTimeout(settle);
  const report = await page.evaluate(() => {
    const visible = (el) => (el.offsetParent !== null || el.getClientRects().length > 0) && getComputedStyle(el).visibility !== 'hidden';
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
    // Headings and notice titles that repeat verbatim on one screen.
    const titles = [...document.querySelectorAll('main h1, main h2, main h3, main [role="status"] strong, main .notice-title, main p strong')]
      .filter(visible)
      .map((el) => el.textContent.trim())
      .filter((t) => t.length > 3);
    const seen = new Map();
    for (const t of titles) seen.set(t, (seen.get(t) ?? 0) + 1);
    const repeated = [...seen].filter(([, n]) => n > 1).map(([t, n]) => `${t} x${n}`);
    const buttons = controls.filter((el) => el.tagName === 'BUTTON').map((el) => el.textContent.trim());
    const retryish = buttons.filter((b) => /^(Try again|Check again|Tekrar dene|Yeniden kontrol et|Tekrar kontrol et)$/i.test(b));
    const hero = document.querySelector('.journey-hero');
    const status = document.querySelector('[data-testid="journey-status"]');
    const main = document.querySelector('main')?.innerText ?? '';
    return {
      overflowPx: document.documentElement.scrollWidth - window.innerWidth,
      unnamed,
      small,
      wide,
      repeated,
      retryControls: retryish.length,
      liveRegions: document.querySelectorAll('main [role="status"], main [aria-live]').length,
      heroTone: hero?.getAttribute('data-tone') ?? null,
      heroTitle: hero?.querySelector('h2')?.textContent ?? null,
      status: status?.getAttribute('data-status') ?? null,
      receipt: document.querySelector('[data-receipt-status]')?.getAttribute('data-receipt-status') ?? null,
      saysVerifiedPaid: /Verified Paid|Doğrulanmış ödeme|Doğrulandı/i.test(main),
      hasVerifiedEvidence: document.querySelector('[data-testid="verified-evidence"]') !== null,
      mockStamp: /\bMOCK\b|\bDEMO\b/.test(main),
      lang: document.documentElement.lang,
    };
  });
  if (screenshot) await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: full });
  results.push({ name, ...report });
  return report;
}

/** Non-fatal wait: a timeout is recorded with a screenshot instead of aborting the run. */
async function ready(page, selector, timeout, label) {
  try {
    await page.locator(selector).first().waitFor({ timeout });
    return true;
  } catch (e) {
    await page.screenshot({ path: `${outDir}/FAILED-${label}.png`, fullPage: true }).catch(() => undefined);
    results.push({ name: `wait-${label}`, error: `${selector} not visible after ${timeout} ms: ${String(e).slice(0, 80)}` });
    return false;
  }
}

const posHint = { fn: (id) => localStorage.setItem('taply.posSales.v1', JSON.stringify([id])), arg: ID };
const checkoutHint = {
  fn: (account) => sessionStorage.setItem('taply.checkout.v1', JSON.stringify({ accountId: account, at: Date.now() })),
  arg: MERCHANT,
};

// Warm the slowest archival read once.
await archival(JSON.stringify({ jsonrpc: '2.0', id: 'warm', method: 'EXPERIMENTAL_tx_status', params: { tx_hash: FUNDING, sender_account_id: CUSTOMER, wait_until: 'FINAL' } })).catch(() => undefined);

// 1. Every judge-facing and payment surface, five widths, EN and TR.
if (ONLY === 'all' || ONLY === 'matrix') {
  const surfaces = [
    ['home', '/', null, null, null],
    ['demo', '/demo', null, null, null],
    ['merchant-home', '/merchant', MERCHANT, posHint, null],
    ['checkout', `/checkout/${MERCHANT}`, CUSTOMER, null, null],
    ['merchant-paid', `/pay/${ID}`, MERCHANT, posHint, '.journey-hero'],
    ['customer-paid', `/pay/${ID}`, CUSTOMER, checkoutHint, '.journey-hero'],
    ['customer-receipt', `/receipt/${ID}?ftx=${FUNDING}`, CUSTOMER, null, '[data-testid="verified-evidence"]'],
  ];
  for (const locale of ['en', 'tr']) {
    for (const width of WIDTHS) {
      for (const [surface, path, account, init, ready] of surfaces) {
        const shoot = (width === 390 && locale === 'en') || (width === 360 && locale === 'tr') || (width === 1280 && locale === 'en' && /paid|receipt/.test(surface));
        const label = `${locale}-${surface}-${width}`;
        if (LABELS !== null && !LABELS.has(label)) continue;
        const { context, page } = await open({ width, account, locale, init, scale: shoot ? 2 : 1 });
        try {
          await page.goto(`${BASE}${path}`);
          if (ready !== null) await page.locator(ready).first().waitFor({ timeout: surface.includes('receipt') ? 180000 : 45000 });
          await audit(page, label, { screenshot: shoot });
        } catch (e) {
          await page.screenshot({ path: `${outDir}/FAILED-${label}.png`, fullPage: true });
          results.push({ name: label, error: String(e).slice(0, 160) });
        }
        await context.close();
      }
    }
  }
}

// 2. Merchant receipt without the customer's link (locator -> verifier), EN 390 and TR 360.
if (ONLY === 'all' || ONLY === 'receipts') {
  for (const [locale, width] of [['en', 390], ['tr', 360]]) {
    const { context, page } = await open({ width, account: MERCHANT, locale, scale: 2 });
    const t0 = Date.now();
    await page.goto(`${BASE}/receipt/${ID}`);
    try {
      await page.getByTestId('verified-evidence').waitFor({ timeout: 240000 });
      await audit(page, `${locale}-merchant-receipt-verified-${width}`, { screenshot: true });
      results.push({ name: `merchant-locator-${locale}-${width}`, seconds: Math.round((Date.now() - t0) / 1000) });
    } catch (e) {
      await page.screenshot({ path: `${outDir}/FAILED-merchant-receipt-${locale}-${width}.png`, fullPage: true });
      results.push({ name: `merchant-locator-${locale}-${width}`, error: String(e).slice(0, 200) });
    }
    await context.close();
  }
}

if (ONLY === 'all' || ONLY === 'edges') {
  // 3. Account switching on ONE device: merchant -> customer -> stranger -> disconnected.
  {
    const { context, page } = await open({ width: 390, account: MERCHANT, init: posHint });
    const seen = [];
    await page.goto(`${BASE}/`);
    for (const account of [MERCHANT, CUSTOMER, STRANGER, 'none']) {
      await page.evaluate((a) => localStorage.setItem('taply.qa.account', a), account);
      await page.goto(`${BASE}/pay/${ID}`);
      await ready(page, '.journey-hero', 45000, 'edge-1');
      const r = await audit(page, `switch-${account === 'none' ? 'disconnected' : account.split('.')[0]}-390`, { screenshot: true });
      const text = await page.locator('main').innerText();
      seen.push({ account, status: r.status, heroTitle: r.heroTitle, merchantWording: /Verify receipt|Ready for customer|Payment observed/.test(text), customerWording: /Check receipt/.test(text) });
    }
    results.push({ name: 'account-switching', seen });
    await context.close();
  }

  // 4. Pruned history on the configured RPC (NO archival retry): what a judge sees on a normal RPC.
  for (const [who, account, path] of [
    ['merchant', MERCHANT, `/receipt/${ID}`],
    ['customer', CUSTOMER, `/receipt/${ID}?ftx=${FUNDING}`],
  ]) {
    const { context, page } = await open({ width: 390, account, rpc: 'pruned', scale: 2 });
    await page.goto(`${BASE}${path}`);
    await page.waitForTimeout(45000);
    const r = await audit(page, `pruned-${who}-receipt-390`, { screenshot: true, settle: 0 });
    results.push({ name: `pruned-${who}-no-false-verified`, ok: !r.hasVerifiedEvidence });
    await context.close();
  }

  // 5. SYNTHETIC receipt read failure (every block-anchored read fails), then recovery via
  //    the single "Check again" (Phase 7H). Never Verified Paid while reads fail.
  {
    const { context, page, state } = await open({ width: 390, account: CUSTOMER, rpc: 'history-down', scale: 2 });
    await page.goto(`${BASE}/receipt/${ID}?ftx=${FUNDING}`);
    await page.waitForTimeout(20000);
    const r = await audit(page, 'synthetic-receipt-read-failure-390', { screenshot: true, settle: 0 });
    state.rpc = 'real';
    let recoveredTo = null;
    const retry = page.getByRole('button', { name: /Check again/ });
    if ((await retry.count()) === 1) {
      await retry.click();
      if (await ready(page, '[data-receipt-status]', 60000, 'receipt-retry')) {
        await page.waitForTimeout(1500);
        recoveredTo = await page.locator('[data-receipt-status]').first().getAttribute('data-receipt-status');
      }
    }
    results.push({ name: 'receipt-failure-no-false-verified', ok: !r.hasVerifiedEvidence && r.retryControls === 1 && recoveredTo !== null, retryControls: r.retryControls, recoveredTo });
    await context.close();
  }

  // 6. SYNTHETIC RPC down on the pay screen: exactly one retry control (Phase 7H fix).
  for (const locale of ['en', 'tr']) {
    const { context, page } = await open({ width: 390, account: MERCHANT, rpc: 'down', locale, scale: 2 });
    await page.goto(`${BASE}/pay/${ID}`);
    await page.waitForTimeout(12000);
    const r = await audit(page, `synthetic-rpc-down-${locale}-390`, { screenshot: true, settle: 0 });
    results.push({ name: `rpc-down-single-retry-${locale}`, ok: r.retryControls === 1, retryControls: r.retryControls });
    await context.close();
  }

  // 7. Offline -> reconnect: the paid status comes back from the chain, not from memory.
  {
    const { context, page, state } = await open({ width: 390, account: MERCHANT, init: posHint, scale: 2 });
    await page.goto(`${BASE}/pay/${ID}`);
    await ready(page, '.journey-hero', 45000, 'edge-2');
    await context.setOffline(true);
    state.rpc = 'down';
    await page.reload().catch(() => undefined);
    await page.waitForTimeout(3000);
    const offline = await page.evaluate(() => document.body.innerText.slice(0, 400));
    await context.setOffline(false);
    state.rpc = 'real';
    await page.goto(`${BASE}/pay/${ID}`);
    let recovered = false;
    try {
      await ready(page, '.journey-hero', 45000, 'edge-3');
      recovered = true;
    } catch {
      // reported below
    }
    const r = await audit(page, 'reconnect-merchant-paid-390', { screenshot: true });
    results.push({ name: 'offline-reconnect', recovered, statusAfter: r.status, offlineExcerpt: offline.replace(/\s+/g, ' ').slice(0, 160) });
    await context.close();
  }

  // 8. SYNTHETIC slow RPC: loading first, never a premature status.
  {
    const { context, page } = await open({ width: 390, account: MERCHANT, rpc: 'slow', init: posHint, scale: 2 });
    await page.goto(`${BASE}/pay/${ID}`);
    await page.waitForTimeout(2500);
    const early = await audit(page, 'synthetic-slow-rpc-loading-390', { screenshot: true, settle: 0 });
    await ready(page, '.journey-hero', 90000, 'edge-4');
    results.push({ name: 'slow-rpc', earlyStatus: early.status, recovered: true });
    await context.close();
  }

  // 9. Reduced motion, EN and TR.
  for (const locale of ['en', 'tr']) {
    const { context, page } = await open({ width: 390, account: MERCHANT, reducedMotion: 'reduce', init: posHint, locale });
    await page.goto(`${BASE}/pay/${ID}`);
    await ready(page, '.journey-hero', 45000, 'edge-5');
    await page.waitForTimeout(800);
    const motion = await page.evaluate(() => {
      const running = [...document.querySelectorAll('main *')].flatMap((el) =>
        [null, '::before', '::after'].map((p) => ({ el, a: getComputedStyle(el, p).animationName, d: getComputedStyle(el, p).animationDuration })),
      );
      // The reduced-motion override sets 0.01 ms; Chromium reports it as "1e-05s". Anything under 1 ms is still.
      const moving = (d) => d.split(',').some((part) => parseFloat(part) >= 0.001);
      return running.filter((x) => x.a !== 'none' && moving(x.d)).map((x) => `${x.el.className}:${x.a}:${x.d}`).slice(0, 8);
    });
    results.push({ name: `reduced-motion-${locale}`, animating: motion, still: motion.length === 0 });
    await context.close();
  }

  // 10. Keyboard: merchant's primary action reachable by Tab with a visible focus ring.
  {
    const { context, page } = await open({ width: 390, account: MERCHANT, init: posHint });
    await page.goto(`${BASE}/pay/${ID}`);
    await ready(page, '.journey-hero', 45000, 'edge-6');
    let reached = null;
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        const style = el ? getComputedStyle(el) : null;
        return { text: (el?.textContent ?? '').trim().slice(0, 40), ring: style ? style.outlineStyle !== 'none' || style.boxShadow !== 'none' : false };
      });
      if (/Verify receipt/.test(info.text)) {
        reached = { tabs: i + 1, ring: info.ring };
        break;
      }
    }
    results.push({ name: 'keyboard-primary-action', reached, ok: reached !== null && reached.ring });
    await context.close();
  }

  // 11. Live Handshake is not reachable: /s/<session> refuses, /demo/handshake is DEMO-stamped.
  {
    const { context, page } = await open({ width: 390 });
    await page.goto(`${BASE}/s/00000000-0000-4000-8000-000000000001`);
    await page.waitForTimeout(2500);
    const live = await audit(page, 'handshake-live-route-390', { screenshot: true, settle: 0 });
    await page.goto(`${BASE}/demo/handshake`);
    await ready(page, '[data-testid="room-demo"]', 15000, 'room-demo');
    const demo = await audit(page, 'handshake-demo-390', { settle: 600 });
    results.push({ name: 'handshake-gated', liveSaysPaid: live.saysVerifiedPaid, demoStamped: demo.mockStamp });
    await context.close();
  }
}

await browser.close();
const layoutFail = (r) => r.error || r.overflowPx > 0 || (r.unnamed && r.unnamed.length) || (r.small && r.small.length) || (r.repeated && r.repeated.length);
const summary = {
  base: BASE,
  configuredRpcHost: rpcHost,
  forwardedToArchival: [...forwarded],
  results,
  failures: results.filter((r) => layoutFail(r) || r.ok === false || r.still === false),
  rpcMethods: [...rpcMethods],
  broadcastAttempted: blocked,
  pageErrors,
};
writeFileSync(`${outDir}/${SUMMARY}`, JSON.stringify(summary, null, 2));
console.log(
  JSON.stringify(
    {
      audited: results.length,
      failures: summary.failures.map((f) => ({ name: f.name, error: f.error, overflowPx: f.overflowPx, unnamed: f.unnamed, small: f.small, repeated: f.repeated, ok: f.ok, still: f.still, animating: f.animating, retryControls: f.retryControls })),
      rpc: summary.rpcMethods,
      forwarded: summary.forwardedToArchival,
      broadcast: blocked,
      pageErrors,
      special: results.filter((r) => /switch|pruned|failure|reconnect|slow|reduced|keyboard|handshake|locator|single-retry/.test(r.name) && !/-(360|390|430|768|1280)$/.test(r.name)),
    },
    null,
    2,
  ),
);
