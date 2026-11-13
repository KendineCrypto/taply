// Real-browser QA of Mainnet phase 5: the app on Codex's unified wallet protocol.
// Usage: node apps/web/scripts/mainnet-phase5-qa.mjs <playwright/index.mjs> <out-dir> [base-url]
//
// Needs a mainnet PREVIEW build in fixture mode with the SYNTHETIC Gift/escrow/USDC pins (see workspace-check)
// AND NEXT_PUBLIC_TAPLY_MAINNET_AUTHORITY_SIMULATION=on: a single-browser SIMULATED authority store handed to
// Codex's own transaction coordinator (createMainnetWalletBackend({ store })). It is NOT the account-global
// authenticated authority, and every Mainnet RPC answer here is SYNTHETIC. Nothing is signed, sent or funded.
// This is not live Mainnet evidence and not financial settlement.
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
const RECEIPT = '11111111111111111111111111111113';
const TX = '11111111111111111111111111111114';
const TX_UNKNOWN = '11111111111111111111111111111115';
const NOW_NS = '1793520000000000000';
const ONE_NEAR = '1000000000000000000000000';
const LEAKS = ['taply-e2e-ce38a238', 'taply-pay-pilot-1.testnet', 'rpc.testnet.near.org', 'taply.testnet-vault.v1', 'taply-gift-claim:near-testnet'];
const SIM_KEY = 'taply.mainnet.sim-authority.v2:';
let ME = 'pending.near';
let MY_KEY = 'ed25519:11111111111111111111111111111111';

const out = (id, executor, status, receiptIds = []) => ({ id, block_hash: HASH, outcome: { executor_id: executor, status, receipt_ids: receiptIds, logs: [], gas_burnt: 100, tokens_burnt: '1' } });
const executedTx = () => ({ final_execution_status: 'FINAL', status: { SuccessValue: '' },
  transaction: { hash: TX, signer_id: ME, public_key: MY_KEY, nonce: 8, receiver_id: 'bob.near', actions: [{ Transfer: { deposit: ONE_NEAR } }] },
  transaction_outcome: out(TX, ME, { SuccessReceiptId: RECEIPT }, [RECEIPT]),
  receipts_outcome: [out(RECEIPT, 'bob.near', { SuccessValue: '' })] });

