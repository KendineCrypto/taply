// Real-browser QA of the phase 2 Mainnet parity work (docs/MAINNET_PARITY_MATRIX.md).
// Usage: node apps/web/scripts/mainnet-parity-phase2-qa.mjs <playwright/index.mjs> <out-dir> [base-url]
// Requires a mainnet PREVIEW build in fixture mode with NEXT_PUBLIC_TAPLY_FLAG_HANDSHAKE=on
// and a room store (local: redis-server + scripts/redis-rest-shim.mjs). No funds, no signing.
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const OUT = process.argv[3];
const BASE = process.argv[4] ?? 'http://127.0.0.1:3120';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: ok ? '' : String(detail).slice(0, 300) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' — ' + detail}`); };
const LEAKS = ['taply-e2e-ce38a238', 'taply-pay-pilot-1.testnet', 'rpc.testnet.near.org', 'test.rpc.fastnear.com', 'testnet.nearblocks.io', 'taply.testnet-vault.v1', '/api/handshake/rooms'];
const SOLANA_WALLET = 'US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx'; // base58 of 32 bytes (synthetic)

const browser = await chromium.launch();
const scripts = new Map();
const consoleErrors = [];
async function ctx(label, opts = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...opts });
  const page = await context.newPage();
  page.on('response', async (r) => { if (r.url().includes('/_next/static/') && r.url().endsWith('.js')) { try { scripts.set(r.url(), await r.text()); } catch {} } });
  page.on('console', (m) => { if (m.type() === 'error' && !/409|404/.test(m.text())) consoleErrors.push(`${label}: ${m.text()}`); });
  return { context, page };
}
const fixtureId = async (page, name) => {
  await page.goto(`${BASE}/m`);
  const href = await page.getByTestId('fixture-list').getByText(name, { exact: true }).locator('xpath=ancestor::a').getAttribute('href');
  return href.split('/').pop();
};

// 1. Live Handshake across two browsers (separate contexts = separate devices).
const merchant = await ctx('merchant');
const customer = await ctx('customer', { viewport: { width: 360, height: 780 } });
const id = await fixtureId(merchant.page, 'usdc-awaiting');
await merchant.page.goto(`${BASE}/m/pay/${id}`);
await merchant.page.getByTestId('live-start').click();
await merchant.page.waitForSelector('[data-testid=live-link]');
const link = (await merchant.page.getByTestId('live-link').textContent()).trim();
check('merchant gets a /m/s/<room>#j= session link', /\/m\/s\/[A-Za-z0-9_-]{22}#j=[A-Za-z0-9_-]{22,64}$/.test(link), link);
const merchantCode = (await merchant.page.getByTestId('live-code').textContent()).trim();
check('merchant shows "waiting for customer"', /Waiting/.test(await merchant.page.getByTestId('live-customer').textContent()));
await merchant.page.screenshot({ path: `${OUT}/live-01-merchant-qr.png`, fullPage: true });
await customer.page.goto(link.replace(/^https?:\/\/[^/]+/, BASE));
await customer.page.waitForSelector('[data-testid=live-customer-banner]', { timeout: 20000 });
check('join secret removed from the customer address bar', !customer.page.url().includes('#j='), customer.page.url());
const customerCode = (await customer.page.getByTestId('live-code').textContent()).trim();
check('both screens show the same comparison code', customerCode === merchantCode && /^[A-Z0-9]{3} [A-Z0-9]{3}$/.test(customerCode), `${merchantCode} vs ${customerCode}`);
await customer.page.waitForSelector('[data-testid=pay-amount]');
check('customer sees the same request (exact amount from the contract read)', (await customer.page.getByTestId('pay-amount').textContent()) === '12.5 USDC');
await merchant.page.waitForFunction(() => /Customer joined/.test(document.querySelector('[data-testid=live-customer]')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
check('merchant sees the customer join', /Customer joined/.test(await merchant.page.getByTestId('live-customer').textContent()));
await customer.page.waitForFunction(() => /live/.test(document.querySelector('[data-testid=live-merchant-presence]')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
check('customer sees the merchant screen live', /live/.test(await customer.page.getByTestId('live-merchant-presence').textContent()));
await customer.page.getByTestId('method-base').click();
await customer.page.locator('#refund').focus();
await merchant.page.waitForFunction(() => /reviewing/.test(document.querySelector('[data-testid=live-customer]')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
check('merchant sees "reviewing payment instructions" when the customer starts paying', /reviewing/.test(await merchant.page.getByTestId('live-customer').textContent()));
check('session is coordination only: payment state still from the contract (Awaiting)', (await customer.page.locator('[data-state]').getAttribute('data-state')) === 'AWAITING_PAYMENT');
await customer.page.screenshot({ path: `${OUT}/live-02-customer.png`, fullPage: true });
await merchant.page.screenshot({ path: `${OUT}/live-03-merchant-joined.png`, fullPage: true });
// A third device cannot take over the session.
const intruder = await ctx('intruder');
await intruder.page.goto(link.replace(/^https?:\/\/[^/]+/, BASE));
await intruder.page.waitForSelector('[data-testid=live-error]', { timeout: 15000 }).catch(() => {});
check('a second customer device is refused (ALREADY_JOINED)', /Another device/.test((await intruder.page.getByTestId('live-error').textContent().catch(() => '')) ?? ''));
// Reload keeps the customer in the session (stored join secret, same participant).
await customer.page.reload();
await customer.page.waitForSelector('[data-testid=live-customer-banner]', { timeout: 15000 }).catch(() => {});
check('customer reload rejoins the same session', await customer.page.getByTestId('live-customer-banner').isVisible().catch(() => false));
await merchant.page.getByRole('button', { name: 'End session' }).click();
await customer.page.waitForFunction(() => /ended this session/.test(document.querySelector('[data-testid=live-customer-banner]')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
check('merchant ends the session; customer is told, request unchanged', /ended this session/.test(await customer.page.getByTestId('live-customer-banner').textContent()));
// Rooms only for OPEN requests.
const paid = await fixtureId(merchant.page, 'usdc-recorded');
await merchant.page.goto(`${BASE}/m/pay/${paid}`);
await merchant.page.waitForSelector('[data-state]');
check('no Live Handshake panel for a non-open request', (await merchant.page.getByTestId('live-merchant').count()) === 0);
const refused = await merchant.page.evaluate(async (rid) => { const r = await fetch('/api/mainnet/handshake/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: rid }) }); return r.status; }, paid);
check('server refuses a room for a paid request (409)', refused === 409, refused);
const bad = await merchant.page.goto(`${BASE}/m/s/not-a-room`);
check('malformed session path is 404', bad.status() === 404, bad.status());

// 2. Solana and Tron origins in checkout (fixture route list).
const solPage = (await ctx('solana')).page;
await solPage.goto(`${BASE}/m/pay/${id}`);
await solPage.getByTestId('method-base').click();
await solPage.waitForSelector('[data-testid=origin-picker]');
const chains = await solPage.locator('[data-testid=origin-picker] input').evaluateAll((els) => els.map((e) => e.getAttribute('data-chain')));
check('origin picker offers Base, Solana and Tron', JSON.stringify(chains) === '["base","sol","tron"]', JSON.stringify(chains));
await solPage.locator('[data-testid=origin-picker] input[data-chain=sol]').check();
await solPage.locator('#refund').fill('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed');
await solPage.locator('#refund').blur();
check('an EVM address is refused as a Solana refund address', await solPage.getByTestId('get-quote').isDisabled());
await solPage.locator('#refund').fill(SOLANA_WALLET);
await solPage.getByTestId('get-quote').click();
await solPage.waitForSelector('[data-testid=quote-review]', { timeout: 15000 }).catch(() => {});
const review = (await solPage.getByTestId('quote-review').textContent().catch(() => '')) ?? '';
check('Solana quote review: send on Solana, merchant receives exact USDC, deposit withheld', /USDC · Solana/.test(review) && /12[.,]5 USDC/.test(review) && (await solPage.getByTestId('deposit-withheld').isVisible()), review.slice(0, 300));
await solPage.screenshot({ path: `${OUT}/origin-01-solana-review.png`, fullPage: true });
const tronPage = (await ctx('tron', { viewport: { width: 430, height: 900 } })).page;
const id2 = await fixtureId(tronPage, 'usdc-deposit-seen');
await tronPage.goto(`${BASE}/m/pay/${id2}`);
await tronPage.getByTestId('method-base').click();
await tronPage.locator('[data-testid=origin-picker] input[data-chain=tron]').check();
await tronPage.locator('#refund').fill('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
await tronPage.locator('#refund').blur();
check('the USDT contract is refused as a Tron refund address', await tronPage.getByTestId('get-quote').isDisabled());
await tronPage.screenshot({ path: `${OUT}/origin-02-tron.png`, fullPage: true });

// 3. Receipt, Split prefill, Turkish.
const r = (await ctx('receipt')).page;
await r.goto(`${BASE}/m/receipt/${paid}`);
await r.waitForSelector('[data-testid=receipt-state]');
check('receipt: Payment recorded (contract state) for FINAL_PAID', (await r.getByTestId('receipt-state').getAttribute('data-paid')) === 'recorded');
check('receipt never says Verified', !/Verified Paid|Independently verified/.test(await r.locator('main').textContent()));
await r.screenshot({ path: `${OUT}/receipt-01-recorded.png`, fullPage: true });
await r.goto(`${BASE}/m/split`);
await r.locator('select').first().selectOption('USDC');
await r.locator('input[inputmode=decimal]').first().fill('10');
await r.locator('input[type=number]').fill('3');
await r.getByRole('button', { name: /Calculate|Hesapla/ }).click();
await r.waitForSelector('[data-testid=split-shares] a');
await r.locator('[data-testid=split-shares] a').first().click();
await r.waitForURL(/\/m\/request\/new\?/);
await r.waitForFunction(() => document.querySelector('#amount')?.value === '3.333334', null, { timeout: 10000 }).catch(() => {});
check('split share opens the request composer prefilled with the exact share', (await r.locator('#amount').inputValue()) === '3.333334', await r.locator('#amount').inputValue());
check('prefilled memo carries the split label', (await r.locator('#memo').inputValue()) === 'Split 1/3');
await r.screenshot({ path: `${OUT}/split-01-prefill.png`, fullPage: true });
const tr = await ctx('tr');
await tr.context.addCookies([{ name: 'taply_locale', value: 'tr', url: BASE }]);
await tr.page.goto(`${BASE}/m/pay/${id2}`);
await tr.page.waitForSelector('[data-testid=pay-amount]');
check('Turkish: Live Handshake panel in Turkish', /Canlı El Sıkışma/.test(await tr.page.locator('main').textContent()));
await tr.page.screenshot({ path: `${OUT}/live-04-tr.png`, fullPage: true });

// 4. Loaded-script leak scan.
const found = [];
for (const [url, body] of scripts) for (const leak of LEAKS) if (body.includes(leak)) found.push(`${leak} in ${url.split('/').pop()}`);
check(`leak scan over ${scripts.size} loaded scripts (incl. Testnet Handshake API path)`, found.length === 0, found.join('; '));
check('no unexpected console errors', consoleErrors.length === 0, consoleErrors.slice(0, 4).join(' | '));
fs.writeFileSync(`${OUT}/phase2-results.json`, JSON.stringify({ base: BASE, results, scripts: scripts.size, consoleErrors }, null, 2));
await browser.close();
process.exit(results.every((x) => x.ok) ? 0 : 1);
