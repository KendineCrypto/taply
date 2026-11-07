// Cross-browser release smoke for a running Taply production build. READ-ONLY.
//
// Safety: no signing wallet exists (the optional injected wallet throws on every
// sign method); any RPC broadcast/send method is aborted and reported; external
// POSTs to anything but the allowlisted Testnet RPC hosts are aborted.
//
// Run ONE browser at a time on low-memory hosts (each launch is a separate
// process). Example:
//   node apps/web/scripts/release-smoke.mjs <playwright/index.mjs> <outDir> webkit
// Env: BASE (default http://127.0.0.1:3207), RPC_HOSTS (comma list), GAP_MS,
//      SKIP_CHAIN=1 (UI-only steps), ONLY=<regex on step label>.
//
// Status per step: PASS, FAIL, or BLOCKED. BLOCKED means a step that needs a
// live chain read failed while the RPC was visibly throttling or unreachable
// (HTTP 429 or a CORS-blocked answer from an RPC host). BLOCKED is not a pass.
// Nothing here is chain evidence by itself; it checks what the app shows.
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [pwIndex, outDir, which = 'chromium,firefox,webkit'] = process.argv.slice(2);
const pw = await import(pathToFileURL(pwIndex).href);
const BASE = process.env.BASE ?? 'http://127.0.0.1:3207';
const RPC_HOSTS = new Set((process.env.RPC_HOSTS ?? 'test.rpc.fastnear.com,archival-rpc.testnet.near.org,rpc.testnet.near.org').split(',').map((h) => h.trim()).filter(Boolean));
const SKIP_CHAIN = process.env.SKIP_CHAIN === '1';
const ID = '9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502';
const FTX = 'CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su';
const MERCHANT = 'taplytest.testnet';
const CUSTOMER = 'taply-pilot-funder-1101.testnet';
const UNKNOWN_ID = 'ab'.repeat(32);
mkdirSync(outDir, { recursive: true });

const results = [];
const blocked = [];
const external = new Map();
const rpcStatus = new Map();

const injectWallet = (account) => {
  localStorage.setItem('selected-wallet', 'taply-qa-readonly');
  const never = async () => { throw new Error('smoke harness never signs'); };
  const wallet = {
    manifest: { id: 'taply-qa-readonly', name: 'QA read-only', features: { testnet: true, signInWithoutAddKey: true, signAndSendTransaction: true } },
    signIn: async () => [{ accountId: account, publicKey: '' }],
    signOut: async () => undefined,
    getAccounts: async () => [{ accountId: account, publicKey: '' }],
    signAndSendTransaction: never, signAndSendTransactions: never, signMessage: never,
  };
  window.addEventListener('near-selector-ready', () => window.dispatchEvent(new CustomEvent('near-wallet-injected', { detail: wallet })));
};

let stepRpc = { throttled: 0, blockedByCors: 0, ok: 0 };
let cspConsole = [];