async function rpc(route) {
  const r = JSON.parse(route.request().postData() ?? '{}');
  const p = r.params ?? {};
  let result; let error;
  if (r.method === 'status') result = { chain_id: 'mainnet', sync_info: { syncing: false } };
  else if (r.method === 'block') {
    if (p.block_id === 9820210) result = { header: { hash: GENESIS, height: 9820210, timestamp_nanosec: '1595350551591948000' } };
    else if (typeof p.block_id === 'string' && p.block_id !== HASH) result = { header: { hash: p.block_id, height: 199999999, timestamp_nanosec: '1793519990000000000' } };
    else result = { header: { hash: HASH, height: 200000000, timestamp_nanosec: NOW_NS } };
  } else if (r.method === 'gas_price') result = { gas_price: '100000000' };
  else if (r.method === 'EXPERIMENTAL_protocol_config') result = { runtime_config: { storage_amount_per_byte: '10000000000000000000' } };
  else if (r.method === 'tx_status' || r.method === 'EXPERIMENTAL_tx_status') {
    if (p.tx_hash === TX) result = executedTx();
    else error = { code: -32000, name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_TRANSACTION', info: {} }, message: 'unknown tx' };
  } else if (p.request_type === 'view_access_key') result = { nonce: 7, permission: 'FullAccess', block_hash: HASH, block_height: 200000000 };
  else if (p.request_type === 'view_account') result = { amount: '3000000000000000000000000', locked: '0', storage_usage: 182, code_hash: 'GMjfNNjfTPXSmeRaxgN1oS9srsmBSdS46R6y2kPv6JQf', block_hash: HASH, block_height: 200000000 };
  else if (p.request_type === 'call_function') result = { result: Array.from(Buffer.from('null')), logs: [], block_hash: HASH, block_height: 200000000 };
  else error = { code: -32601, name: 'METHOD_NOT_FOUND', message: 'synthetic' };
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
const text = async (page, id) => (await page.getByTestId(id).first().textContent({ timeout: 20000 }).catch(() => '')) ?? '';
const waitFor = (page, id, timeout = 30000) => page.waitForSelector(`[data-testid=${id}]`, { timeout }).then(() => true, () => false);
const code = async (page) => (await page.locator('[data-testid=op-error] [data-code]').getAttribute('data-code', { timeout: 20000 }).catch(() => null));

// ---------- Taply Wallet ----------
const { context: wc, page: w } = await ctx('wallet');
await w.goto(`${BASE}/m/wallet/create`);
await w.locator('#mw-pass').fill('correct horse 42');
await w.locator('#mw-pass2').fill('correct horse 42');
await w.getByTestId('wallet-create').click();
await w.waitForSelector('[data-testid=phrase-words]', { timeout: 30000 });
const words = await w.locator('[data-testid=phrase-words] li').evaluateAll((els) => els.map((e) => e.textContent.replace(/^\d+\.\s*/, '').trim()));
for (const input of await w.locator('[data-testid^=verify-]').all()) {
  const i = Number((await input.getAttribute('data-testid')).split('-')[1]);
  await input.fill(words[i]);
}
await w.getByTestId('backup-done').click();
await w.goto(`${BASE}/m/wallet`);
await w.waitForFunction(() => document.querySelector('[data-testid=activation]')?.getAttribute('data-state') === 'active', null, { timeout: 30000 }).catch(() => {});
ME = (await w.locator('[data-testid=taply-wallet] dd').first().textContent()).trim();
check('wallet active on synthetic RPC', /^[0-9a-f]{64}$/.test(ME), ME);

// ---------- 1. Review through Codex's backend with the SIMULATED authority ----------
async function sendReview(amount = '1') {
  await w.locator('#mw-to').fill('bob.near');
  await w.locator('#mw-amount').fill(amount);
  await w.getByTestId('send-review').click();
  await w.waitForFunction(() => document.querySelector('[data-testid=op-review]') || document.querySelector('[data-testid=op-error]'), null, { timeout: 30000 }).catch(() => {});
}
await w.goto(`${BASE}/m/send`);
check('payment safety panel: SIMULATED authority labelled, no attempts yet', await waitFor(w, 'ledger') && /SIMULATED/.test(await text(w, 'ledger')) && await waitFor(w, 'ledger-empty'));
await sendReview();
const review = await text(w, 'op-review');
check('backend.prepare review: exact 1 NEAR transfer to bob.near, nonce 8, simulated authority',
  (await w.getByTestId('op-review').getAttribute('data-authority')) === 'simulated' && /1 NEAR/.test(await text(w, 'op-amount')) && (await text(w, 'op-nonce')).trim() === '8' && /bob\.near/.test(review), review.slice(0, 300));
const opHash = (await text(w, 'op-hash')).trim();
MY_KEY = /ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}/.exec(review)?.[0] ?? MY_KEY;
check('operation id is a 64-hex hash and the signing key is the wallet key', /^[0-9a-f]{64}$/.test(opHash) && MY_KEY.startsWith('ed25519:'));
check('confirm stays disabled (protocol + release gates closed)', await w.getByTestId('op-confirm').isDisabled());
await w.screenshot({ path: `${OUT}/p5-01-review-simulated.png`, fullPage: true });

// ---------- 2. Unknown outcome: pending attempt blocks, FINAL reconciliation retires it, tombstone forbids replay ----------
const device = await w.evaluate(() => localStorage.getItem('taply.mainnet.device.v1'));
const expectation = { accountId: ME, publicKey: MY_KEY, receiverId: 'bob.near', action: { kind: 'transfer', depositYocto: ONE_NEAR }, nonce: '8', minimumNonce: '7', anchorHash: HASH, anchorHeight: '200000000' };
const ledger = (pending, owner = device, completed = []) => JSON.stringify({ version: 2, network: 'near-mainnet', accountId: ME, ownerDeviceId: owner, revision: '1', pending, completed });
const pendingAttempt = (state, hash) => ({ attemptId: '3f0f7d2e-1c4b-4a8e-9a1b-2c3d4e5f6a7b', operationHash: opHash, deviceId: device, state, expectation, transactionHash: hash });
await w.evaluate(({ k, v }) => localStorage.setItem(k, v), { k: SIM_KEY + ME, v: ledger(pendingAttempt('UNCERTAIN', TX)) });
await w.goto(`${BASE}/m/send`);
await waitFor(w, 'ledger-pending');
check('unknown outcome shown: state UNCERTAIN, its transaction hash, "do not pay again"',
  (await w.getByTestId('ledger').getAttribute('data-pending')) === 'UNCERTAIN' && (await text(w, 'ledger-pending')).includes(TX) && /Do not pay again/.test(await text(w, 'ledger-pending')));
await sendReview('0.3');
check('a different new payment is refused while the outcome is unknown', (await code(w)) === 'OUTCOME_UNRESOLVED');
await w.screenshot({ path: `${OUT}/p5-02-unknown-outcome.png`, fullPage: true });
await w.getByTestId('ledger-check').click();
await waitFor(w, 'ledger-result');
check('FINAL reconciliation (Codex verifyMainnetTransactionExecution): executed, settlement NOT established',
  (await w.locator('[data-testid=ledger-result] [data-kind]').getAttribute('data-kind')) === 'FINAL_EXECUTION' && /not that the payment settled/.test(await text(w, 'ledger-result')));
await w.waitForFunction(() => document.querySelector('[data-testid=ledger]')?.getAttribute('data-pending') === 'none', null, { timeout: 20000 }).catch(() => {});
check('pending attempt retired; permanent record lists the execution', (await w.getByTestId('ledger').getAttribute('data-pending')) === 'none' && (await w.locator('[data-testid=ledger-history] li[data-execution=SUCCESS]').count()) === 1);
await w.getByTestId('direct-check').first().click();
await waitFor(w, 'direct-result');
check('own executed send checked with verifyMainnetDirectTransfer → matches exactly (pre-release wording)', (await w.getByTestId('direct-result').getAttribute('data-kind')) === 'VERIFIED' && !/Verified Paid/i.test(await text(w, 'direct-result')));
await sendReview('1');
check('the same payment (same business id) is refused forever: OPERATION_ALREADY_CONSUMED', (await code(w)) === 'OPERATION_ALREADY_CONSUMED');
await w.getByTestId('send-new').first().click();
await sendReview('1');
check('only an explicit "Start a new payment" gives a new operation (different id, review allowed)', await waitFor(w, 'op-review') && (await text(w, 'op-hash')).trim() !== opHash);
await w.screenshot({ path: `${OUT}/p5-03-reconciled.png`, fullPage: true });

// ---------- 3. Cross-device: another device owns the account → read-only here ----------
const stored = JSON.parse(await w.evaluate((k) => localStorage.getItem(k), SIM_KEY + ME));
stored.ownerDeviceId = '9b2c6f7e-4d1a-4c3b-8e5f-6a7b8c9d0e1f';
await w.evaluate(({ k, v }) => localStorage.setItem(k, v), { k: SIM_KEY + ME, v: JSON.stringify(stored) });
await w.goto(`${BASE}/m/send`);
await waitFor(w, 'ledger-owner');
check('ledger owned by another device is shown as such', (await w.getByTestId('ledger-owner').getAttribute('data-owner')) === 'other');
await sendReview('0.2');
check('this device cannot prepare a payment: OTHER_DEVICE_READ_ONLY', (await code(w)) === 'OTHER_DEVICE_READ_ONLY');

// ---------- 4. Unresolvable without a hash; a wrong hash hint resolves nothing ----------
await w.evaluate(({ k, v }) => localStorage.setItem(k, v), { k: SIM_KEY + ME, v: ledger(pendingAttempt('HANDOFF', null)) });
await w.goto(`${BASE}/m/send`);
await waitFor(w, 'ledger-pending');
await w.getByTestId('ledger-check').click();
await waitFor(w, 'ledger-result');
check('no hash recorded → still unknown (no timeout ever becomes "not sent")', (await w.locator('[data-testid=ledger-result] [data-kind]').getAttribute('data-kind')) === 'OUTCOME_UNRESOLVED');
await w.locator('#ledger-hint').fill(TX_UNKNOWN);
await w.getByTestId('ledger-check').click();
await w.waitForTimeout(1500);
check('an unknown hash hint resolves nothing; attempt still pending', (await w.locator('[data-testid=ledger-result] [data-kind]').getAttribute('data-kind')) === 'OUTCOME_UNRESOLVED' && (await w.getByTestId('ledger').getAttribute('data-pending')) === 'HANDOFF');

// ---------- 5. Legacy v1 journal entries are not migrated and still block ----------
await w.evaluate(({ k }) => localStorage.removeItem(k), { k: SIM_KEY + ME });
await w.evaluate(async ({ account }) => {
  const db = await new Promise((res, rej) => { const o = indexedDB.open('taply.mainnet.attempts.v1', 1); o.onupgradeneeded = () => o.result.createObjectStore('attempts'); o.onsuccess = () => res(o.result); o.onerror = () => rej(o.error); });
  await new Promise((res, rej) => { const t = db.transaction('attempts', 'readwrite'); t.objectStore('attempts').put(JSON.stringify({ version: 1, network: 'near-mainnet', accountId: account, operationHash: 'ab'.repeat(32), attemptId: crypto.randomUUID(), state: 'UNCERTAIN', transactionHash: null }), account); t.oncomplete = res; t.onerror = () => rej(t.error); });
  db.close();
}, { account: ME });
await w.goto(`${BASE}/m/send`);
check('legacy unresolved record shown and sending disabled (no automatic migration)', await waitFor(w, 'attempt-unresolved') && await w.getByTestId('send-review').isDisabled());

// ---------- 6. Commerce: per-sale commitment checked against the FINAL request ----------
const { page: shop } = await ctx('customer');
await shop.goto(`${BASE}/m`);
const saleHref = await shop.getByTestId('fixture-list').getByText('usdc-commerce-sale', { exact: true }).locator('xpath=ancestor::a').getAttribute('href');
check('FIXTURE commerce sale link carries the commitment in the fragment', /^\/m\/pay\/[0-9a-f]{64}\?m=[a-z0-9.-]+#c=[A-Za-z0-9_-]+$/.test(saleHref), saleHref);
await shop.goto(`${BASE}${saleHref}`);
check('bound sale verified (Codex verifyMainnetCommerceBinding) and payment methods offered', await waitFor(shop, 'commerce-verified') && await waitFor(shop, 'method-wallet'));
check('memo shows the customer note, not the commitment line', /Counter 2/.test(await shop.locator('main').textContent()) && !/taply-commerce-v1:/.test(await shop.locator('main').textContent()));
await shop.screenshot({ path: `${OUT}/p5-04-commerce-verified.png`, fullPage: true });
const [path, frag] = saleHref.split('#c=');
const payload = JSON.parse(Buffer.from(frag, 'base64url').toString('utf8'));
const tampered = Buffer.from(JSON.stringify({ ...payload, termsHash: 'e'.repeat(64) })).toString('base64url');
await shop.goto('about:blank');
await shop.goto(`${BASE}${path}#c=${tampered}`);
check('a different reviewed hash is refused: no payment method', await waitFor(shop, 'commerce-mismatch') && !(await shop.getByTestId('method-wallet').isVisible().catch(() => false)));
const otherSession = Buffer.from(JSON.stringify({ ...payload, session: { ...payload.session, sessionNonce: 'f'.repeat(64) } })).toString('base64url');
await shop.goto('about:blank');
await shop.goto(`${BASE}${path}#c=${otherSession}`);
check('a different sale session is refused', await waitFor(shop, 'commerce-mismatch'));
await shop.goto('about:blank');
await shop.goto(`${BASE}${path}#c=not-valid!!`);
check('a malformed commitment is refused', await waitFor(shop, 'commerce-mismatch'));

// Merchant register binds every sale.
await w.goto(`${BASE}/m/merchant/register`);
await w.locator('#amount').fill('3');
await w.getByRole('button', { name: /^Review/ }).click();
await waitFor(w, 'sale-link');
const saleLink = (await text(w, 'sale-link')).trim();
const sale1 = (await text(w, 'create-request-id')).trim();
check('register: sale bound (link carries #c=, request id derived from the sale session)', /#c=[A-Za-z0-9_-]+$/.test(saleLink) && saleLink.includes(sale1));
const createArgs = await w.locator('[data-testid=call-preview]').first().textContent();
check('create_request terms carry the commitment in the immutable memo', /taply-commerce-v1:[0-9a-f]{64}/.test(createArgs));
await w.getByTestId('next-sale').click();
await w.locator('#amount').fill('3');
await w.getByRole('button', { name: /^Review/ }).click();
await waitFor(w, 'sale-link');
check('next sale: new session → new request id for the same amount', (await text(w, 'create-request-id')).trim() !== sale1);
await w.screenshot({ path: `${OUT}/p5-05-merchant-sale.png`, fullPage: true });

// Live Handshake: the join link carries the commitment; the customer device checks it.
const saleId = path.split('/').pop().split('?')[0];
const { page: cashier } = await ctx('cashier');
await cashier.goto(`${BASE}/m`);
await cashier.evaluate(({ id, c }) => localStorage.setItem(`taply.mainnet.sale.v1:${id}`, c), { id: saleId, c: frag });
await cashier.goto(`${BASE}/m/pay/${saleId}`);
await cashier.getByTestId('live-start').click();
await waitFor(cashier, 'live-link');
const live = (await text(cashier, 'live-link')).trim();
check('Live link: join token + sale commitment', /\/m\/s\/[A-Za-z0-9_-]{22}#j=[A-Za-z0-9_-]{22,64}&c=[A-Za-z0-9_-]+$/.test(live), live);
const { page: guest } = await ctx('guest', { width: 360, height: 780 });
await guest.goto(live.replace(/^https?:\/\/[^/]+/, BASE));
check('customer device: join token removed from the URL, commitment kept and verified on the pay screen',
  await waitFor(guest, 'commerce-verified') && !(await guest.evaluate(() => location.hash)).includes('j=') && (await guest.evaluate(() => location.hash)).startsWith('#c='));
await guest.screenshot({ path: `${OUT}/p5-06-live-sale.png`, fullPage: true });

// ---------- 7. Settlement checks (no index: hashes from the person; synthetic graph → NOT verified) ----------
await w.goto(`${BASE}/m/receipt/${saleId}`);
check('FIXTURE receipt: settlement check says there is nothing on chain to check', await waitFor(w, 'settlement-fixture'));

// ---------- 8. Leak scan + errors ----------
const found = [];
for (const [url, body] of scripts) for (const leak of LEAKS) if (body.includes(leak)) found.push(`${leak} in ${url.split('/').pop()}`);
check(`leak scan over ${scripts.size} loaded scripts`, found.length === 0, found.join('; '));
check('no uncaught page errors', errors.length === 0, errors.join(' | '));

await browser.close();
fs.writeFileSync(`${OUT}/phase5-results.json`, JSON.stringify({ base: BASE, authority: 'SIMULATED single-browser store via Codex coordinator (test harness, not account-global)', rpc: 'SYNTHETIC responder in the browser (no Mainnet access) — not live evidence, not settlement', results, scripts: scripts.size, errors }, null, 2));
console.log(`\n${results.filter((x) => x.ok).length}/${results.length} passed`);
process.exit(results.every((x) => x.ok) ? 0 : 1);
