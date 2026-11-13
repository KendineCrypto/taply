// Real-browser QA of the mainnet PREVIEW build in fixture mode (docs/MAINNET_1CLICK_INTEGRATION.md §8).
// Usage: node apps/web/scripts/mainnet-1click-qa.mjs <playwright/index.mjs> <out-dir> [base-url]
// Start the build first: env/mainnet.env.example + VERCEL_ENV=preview, empty contract ids,
// NEXT_PUBLIC_TAPLY_MAINNET_FIXTURES=on, TAPLY_ONECLICK_MODE=fixture, `pnpm build:mainnet && next start -p 3103`.
// No funds, no signing; the only requests are to the local server (plus near-connect's wallet manifest).
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const OUT = process.argv[3];
const BASE = process.argv[4] ?? 'http://127.0.0.1:3103';
fs.mkdirSync(OUT, { recursive: true });
const LEAKS = ['taply-e2e-ce38a238', 'taply-pay-pilot-1.testnet', 'rpc.testnet.near.org', 'test.rpc.fastnear.com', 'archival-rpc.testnet',
  'testnet.nearblocks.io', 'FWJ9kR6KFWoyMoNjpLXXGHeuiy7tEY6GmoFeCA5yuc6b', '963iSEB8XFKeUMY1gmj5bCuA2JMVD55ksjdLfCwiPA84',
  'BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B', 'taply.testnet-vault.v1', '"abandon","ability"', 'faucet'];
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' — ' + detail}`); };

(async () => {
  const browser = await chromium.launch();
  const scripts = new Map();
  const hosts = new Set();
  const consoleErrors = [];
  async function run(label, contextOptions, locale) {
    const context = await browser.newContext(contextOptions);
    if (locale) await context.addCookies([{ name: 'taply_locale', value: locale, url: BASE }]);
    const page = await context.newPage();
    page.on('request', (r) => hosts.add(new URL(r.url()).host));
    page.on('response', async (r) => {
      if (r.request().resourceType() === 'script' || r.url().includes('/_next/static/')) {
        try { scripts.set(r.url(), await r.text()); } catch {}
      }
    });
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${label}: ${m.text()}`); });

    await page.goto(`${BASE}/`);
    check(`${label}: / redirects to /m`, new URL(page.url()).pathname === '/m');
    const pill = await page.getByTestId('network-pill').textContent();
    check(`${label}: network pill`, pill.includes('NEAR Mainnet'), pill);
    const banner = await page.locator('header [role=note]').first().textContent();
    check(`${label}: real funds / unaudited / cap banner`, locale === 'tr' ? /gerçek para/.test(banner) && /25 USDC/.test(banner) : /real funds/.test(banner) && /unaudited/.test(banner) && /25 USDC/.test(banner), banner);
    check(`${label}: fixture banner`, await page.getByTestId('fixture-banner').isVisible());
    await page.screenshot({ path: `${OUT}/${label}-01-home.png`, fullPage: true });

    // Customer: USDC request -> Base USDC -> verified quote review
    await page.getByTestId('fixture-list').getByText('usdc-awaiting').click();
    await page.waitForSelector('[data-testid=pay-amount]');
    check(`${label}: exact USDC amount`, (await page.getByTestId('pay-amount').textContent()).replace(',', '.') === '12.5 USDC');
    check(`${label}: awaiting state`, (await page.locator('[data-state]').getAttribute('data-state')) === 'AWAITING_PAYMENT');
    check(`${label}: verified unavailable note`, await page.getByTestId('verified-unavailable').isVisible());
    await page.getByTestId('method-base').click();
    await page.locator('#refund').fill('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD');
    await page.locator('#refund').blur();
    check(`${label}: checksum error blocks quote`, await page.getByTestId('get-quote').isDisabled());
    await page.locator('#refund').fill('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
    await page.screenshot({ path: `${OUT}/${label}-02-base-usdc.png`, fullPage: true });
    await page.getByTestId('get-quote').click();
    await page.waitForSelector('[data-testid=quote-review]', { timeout: 15000 });
    const review = await page.getByTestId('quote-review').textContent();
    check(`${label}: quote review shows exact principal`, /12[.,]5 USDC/.test(review), review.slice(0, 200));
    check(`${label}: quote review shows Base amount with buffer`, review.includes('12.628863'), review.slice(0, 300));
    check(`${label}: deposit address withheld`, await page.getByTestId('deposit-withheld').isVisible());
    check(`${label}: no 0x deposit address rendered`, !/0x[0-9a-fA-F]{40}/.test(review.replace(/0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed/gi, '')), review);
    await page.screenshot({ path: `${OUT}/${label}-03-quote-review.png`, fullPage: true });

    // Duplicate active quote with a different refund address is refused by the server.
    const dup = await page.evaluate(async (id) => {
      const r = await fetch('/api/mainnet/oneclick/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: id, originAsset: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', refundTo: '0x3333333333333333333333333333333333333333' }) });
      return { status: r.status, body: await r.json() };
    }, page.url().split('/').pop());
    check(`${label}: duplicate active quote refused`, dup.status === 409 && dup.body.error === 'ACTIVE_QUOTE_EXISTS', JSON.stringify(dup));

    for (const [name, state] of [['usdc-recorded', 'PAYMENT_RECORDED'], ['usdc-refunded', 'REFUNDED'], ['usdc-r2-unknown', 'UNKNOWN'], ['usdc-deposit-seen', 'DEPOSIT_OBSERVED'], ['usdc-failed', 'FAILED']]) {
      await page.goto(`${BASE}/m`);
      await page.getByTestId('fixture-list').getByText(name, { exact: true }).click();
      await page.waitForSelector('[data-state]');
      await page.waitForFunction((s) => document.querySelector('[data-state]')?.getAttribute('data-state') === s, state, { timeout: 15000 }).catch(() => {});
      const got = await page.locator('[data-state]').getAttribute('data-state');
      check(`${label}: ${name} -> ${state}`, got === state, got);
      if (name === 'usdc-recorded' || name === 'usdc-r2-unknown') {
        check(`${label}: ${name} says do not pay again`, await page.getByTestId('do-not-repay').isVisible());
        await page.screenshot({ path: `${OUT}/${label}-04-${name}.png`, fullPage: true });
      }
      check(`${label}: ${name} never shows Verified`, (await page.locator('[data-state]').getAttribute('data-state')) !== 'VERIFIED');
    }

    // Merchant: create a USDC request; cap enforced; review shows unsigned create_request; signing disabled.
    await page.goto(`${BASE}/m/request/new`);
    await page.locator('#amount').fill('30');
    check(`${label}: USDC cap enforced`, await page.locator('p[role=alert]').isVisible());
    await page.locator('#amount').fill('12.50');
    await page.locator('#memo').fill('Table 7');
    await page.screenshot({ path: `${OUT}/${label}-05-create.png`, fullPage: true });
    await page.getByRole('button', { name: /Review request|Talebi incele/ }).click();
    await page.locator('details summary').first().click();
    const call = JSON.parse(await page.getByTestId('call-preview').first().textContent());
    check(`${label}: create_request candidate on the contract with exact terms`, call.methodName === 'create_request' && call.args.terms.amountBaseUnits === '12500000' && call.args.terms.network === 'near-mainnet', JSON.stringify(call).slice(0, 200));
    check(`${label}: sign button disabled`, await page.getByRole('button', { name: /Sign with wallet|Cüzdanla imzala/ }).isDisabled());
    await page.screenshot({ path: `${OUT}/${label}-06-create-review.png`, fullPage: true });
    await context.close();
  }

  await run('mobile-390', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await run('desktop-1280', { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await run('mobile-tr', { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, 'tr');

  // Leak scan over every script the browser actually loaded on the mainnet surface.
  // Two inert strings are classified explicitly instead of hidden:
  //  - the Testnet code hashes inside @taply/near-client MainnetProfileSchema's
  //    deny-list (a guard that REFUSES them on mainnet);
  //  - TESTNET_GENESIS_HASH exported by @taply/near-client's shared rpc module
  //    (bundled with createRpc; never used by createMainnetReader). Change
  //    request to Codex: move it out of rpc.ts so a mainnet bundle omits it.
  const DENY_LIST = /\["11111111111111111111111111111111","963iSEB8XFKeUMY1gmj5bCuA2JMVD55ksjdLfCwiPA84","BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B"\]\.includes\(/;
  const found = [];
  const residual = [];
  for (const [url, body] of scripts) {
    const name = url.split('/').pop();
    const stripped = body.replace(DENY_LIST, '[DENY_LIST].includes(');
    for (const leak of LEAKS) {
      if (!stripped.includes(leak)) continue;
      if (leak === 'FWJ9kR6KFWoyMoNjpLXXGHeuiy7tEY6GmoFeCA5yuc6b' && /"FWJ9kR6KFWoyMoNjpLXXGHeuiy7tEY6GmoFeCA5yuc6b","t",0,function/.test(body)) residual.push(`TESTNET_GENESIS_HASH export (near-client rpc module) in ${name}`);
      else found.push(`${leak} in ${name}`);
    }
  }
  check(`leak scan over ${scripts.size} loaded scripts: no Testnet RPC, contract, code hash, receipt endpoint or mnemonic vault`, found.length === 0, found.join('; '));
  for (const r of residual) console.log(`KNOWN RESIDUAL  ${r}`);
  const external = [...hosts].filter((h) => h !== new URL(BASE).host);
  console.log(`INFO  external hosts contacted by the browser: ${external.join(', ') || 'none'}`);
  check('browser never contacts 1Click or an RPC (quotes are server-side; fixture mode reads no chain)', !external.some((h) => /chaindefuser|rpc|fastnear|near\.org/.test(h)), external.join(', '));
  check('only external host is the near-connect wallet manifest (raw.githubusercontent.com) or none', external.every((h) => h === 'raw.githubusercontent.com'), external.join(', '));
  const unexpected = consoleErrors.filter((e) => !e.includes('409'));
  check('no console errors except the deliberate 409 duplicate-quote probe', unexpected.length === 0, unexpected.slice(0, 5).join(' | '));
  fs.writeFileSync(`${OUT}/qa-results.json`, JSON.stringify({ base: BASE, results, scripts: scripts.size, hosts: [...hosts], consoleErrors, residual }, null, 2));
  await browser.close();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