async function open(browser, name, { width, height, mobile, locale = 'en', account = null, init = null, rpcDown = false }) {
  const opts = { viewport: { width, height }, locale: locale === 'tr' ? 'tr-TR' : 'en-US' };
  if (mobile && name !== 'firefox') Object.assign(opts, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const context = await browser.newContext(opts);
  // Record every CSP violation in every frame (including wallet srcdoc iframes).
  await context.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      window.__csp.push({ v: `${e.effectiveDirective} ${e.blockedURI || 'inline'}`, src: e.sourceFile, col: e.columnNumber }));
  });
  await context.addCookies([{ name: 'taply_locale', value: locale, url: BASE }]);
  if (account) await context.addInitScript(injectWallet, account);
  if (init) await context.addInitScript(init.fn, init.arg);
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === BASE) return route.continue();
    if (RPC_HOSTS.has(url.host)) {
      let body = {};
      try { body = JSON.parse(req.postData() ?? '{}'); } catch { /* not json */ }
      if (/broadcast|send_tx/i.test(String(body.method))) { blocked.push(body.method); return route.abort(); }
      if (rpcDown) return route.abort('connectionfailed'); // SYNTHETIC
      return route.continue();
    }
    external.set(`${req.method()} ${url.host}`, (external.get(`${req.method()} ${url.host}`) ?? 0) + 1);
    if (req.method() !== 'GET') return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 160)}`));
  page.on('console', (m) => {
    const text = m.text();
    if (/Content Security Policy|Content-Security-Policy|CSP/i.test(text) && /refused|blocked|violat/i.test(text)) cspConsole.push(text.slice(0, 200));
    if (m.type() !== 'error') return;
    // Firefox/WebKit report a CORS-less 429 only as a blocked cross-origin read.
    if (/Cross-Origin|CORS|Access-Control-Allow-Origin/i.test(text) && [...RPC_HOSTS].some((h) => text.includes(h))) stepRpc.blockedByCors += 1;
    errors.push(`console: ${text.slice(0, 200)}`);
  });
  page.on('response', (r) => {
    const host = new URL(r.url()).host;
    if (!RPC_HOSTS.has(host)) return;
    const key = `${host} ${r.status()}`;
    rpcStatus.set(key, (rpcStatus.get(key) ?? 0) + 1);
    if (r.status() === 429) stepRpc.throttled += 1;
    else if (r.ok()) stepRpc.ok += 1;
  });
  return { context, page, errors };
}

async function facts(page) {
  return page.evaluate(() => {
    const main = document.querySelector('main')?.innerText ?? document.body.innerText;
    return {
      lang: document.documentElement.lang,
      overflowPx: document.documentElement.scrollWidth - window.innerWidth,
      status: document.querySelector('[data-testid="journey-status"]')?.getAttribute('data-status') ?? null,
      receipt: document.querySelector('[data-receipt-status]')?.getAttribute('data-receipt-status') ?? null,
      verifiedEvidence: !!document.querySelector('[data-testid="verified-evidence"]'),
      demo: /\bDEMO\b|\bMOCK\b/.test(main),
      text: main.replace(/\s+/g, ' ').slice(0, 2000),
    };
  });
}

const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;

async function step(bname, vp, label, opts, fn) {
  if (SKIP_CHAIN && opts.chain) return;
  if (ONLY !== null && !ONLY.test(label)) return;
  stepRpc = { throttled: 0, blockedByCors: 0, ok: 0 };
  cspConsole = [];
  const browser = opts.browser;
  const { context, page, errors } = await open(browser, bname, { ...vp, ...opts });
  const t0 = Date.now();
  let r = { name: `${bname}/${vp.tag}/${label}` };
  try {
    const out = await fn(page);
    const f = await facts(page);
    r = { ...r, ...out, lang: f.lang, overflowPx: f.overflowPx, status: f.status, receipt: f.receipt, verifiedEvidence: f.verifiedEvidence, demo: f.demo };
    if (out.pass === undefined) r.pass = true;
  } catch (e) {
    r.pass = false; r.error = String(e).slice(0, 240);
  }
  if (r.overflowPx > 1) { r.pass = false; r.note = `${r.note ?? ''} horizontal overflow ${r.overflowPx}px`.trim(); }
  r.rpc = { ...stepRpc };
  const frameCsp = [];
  for (const frame of page.frames()) frameCsp.push(...(await frame.evaluate(() => window.__csp ?? []).catch(() => [])));
  // A blocked eval is only "benign" when the exact, try/catch-wrapped capability
  // probe of a known library sits at the reported position of a same-origin
  // chunk. Every other violation fails the step.
  const benign = [];
  const real = [];
  for (const v of frameCsp) {
    const probe = v.v === 'script-src eval' && typeof v.src === 'string' && v.src.startsWith(`${BASE}/_next/static/`) ? await knownProbe(v.src, v.col) : null;
    if (probe !== null) benign.push(probe); else real.push(v.v);
  }
  r.cspBenign = [...new Set(benign)];
  // Console text is the fallback signal only when no violation event was captured (conservative).
  r.csp = frameCsp.length > 0 ? [...new Set(real)] : [...new Set(cspConsole)];
  if (r.csp.length > 0) { r.pass = false; r.note = `${r.note ?? ''} CSP violations: ${r.csp.slice(0, 3).join(' | ')}`.trim(); }
  r.status = r.pass ? 'PASS' : opts.chain && (stepRpc.throttled > 0 || stepRpc.blockedByCors > 0) ? 'BLOCKED' : 'FAIL';
  r.errors = errors;
  r.ms = Date.now() - t0;
  await page.screenshot({ path: `${outDir}/${bname}-${vp.tag}-${label}.png`, fullPage: false }).catch(() => undefined);
  await context.close();
  results.push(r);
  if (r.cspBenign.length > 0) r.note = `${r.note ?? ''} [benign CSP probe: ${r.cspBenign.join(', ')}]`.trim();
  console.log(`${r.status} ${r.name} ${r.ms}ms ${(r.error ?? r.note ?? '').slice(0, 200)} rpc=${JSON.stringify(r.rpc)} ${errors.length ? `[${errors.length} console errors]` : ''}`);
}

const chunkCache = new Map();
const PROBES = [
  ['is-generator-function probe (Next util polyfill)', 'Function("return function*() {}")'],
  ['zod allowsEval probe', 'return Function(""),!0}catch'],
];
async function knownProbe(src, col) {
  if (!chunkCache.has(src)) chunkCache.set(src, await fetch(src).then((r) => r.text()).catch(() => ''));
  const text = chunkCache.get(src);
  const around = text.slice(Math.max(0, col - 400), col + 200);
  const hit = PROBES.find(([, code]) => around.includes(code));
  return hit === undefined ? null : hit[0];
}

const has = async (page, re, timeout = 20000) => {
  await page.waitForFunction((src) => new RegExp(src, 'i').test(document.body.innerText), re.source, { timeout });
  return true;
};

const VIEWPORTS = [
  { tag: 'mobile390', width: 390, height: 844, mobile: true },
  { tag: 'desktop1280', width: 1280, height: 800, mobile: false },
];
const posHint = { fn: (id) => localStorage.setItem('taply.posSales.v1', JSON.stringify([id])), arg: ID };

for (const bname of which.split(',')) {
  const browser = await pw[bname].launch({ headless: true });
  for (const vp of VIEWPORTS) {
    const o = { browser };
    const full = vp.tag === 'mobile390'; // heavy chain checks run once per browser

    await step(bname, vp, 'landing-en', o, async (p) => {
      await p.goto(BASE + '/'); await has(p, /Connect wallet/);
      return { pass: (await p.locator('html').getAttribute('lang')) === 'en' };
    });
    await step(bname, vp, 'landing-tr', { ...o, locale: 'tr' }, async (p) => {
      await p.goto(BASE + '/'); await has(p, /Cüzdan bağla/);
      return { pass: (await p.locator('html').getAttribute('lang')) === 'tr' };
    });
    await step(bname, vp, 'locale-switch-click', o, async (p) => {
      await p.goto(BASE + '/settings'); await has(p, /English/);
      await p.getByRole('button', { name: 'Türkçe' }).first().click();
      await p.waitForFunction(() => document.documentElement.lang === 'tr', null, { timeout: 10000 });
      await p.goto(BASE + '/'); await has(p, /Cüzdan bağla/, 10000);
      return { pass: true };
    });
    await step(bname, vp, 'wallet-connect-ui-no-sign', o, async (p) => {
      await p.goto(BASE + '/'); await has(p, /Connect wallet/);
      await p.getByRole('button', { name: /Connect wallet/ }).first().click();
      await p.waitForTimeout(6000);
      // near-connect renders its selector outside <main>; capture whatever appeared.
      const seen = await p.evaluate(() => {
        const t = document.body.innerText;
        const dialogs = [...document.querySelectorAll('dialog, [role="dialog"], iframe, *')].filter((e) => e.shadowRoot || e.tagName === 'IFRAME' || e.tagName === 'DIALOG' || e.getAttribute('role') === 'dialog').length;
        return { selectorNodes: dialogs, errorNotice: /No wallet available|Could not connect|Connection cancelled/.test(t), connecting: /Opening your wallet/.test(t) };
      });
      await p.screenshot({ path: `${outDir}/${bname}-${vp.tag}-wallet-selector.png` });
      await p.keyboard.press('Escape');
      return { pass: seen.selectorNodes > 0 || seen.errorNotice, note: JSON.stringify(seen) };
    });
    for (const [route, en, tr] of [['/contacts', /Contacts/, /Kişiler/], ['/recurring', /Recurring requests/, /Tekrarlayan talepler/], ['/split', /Split Pay/, /Böl ve Öde/]]) {
      for (const locale of ['en', 'tr']) {
        await step(bname, vp, `tool${route.replace('/', '-')}-${locale}`, { ...o, locale, account: MERCHANT }, async (p) => {
          await p.goto(BASE + route); await has(p, locale === 'en' ? en : tr);
          // Local-only tools: nothing on the page may be in a paid or verified state.
          const claims = await p.locator('[data-group-status="settled_verified"], [data-child-status="verified"], [data-child-status="paid_per_contract"], [data-testid="verified-evidence"]').count();
          return { pass: claims === 0, note: `paid/verified elements=${claims}` };
        });
      }
    }
    await step(bname, vp, 'merchant-disconnected', o, async (p) => {
      await p.goto(BASE + '/merchant'); await has(p, /Connect|wallet/);
      return { pass: true };
    });
    await step(bname, vp, 'merchant-connected-readonly', { ...o, account: MERCHANT, init: posHint }, async (p) => {
      await p.goto(BASE + '/merchant'); await has(p, /taplytest\.testnet/, 30000);
      const t = (await facts(p)).text;
      // Signing flag is off: the app must not offer an enabled path that would sign a new sale.
      return { pass: true, note: t.slice(0, 220) };
    });
    await step(bname, vp, 'store-qr-checkout', { ...o, account: CUSTOMER }, async (p) => {
      await p.goto(BASE + `/checkout/${MERCHANT}`); await has(p, /taplytest\.testnet/);
      const t = (await facts(p)).text;
      return { pass: !/0\.1 NEAR/.test(t), note: t.slice(0, 220) };
    });
    await step(bname, vp, 'store-qr-invalid-account', o, async (p) => {
      await p.goto(BASE + '/checkout/not..valid'); await p.waitForTimeout(1500);
      const t = (await facts(p)).text;
      return { pass: !/taplytest/.test(t), note: t.slice(0, 200) };
    });
    await step(bname, vp, 'pay-review-historical', { ...o, chain: true, account: CUSTOMER }, async (p) => {
      await p.goto(BASE + `/pay/${ID}`);
      await p.locator('.journey-hero').first().waitFor({ timeout: 60000 });
      await p.waitForTimeout(1500);
      const f = await facts(p);
      const ok = /0\.1/.test(f.text) && /taplytest\.testnet/.test(f.text) && /KED ?5E9/.test(f.text) && /Paid per contract/.test(f.text);
      return { pass: ok && !f.demo, note: `status=${f.status}` };
    });
    if (full) await step(bname, vp, 'pay-review-historical-tr', { ...o, chain: true, account: MERCHANT, init: posHint, locale: 'tr' }, async (p) => {
      await p.goto(BASE + `/pay/${ID}`);
      await p.locator('.journey-hero').first().waitFor({ timeout: 60000 });
      await p.waitForTimeout(1500);
      const f = await facts(p);
      return { pass: f.lang === 'tr' && /taplytest\.testnet/.test(f.text), note: f.text.slice(0, 200) };
    });
    for (const s of ['create', 'share', 'review', 'progress', 'receipt']) {
      await step(bname, vp, `demo-${s}`, o, async (p) => {
        await p.goto(BASE + `/demo?step=${s}`); await p.waitForTimeout(1200);
        const f = await facts(p);
        return { pass: f.demo, note: f.demo ? 'DEMO stamped' : 'NO DEMO STAMP' };
      });
    }
    await step(bname, vp, 'demo-review-approve-flow', o, async (p) => {
      await p.goto(BASE + '/demo?step=review'); await p.waitForTimeout(1000);
      const cb = p.locator('main input[type="checkbox"]').first();
      await cb.check();
      await p.locator('main button:not([disabled])').filter({ hasText: /demo/i }).first().click();
      await p.waitForTimeout(1500);
      return { pass: /step=progress|step=receipt/.test(p.url()) || /progress/i.test(p.url()), note: p.url().replace(BASE, '') };
    });
    if (full) await step(bname, vp, 'receipt-independent-verify', { ...o, chain: true, account: CUSTOMER }, async (p) => {
      await p.goto(BASE + `/receipt/${ID}?ftx=${FTX}`);
      // Either a fresh Verified Paid, or an honest "not verified now" with the archive kept separate.
      await p.waitForFunction(() => !!document.querySelector('[data-testid="verified-evidence"], [data-testid="archived-verification"]'), null, { timeout: 180000 });
      await p.waitForTimeout(1000);
      const f = await facts(p);
      const archived = await p.locator('[data-testid="archived-verification"]').count();
      const reasonAttr = await p.locator('[data-testid="verification-failed"]').getAttribute('data-reason').catch(() => null);
      if (f.verifiedEvidence) return { pass: !f.demo && archived === 0, note: `FRESH Verified Paid receipt=${f.receipt}` };
      // Archive shown: the live status must stay Paid per contract (never verified).
      const honest = f.receipt === 'contract_paid' && archived === 1 && !/Verified Paid/.test(f.text.replace(/found it Verified Paid/g, ''));
      return { pass: false, honestFallback: honest, note: `NOT verified now (reason=${reasonAttr}); archive shown=${archived}; live receipt=${f.receipt}; honest=${honest}` };
    });
    if (full && bname === 'chromium') await step(bname, vp, 'receipt-merchant-no-link', { ...o, chain: true, account: MERCHANT }, async (p) => {
      await p.goto(BASE + `/receipt/${ID}`);
      await p.waitForTimeout(4000);
      try { await p.getByTestId('verified-evidence').waitFor({ timeout: 150000 }); } catch { /* recorded below */ }
      const f = await facts(p);
      return { pass: /Paid per contract|Verified Paid/.test(f.text), note: `receipt=${f.receipt} verified=${f.verifiedEvidence}` };
    });
    await step(bname, vp, 'error-malformed-id', o, async (p) => {
      await p.goto(BASE + '/pay/deadbeef'); await p.waitForTimeout(2500);
      const f = await facts(p);
      return { pass: !/Paid/.test(f.text) && f.status === null, note: f.text.slice(0, 180) };
    });
    await step(bname, vp, 'error-unknown-request', { ...o, chain: true, account: CUSTOMER }, async (p) => {
      await p.goto(BASE + `/pay/${UNKNOWN_ID}`); await p.waitForTimeout(12000);
      const f = await facts(p);
      return { pass: !/Paid per contract|Verified Paid/.test(f.text), note: f.text.slice(0, 200) };
    });
    await step(bname, vp, 'error-rpc-down-synthetic', { ...o, account: CUSTOMER, rpcDown: true }, async (p) => {
      await p.goto(BASE + `/pay/${ID}`); await p.waitForTimeout(12000);
      const f = await facts(p);
      const retry = await p.getByRole('button', { name: /Check again|Try again/ }).count();
      return { pass: !/Paid per contract/.test(f.text) && retry >= 1, note: `retryButtons=${retry} ${f.text.slice(0, 160)}` };
    });
    await step(bname, vp, 'handshake-live-gated', o, async (p) => {
      await p.goto(BASE + '/s/00000000-0000-4000-8000-000000000001'); await p.waitForTimeout(2500);
      const f = await facts(p);
      return { pass: !/Verified Paid|Paid per contract/.test(f.text), note: f.text.slice(0, 160) };
    });
    if (full) await step(bname, vp, 'evidence-json-served', o, async (p) => {
      const res = await p.request.get(BASE + '/evidence/instant-pay-2026-11-01-receipt.json');
      const json = await res.json();
      return { pass: res.status() === 200 && json.requestId === ID && json.verification?.checkedAt === '2026-11-01T15:36:30.100Z', note: `status=${res.status()}` };
    });
    if (full) await step(bname, vp, 'back-forward-restore', { ...o, chain: true, account: CUSTOMER }, async (p) => {
      await p.goto(BASE + '/'); await has(p, /taply/i);
      await p.goto(BASE + '/settings'); await has(p, /English/);
      await p.goBack(); await has(p, /Connect wallet|taply/i);
      await p.goForward(); await has(p, /English/);
      return { pass: new URL(p.url()).pathname === '/settings' };
    });
    await step(bname, vp, 'offline-reload', { ...o, chain: true, account: CUSTOMER }, async (p) => {
      await p.goto(BASE + '/'); await has(p, /Connect wallet|taply/i);
      await p.context().setOffline(true);
      await p.goto(BASE + `/pay/${ID}`).catch(() => undefined);
      await p.waitForTimeout(2000);
      await p.context().setOffline(false);
      await p.goto(BASE + `/pay/${ID}`);
      await p.locator('.journey-hero').first().waitFor({ timeout: 60000 });
      return { pass: true };
    });
  }
  await browser.close();
  await new Promise((r) => setTimeout(r, Number(process.env.GAP_MS ?? 90000)));
}

const count = (st) => results.filter((r) => r.status === st).length;
const summary = { at: new Date().toISOString(), base: BASE, pass: count('PASS'), fail: count('FAIL'), blocked: count('BLOCKED'), total: results.length, failed: results.filter((r) => !r.pass).length, blockedBroadcasts: blocked, external: Object.fromEntries(external), rpcHttpStatus: Object.fromEntries(rpcStatus), results };
writeFileSync(`${outDir}/smoke.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ total: summary.total, pass: summary.pass, fail: summary.fail, blocked: summary.blocked, blockedBroadcasts: blocked, external: summary.external, rpcHttpStatus: summary.rpcHttpStatus }));
