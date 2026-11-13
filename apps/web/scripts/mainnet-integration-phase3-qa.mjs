// Real-browser QA of the phase 3 integration (Codex protocol interfaces wired into the Mainnet app).
// Usage: node apps/web/scripts/mainnet-integration-phase3-qa.mjs <playwright/index.mjs> <out-dir> [base-url]
// Needs a mainnet PREVIEW build in fixture mode. Mainnet RPC calls made BY THE BROWSER are answered by a
// SYNTHETIC responder (same shapes as packages/near-client/test/mainnet-protocol.test.mjs); nothing reaches
// Mainnet, nothing is signed or funded.
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const OUT = process.argv[3];
const BASE = process.argv[4] ?? 'http://127.0.0.1:3120';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: ok ? '' : String(detail).slice(0, 300) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' — ' + detail}`); };
const GENESIS = 'EPnLgE7iEq9s7yTkos96M3cWymH5avBAPm3qx3NXqR8H';
const HASH = '11111111111111111111111111111112';
const LEAKS = ['taply-e2e-ce38a238', 'taply-pay-pilot-1.testnet', 'rpc.testnet.near.org', 'taply.testnet-vault.v1', 'taply-gift-claim:near-testnet'];
let activated = false;
async function rpc(route) {
  const r = JSON.parse(route.request().postData() ?? '{}');
  let result; let error;
  if (r.method === 'status') result = { chain_id: 'mainnet', sync_info: { syncing: false } };
  else if (r.method === 'block') result = { header: { hash: r.params.block_id === 9820210 ? GENESIS : HASH, height: r.params.block_id === 9820210 ? 9820210 : 200000000, timestamp_nanosec: '1793520000000000000' } };
  else if (r.method === 'gas_price') result = { gas_price: '100000000' };
  else if (r.method === 'EXPERIMENTAL_protocol_config') result = { runtime_config: { storage_amount_per_byte: '10000000000000000000' } };
  else if (r.params?.request_type === 'view_access_key') result = { nonce: 7, permission: 'FullAccess', block_hash: HASH, block_height: 200000000 };
  else if (r.params?.request_type === 'call_function') result = { result: Array.from(Buffer.from(r.params.method_name === 'ft_balance_of' ? '"2500000"' : 'null')), logs: [], block_hash: HASH, block_height: 200000000 };
  else if (r.params?.request_type === 'view_account') {
    if (!activated && r.params.account_id !== 'bob.near') error = { code: -32000, name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_ACCOUNT', info: {} }, message: 'unknown account' };
    else result = { amount: '2000000000000000000000000', locked: '0', storage_usage: 182, code_hash: '11111111111111111111111111111111', block_hash: HASH, block_height: 200000000 };
  } else error = { code: -32601, name: 'METHOD_NOT_FOUND', message: 'fixture' };
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(error ? { jsonrpc: '2.0', id: r.id, error } : { jsonrpc: '2.0', id: r.id, result }) });
}
const browser = await chromium.launch();
const scripts = new Map();
const errors = [];
async function ctx(label, viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await context.route(/https:\/\/(rpc\.mainnet\.fastnear\.com|archival-rpc\.mainnet\.fastnear\.com|rpc\.mainnet\.near\.org)\/?.*/, rpc);
  const page = await context.newPage();
  page.on('response', async (res) => { if (res.url().includes('/_next/static/') && res.url().endsWith('.js')) { try { scripts.set(res.url(), await res.text()); } catch {} } });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  return { context, page };
}

// ---------- Wallet: create, back up, activation, unlock, send review ----------
const w = await ctx('wallet');
await w.page.goto(`${BASE}/m/wallet/create`);
await w.page.locator('#mw-pass').fill('short');
await w.page.locator('#mw-pass2').fill('short');
await w.page.getByTestId('wallet-create').click();
check('weak password refused', /8 characters/.test(await w.page.getByTestId('wallet-error').textContent()));
await w.page.locator('#mw-pass').fill('correct horse 42');
await w.page.locator('#mw-pass2').fill('correct horse 42');
await w.page.getByTestId('wallet-create').click();
await w.page.waitForSelector('[data-testid=phrase-words]', { timeout: 30000 });
const words = await w.page.locator('[data-testid=phrase-words] li').evaluateAll((els) => els.map((e) => e.textContent.replace(/^\d+\.\s*/, '').trim()));
check('12-word recovery phrase shown once', words.length === 12 && words.every((x) => /^[a-z]+$/.test(x)), JSON.stringify(words));
await w.page.screenshot({ path: `${OUT}/wallet-01-phrase.png`, fullPage: true });
check('backup confirmation required before continuing', await w.page.getByTestId('backup-done').isDisabled());
for (const input of await w.page.locator('[data-testid^=verify-]').all()) {
  const p = Number((await input.getAttribute('data-testid')).split('-')[1]);
  await input.fill(words[p]);
}
await w.page.getByTestId('backup-done').click();
check('wallet created after backup check', await w.page.getByTestId('wallet-created').isVisible());
const stored = await w.page.evaluate(() => Object.keys(localStorage));
check('vault stored only under the Mainnet key (no Testnet vault key)', stored.includes('taply.mainnet-vault.v1') && !stored.some((k) => k.includes('testnet')), JSON.stringify(stored));
const raw = await w.page.evaluate(() => localStorage.getItem('taply.mainnet-vault.v1'));
check('phrase never stored in clear text', !words.some((x) => raw.includes(` ${x} `)) && !raw.includes(words.join(' ')));
await w.page.goto(`${BASE}/m/wallet`);
await w.page.waitForFunction(() => { const v = document.querySelector('[data-testid=activation]')?.getAttribute('data-state'); return v !== undefined && v !== null && v !== 'checking'; }, null, { timeout: 30000 });
const firstState = await w.page.getByTestId('activation').getAttribute('data-state');
check('fresh implicit account is NOT activated (final-block evidence)', firstState === 'not_activated', `${firstState}: ${await w.page.getByTestId('activation').textContent()}`);
const accountId = await w.page.locator('[data-testid=taply-wallet] dd').first().textContent();
check('account is a 64-hex implicit Mainnet account', /^[0-9a-f]{64}$/.test(accountId.trim()), accountId);
await w.page.screenshot({ path: `${OUT}/wallet-02-not-activated.png`, fullPage: true });
await w.page.locator('#mw-unlock').fill('wrong password!!');
await w.page.getByTestId('wallet-unlock').click();
await w.page.waitForSelector('[data-testid=wallet-error]', { timeout: 30000 });
check('wrong password does not unlock', !(await w.page.getByTestId('unlocked').isVisible().catch(() => false)));
await w.page.locator('#mw-unlock').fill('correct horse 42');
await w.page.getByTestId('wallet-unlock').click();
await w.page.waitForSelector('[data-testid=unlocked]', { timeout: 30000 }).catch(() => {});
check('correct password unlocks', await w.page.getByTestId('unlocked').isVisible());
activated = true;
await w.page.getByRole('button', { name: 'Check again' }).click();
await w.page.waitForFunction(() => document.querySelector('[data-testid=activation]')?.getAttribute('data-state') === 'active', null, { timeout: 30000 }).catch(() => {});
check('activated only once account + FullAccess key are proven', (await w.page.getByTestId('activation').getAttribute('data-state')) === 'active');
const available = await w.page.getByTestId('available').textContent();
check('available balance excludes storage and gas reserves (< 2 NEAR)', /^1[.,]9/.test(available), available);
check('USDC balance shown from the same final block', /2[.,]5 USDC/.test(await w.page.locator('[data-testid=taply-wallet]').textContent()));
await w.page.screenshot({ path: `${OUT}/wallet-03-active.png`, fullPage: true });
await w.page.goto(`${BASE}/m/send`);
await w.page.locator('#mw-to').fill('not an account!');
await w.page.locator('#mw-amount').fill('0.25');
await w.page.getByTestId('send-review').click();
check('invalid recipient refused before any review', /valid NEAR account/.test(await w.page.getByTestId('wallet-error').textContent()));
await w.page.locator('#mw-to').fill('bob.near');
await w.page.locator('#mw-amount').fill('5');
await w.page.getByTestId('send-review').click();
await w.page.waitForSelector('[data-testid=wallet-error]', { timeout: 30000 });
check('amount above the available balance refused', /Not enough NEAR/.test(await w.page.getByTestId('wallet-error').textContent()));
await w.page.locator('#mw-amount').fill('0.25');
await w.page.getByTestId('send-review').click();
await w.page.waitForSelector('[data-testid=send-review-card]', { timeout: 30000 }).catch(() => {});
const review = (await w.page.getByTestId('send-review-card').textContent().catch(() => '')) ?? '';
check('exact review: recipient, 0.25 NEAR, next nonce, final block, Mainnet', /bob\.near/.test(review) && /0[.,]25 NEAR/.test(review) && /8/.test(review) && review.includes(HASH) && /NEAR Mainnet/.test(review), review.slice(0, 300));
check('confirm is disabled (signing gate closed)', await w.page.getByTestId('send-confirm').isDisabled());
await w.page.screenshot({ path: `${OUT}/wallet-04-send-review.png`, fullPage: true });
// Restore the same wallet on a second device.
const d2 = await ctx('restore');
await d2.page.goto(`${BASE}/m/wallet/restore`);
await d2.page.locator('#mw-phrase').fill('abandon abandon abandon');
await d2.page.locator('#mw-pass').fill('another pass 77');
await d2.page.locator('#mw-pass2').fill('another pass 77');
await d2.page.getByTestId('wallet-restore').click();
await d2.page.waitForSelector('[data-testid=wallet-error]', { timeout: 30000 });
check('invalid phrase refused', /12-word/.test(await d2.page.getByTestId('wallet-error').textContent()));
await d2.page.locator('#mw-phrase').fill(words.join(' '));
await d2.page.getByTestId('wallet-restore').click();
await d2.page.waitForSelector('[data-testid=wallet-restored]', { timeout: 30000 }).catch(() => {});
await d2.page.goto(`${BASE}/m/wallet`);
await d2.page.waitForSelector('[data-testid=taply-wallet]');
check('restore on another device yields the same Mainnet account', (await d2.page.locator('[data-testid=taply-wallet] dd').first().textContent()).trim() === accountId.trim());

// ---------- Protected Pay ----------
const p = (await ctx('protected')).page;
await p.goto(`${BASE}/m/protected/new`);
await p.waitForSelector('[data-testid=protected-mainnet]');
const methods = async () => p.locator('[data-testid=escrow-actions] li[data-method]').evaluateAll((els) => els.map((e) => e.getAttribute('data-method')));
await p.getByTestId('escrow-locked').click(); await p.getByTestId('escrow-before').click();
check('LOCKED before cutoff: only payer cancel', JSON.stringify(await methods()) === '["cancel_protected"]', JSON.stringify(await methods()));
check('LOCKED is labelled NOT PAID', /NOT PAID/.test(await p.getByTestId('escrow-state').textContent()));
await p.screenshot({ path: `${OUT}/protected-01-locked.png`, fullPage: true });
await p.getByTestId('escrow-after').click();
check('LOCKED after cutoff: only release', JSON.stringify(await methods()) === '["release_protected"]', JSON.stringify(await methods()));
for (const [name, expected] of [['release-failed', '["retry_native_transfer"]'], ['refund-failed', '["retry_native_transfer"]'], ['release-in-flight', '[]'], ['refund-in-flight', '[]'], ['final-paid', '[]'], ['cancelled-refunded', '[]']]) {
  await p.getByTestId(`escrow-${name}`).click();
  check(`${name}: actions ${expected}`, JSON.stringify(await methods()) === expected, JSON.stringify(await methods()));
}
await p.getByTestId('escrow-release-in-flight').click();
check('IN_FLIGHT shows the R-2 unknown warning, no retry', await p.getByTestId('escrow-r2').isVisible());
await p.screenshot({ path: `${OUT}/protected-02-r2.png`, fullPage: true });
check('every escrow action button is disabled', (await p.locator('[data-testid=escrow-actions] button:not([disabled])').count()) === 0);

// ---------- Gift ----------
const g = (await ctx('gift')).page;
await g.goto(`${BASE}/m/gift/new`);
await g.waitForSelector('[data-testid=gift-mainnet]');
await g.getByTestId('gift-prepare').click();
await g.waitForSelector('[data-testid=gift-prepared]');
check('Open Gift: total = amount + fixture fee (0.51 NEAR)', /0[.,]51 NEAR/.test(await g.getByTestId('gift-total').textContent()));
check('Open Gift: create_gift call with the link public key, claim link carries the key only in the fragment', /create_gift/.test(await g.getByTestId('gift-prepared').textContent()) && /\/m\/gift\/[0-9a-f]{32}#k=[0-9a-f]{64}/.test(await g.getByTestId('gift-prepared').textContent()));
await g.screenshot({ path: `${OUT}/gift-01-create.png`, fullPage: true });
await g.getByTestId('gift-available').click();
await g.getByTestId('gift-claim').click();
await g.waitForSelector('[data-testid=gift-claim-signed]', { timeout: 15000 }).catch(() => {});
const signed = (await g.getByTestId('gift-claim-signed').textContent().catch(() => '')) ?? '';
check('claim signed with the one-use link key -> claim_gift with a 64-byte signature', /claim_gift/.test(signed) && /[0-9a-f]{128}/.test(signed), signed.slice(0, 200));
await g.getByTestId('gift-expired').click();
check('expired gift: creator refund offered', await g.getByTestId('gift-refund').isVisible());
await g.getByTestId('gift-claimed-pending').click();
check('payout PENDING: R-2 warning and no action', (await g.getByTestId('gift-payout').getAttribute('data-payout')) === 'PENDING' && await g.getByTestId('gift-no-action').isVisible());
await g.getByTestId('gift-claimed-failed').click();
check('recorded payout failure: recipient retry offered', await g.getByTestId('gift-retry').isVisible());
await g.getByTestId('gift-refunded').click();
check('refunded gift: no action', await g.getByTestId('gift-no-action').isVisible());
await g.screenshot({ path: `${OUT}/gift-02-states.png`, fullPage: true });

// ---------- Leak scan ----------
const found = [];
for (const [url, body] of scripts) for (const leak of LEAKS) if (body.includes(leak)) found.push(`${leak} in ${url.split('/').pop()}`);
check(`leak scan over ${scripts.size} loaded scripts (incl. Testnet vault key and Testnet gift claim domain)`, found.length === 0, found.join('; '));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`${OUT}/phase3-results.json`, JSON.stringify({ base: BASE, rpc: 'SYNTHETIC responder in the browser (no Mainnet access)', results, scripts: scripts.size, errors }, null, 2));
await browser.close();
process.exit(results.every((x) => x.ok) ? 0 : 1);
