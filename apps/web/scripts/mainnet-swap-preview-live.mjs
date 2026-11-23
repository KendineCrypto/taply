// READ-ONLY real-browser check of a deployed Mainnet Preview against REAL NEAR Mainnet RPC.
// Usage: node apps/web/scripts/mainnet-swap-preview-live.mjs <playwright/index.mjs> <out-dir> <preview-origin>
// - Every request is fetched by Node (TLS verified by Node), only to the preview origin and the Mainnet RPC;
//   everything else is aborted.
// - A brand-new Taply Wallet is created in the browser. It holds no funds and nothing is signed: any send_tx is
//   aborted by the router below, so this script cannot spend.
// - It checks the live pool quote against an independent Node read of the same pool, the token sheet,
//   settings, Max/balance behaviour of an unfunded account, review gating and navigation, and takes
//   mobile, desktop and TR screenshots.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const OUT = process.argv[3], BASE = process.argv[4];
fs.mkdirSync(OUT, { recursive: true });
const HERE = path.dirname(fileURLToPath(import.meta.url));
const nc = await import(pathToFileURL(path.join(HERE, '../../../packages/near-client/dist/index.js')).href);
const shared = await import(pathToFileURL(path.join(HERE, '../../../packages/shared/dist/index.js')).href);
const RPC = 'rpc.mainnet.fastnear.com';
const results = []; const check = (n, ok, d = '') => { results.push({ name: n, ok: !!ok, detail: ok ? '' : String(d).slice(0, 300) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : ' — ' + d}`); };
const sends = [];
async function ctx(viewport, storageState) {
  const context = await chromium.launch().then((b) => b.newContext({ viewport, deviceScaleFactor: 2, isMobile: viewport.width < 800, hasTouch: viewport.width < 800, ...(storageState ? { storageState } : {}) }));
  await context.route('**/*', async (route) => {
    const req = route.request(); const u = new URL(req.url());
    if (u.origin !== new URL(BASE).origin && u.host !== RPC) return route.abort();
    const body = req.postData();
    if (u.host === RPC && body && /"method":"(send_tx|broadcast_tx_commit|broadcast_tx_async)"/.test(body)) { sends.push(body.slice(0, 80)); return route.abort(); }
    try {
      const r = await fetch(req.url(), { method: req.method(), headers: { ...req.headers(), 'accept-encoding': 'identity' }, body: req.postDataBuffer() ?? undefined, redirect: 'manual' });
      const buf = Buffer.from(await r.arrayBuffer());
      const headers = Object.fromEntries([...r.headers].filter(([k]) => !['content-encoding', 'content-length', 'transfer-encoding'].includes(k)));
      await route.fulfill({ status: r.status, headers, body: buf });
    } catch { await route.abort(); }
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  return { context, page, errors };
}
const shot = (p, n) => p.screenshot({ path: path.join(OUT, `${n}.png`) });
const text = async (p, id) => ((await p.getByTestId(id).first().textContent({ timeout: 20000 }).catch(() => '')) ?? '').trim();
const quoteReady = (p) => p.waitForFunction(() => /^[0-9]/.test(document.querySelector('[data-testid=swap-out]')?.textContent ?? '') && !/^0$/.test(document.querySelector('[data-testid=swap-out]')?.textContent ?? ''), null, { timeout: 45000 }).then(() => true, () => false);

// 1. No wallet: live quote, nav, token sheet, settings.
const { context: c1, page: p, errors } = await ctx({ width: 390, height: 844 });
await p.goto(`${BASE}/m/swap`, { waitUntil: 'networkidle' });
const nav = (await p.locator('nav[aria-label] a, nav[aria-label] button').allTextContents()).map((t) => t.trim());
check('preview nav: Wallet · Swap · Tap · Activity · Receive', ['Wallet', 'Swap', 'Tap', 'Activity', 'Receive'].every((l, i) => nav[i] === l), nav.join('|'));
check('no wallet: CTA "Connect a wallet"', (await text(p, 'swap-cta')) === 'Connect a wallet', await text(p, 'swap-cta'));
await p.getByTestId('swap-in').fill('0.1');
const okQ = await quoteReady(p);
const shown = await text(p, 'swap-out');
const st = await nc.createMainnetSwapReader({ network: 'near-mainnet', rpcUrl: `https://${RPC}`, rpcProviderId: 'fastnear-mainnet' }, 'DVJx7F3dHEHJYwpYPwXHu8K9Uo7h4kXFcALucY5oNX8q').read(null);
const q = await nc.quoteMainnetSwap(st.chain, st.pool, nc.MAINNET_WRAP, shared.MAINNET_USDC, (10n ** 23n).toString());
const ref = Number(q.expectedOut) / 1e6, ui = Number(shown.replace(',', '.'));
check('live pool quote shown for 0.1 NEAR and within 0.5 % of an independent Node read of pool 4512', okQ && Math.abs(ui - ref) / ref < 0.005, `ui ${shown} node ${ref} @${st.blockHeight}`);
await p.getByTestId('swap-summary').locator('summary').click();
check('details: minimum, impact, pool fee, Taply fee none, route', /Minimum received/.test(await p.getByTestId('swap-summary').textContent()) && /Taply fee\s*None/.test(await p.getByTestId('swap-summary').textContent()) && /pool #4512/.test(await p.getByTestId('swap-summary').textContent()));
await shot(p, 'preview-390-live-quote');
await p.getByTestId('token-usdc').click();
await p.getByTestId('token-search').fill('wrap.near');
check('token sheet: verified list, wNEAR by contract', (await p.locator('[data-testid=token-list] li').count()) === 1);
await p.getByTestId('token-search').fill('');
await shot(p, 'preview-390-token-sheet');
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
await p.getByTestId('swap-settings').click(); await p.waitForTimeout(300);
await shot(p, 'preview-390-settings');
await p.keyboard.press('Escape'); await p.waitForTimeout(400);

// 2. Fresh, unfunded Taply Wallet (created locally in this browser; holds nothing; nothing is signed).
await p.goto(`${BASE}/m/wallet/create`, { waitUntil: 'networkidle' });
await p.locator('#mw-pass').fill('preview-check-only-42');
await p.locator('#mw-pass2').fill('preview-check-only-42');
await p.getByTestId('wallet-create').click();
await p.waitForSelector('[data-testid=phrase-words]', { timeout: 30000 });
const words = await p.locator('[data-testid=phrase-words] li').evaluateAll((els) => els.map((e) => e.textContent.replace(/^\d+\.\s*/, '').trim()));
for (const input of await p.locator('[data-testid^=verify-]').all()) { const i = Number((await input.getAttribute('data-testid')).split('-')[1]); await input.fill(words[i]); }
await p.getByTestId('backup-done').click();
await p.goto(`${BASE}/m/swap`, { waitUntil: 'networkidle' });
await p.getByTestId('swap-in').fill('0.1');
await quoteReady(p);
await p.waitForFunction(() => /Insufficient NEAR/.test(document.querySelector('[data-testid=swap-cta]')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {});
check('unfunded new wallet: live quote still shown, CTA "Insufficient NEAR", "not active on Mainnet" explained, no Max', (await text(p, 'swap-cta')) === 'Insufficient NEAR' && /not active on NEAR Mainnet/.test(await text(p, 'swap-error')) && (await p.getByTestId('swap-max').count()) === 0, `${await text(p, 'swap-cta')} | ${await text(p, 'swap-error')}`);
check('review cannot be opened without funds', await p.getByTestId('swap-cta').isDisabled());
await shot(p, 'preview-390-unfunded-wallet');
// Activity and other flows still render on the preview.
for (const [route, needle] of [['/m/wallet', 'Taply Wallet'], ['/m/request/new', 'Request'], ['/m/gift/new', 'Gift'], ['/m/activity', 'Activity'], ['/m/receive', 'Receive']]) {
  await p.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
  check(`${route} renders on the preview`, (await p.locator('main').innerText()).includes(needle));
}
const state = await c1.storageState();
await c1.close();

// 3. Desktop and TR screenshots of the live quote.
for (const [label, vp, locale] of [['1280', { width: 1280, height: 900 }, 'en'], ['390-tr', { width: 390, height: 844 }, 'tr']]) {
  const host = new URL(BASE).hostname;
  const s = locale === 'tr' ? { ...state, cookies: [...state.cookies, { name: 'taply_locale', value: 'tr', domain: host, path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'Lax' }] } : state;
  const { context, page } = await ctx(vp, s);
  await page.goto(`${BASE}/m/swap`, { waitUntil: 'networkidle' });
  await page.getByTestId('swap-in').fill(locale === 'tr' ? '0,25' : '0.25');
  await quoteReady(page);
  if (label === '1280') { const box = await page.getByTestId('swap-page').boundingBox(); check('desktop: 440–480 px swap column', box && box.width >= 440 && box.width <= 480, box?.width); }
  if (locale === 'tr') check('TR: "Takas" and comma decimals on the preview', /Takas/.test(await page.locator('main').innerText()) && /,/.test(await text(page, 'swap-out')));
  await shot(page, `preview-${label}-live-quote`);
  await context.close();
}
check('no transaction was sent (router saw no send_tx)', sends.length === 0, sends.join(';'));
check('no page errors', errors.length === 0, errors.join(' | '));
fs.writeFileSync(path.join(OUT, 'preview-live-results.json'), JSON.stringify({ base: BASE, readOnly: true, poolBlock: st.blockHeight, results }, null, 2));
const failed = results.filter((r) => !r.ok); console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
