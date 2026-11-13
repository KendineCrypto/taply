// Real-browser QA of Mainnet phase 4 (Send USDC, Personal Gift, Open Gift pages, Protected Pay create/fund,
// merchant register/checkout, account-filtered activity, pending/unknown outcome display).
// Usage: node apps/web/scripts/mainnet-phase4-qa.mjs <playwright/index.mjs> <out-dir> [base-url]
//
// Needs a mainnet PREVIEW build in fixture mode built with the SYNTHETIC contract profiles below
// (NEXT_PUBLIC_TAPLY_GIFT_* = gift.fixture.near, NEXT_PUBLIC_TAPLY_MAINNET_ESCROW_* = payments.fixture.near).
// Every Mainnet RPC call made BY THE BROWSER is answered by a SYNTHETIC responder: shapes mirror
// packages/near-client/test/mainnet-protocol.test.mjs and the Rust-emitted escrow fixtures in
// packages/near-client/test/fixtures/mainnet-protocol. Nothing reaches Mainnet; nothing is signed, sent or funded.
// This is NOT live Mainnet evidence.
import { pathToFileURL, fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const OUT = process.argv[3];
const BASE = process.argv[4] ?? 'http://127.0.0.1:3120';
fs.mkdirSync(OUT, { recursive: true });
const HERE = path.dirname(fileURLToPath(import.meta.url));
const shared = await import(pathToFileURL(path.join(HERE, '../../../packages/shared/dist/index.js')).href);
const FIX = path.join(HERE, '../../../packages/near-client/test/fixtures/mainnet-protocol');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIX, `${name}.json`), 'utf8'));

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: ok ? '' : String(detail).slice(0, 300) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' — ' + detail}`); };

export const SYNTHETIC = Object.freeze({
  giftContract: 'gift.fixture.near', escrowContract: 'payments.fixture.near',
  codeHash: 'GMjfNNjfTPXSmeRaxgN1oS9srsmBSdS46R6y2kPv6JQf',
  giftMin: '10000000000000000000000', giftMax: '2000000000000000000000000', giftFee: '10000000000000000000000',
});
const GENESIS = 'EPnLgE7iEq9s7yTkos96M3cWymH5avBAPm3qx3NXqR8H';
const HASH = '11111111111111111111111111111112';
const RECEIPT = '11111111111111111111111111111113';
const TX = '11111111111111111111111111111114';
const NOW_NS = '1793520000000000000';
const USDC = shared.MAINNET_USDC;
const LEAKS = ['taply-e2e-ce38a238', 'taply-pay-pilot-1.testnet', 'rpc.testnet.near.org', 'taply.testnet-vault.v1', 'taply-gift-claim:near-testnet'];
let ME = 'pending.near';

const giftConfig = { contract: 'taply-gift-mainnet', version: '0.2.0-mainnet', network: 'near-mainnet', contractId: SYNTHETIC.giftContract, testFaultBuild: false,
  unknownCallbackPolicy: 'PENDING_NO_RETRY_NO_ADMIN_OVERRIDE', reviewStatus: 'UNREVIEWED_NOT_FOR_REAL_FUNDS', asset: 'near:native', giftFeeYocto: SYNTHETIC.giftFee,
  minAmountYocto: SYNTHETIC.giftMin, maxAmountYocto: SYNTHETIC.giftMax, minLifetimeS: '600', maxLifetimeS: '2592000', maxMessageBytes: 280, maxDesign: 7,
  claimDomain: 'taply-gift-claim:near-mainnet:v1' };
const GIFT = { available: 'a'.repeat(32), expired: 'b'.repeat(32), pending: 'c'.repeat(32), failed: 'd'.repeat(32), refunded: 'e'.repeat(32) };
const SEED = '07'.repeat(32);
const { createPrivateKey, createPublicKey } = await import('node:crypto');
const SEED_PUBLIC_HEX = createPublicKey(createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(SEED, 'hex')]), format: 'der', type: 'pkcs8' }))
  .export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
function giftView(id) {
  const base = { id, creator: 'carol.near', amountYocto: '500000000000000000000000', publicKey: SEED_PUBLIC_HEX, message: 'Mutlu yıllar — happy new year', design: 1,
    createdAtNs: '1793510000000000000', createdHeight: '199990000', expiresAtNs: '1793600000000000000', status: 'AVAILABLE',
    beneficiary: null, settledAtNs: null, settledHeight: null, payout: null, payoutNonce: null };
  const settled = (beneficiary, payout, status = 'CLAIMED') => ({ ...base, status, beneficiary, settledAtNs: '1793515000000000000', settledHeight: '199995000', payout, payoutNonce: 1 });
  if (id === GIFT.available) return base;
  if (id === GIFT.expired) return { ...base, creator: ME, status: 'EXPIRED', expiresAtNs: '1793515000000000000' };
  if (id === GIFT.pending) return settled(ME, 'PENDING');
  if (id === GIFT.failed) return settled(ME, 'FAILED');
  if (id === GIFT.refunded) return settled('carol.near', 'CONFIRMED', 'REFUNDED');
  return null;
}
const escrowConfig = fixture('token-config');
const ESCROW = Object.fromEntries(['protected-open', 'protected-locked', 'protected-release-failed', 'protected-release-in-flight', 'protected-final-paid', 'token-protected-locked']
  .map((n) => { const r = fixture(n); return [n, r]; }));
const escrowById = (id) => Object.values(ESCROW).find((r) => r.terms.id === id) ?? null;
let usdcBalance = '15000000';
let escrowState = 'protected-open';
let blockNs = NOW_NS;
let quoteDeposit = '9500000000000000000000';
let txMode = 'ok';
const directTx = () => ({ final_execution_status: 'FINAL', status: { SuccessValue: '' },
  transaction: { hash: TX, signer_id: 'alice.near', receiver_id: 'bob.near', actions: [{ Transfer: { deposit: txMode === 'ok' ? '1000000000000000000000000' : '2000000000000000000000000' } }] },
  transaction_outcome: { id: TX, block_hash: HASH, outcome: { executor_id: 'alice.near', status: { SuccessReceiptId: RECEIPT }, receipt_ids: [RECEIPT] } },
  receipts_outcome: [{ id: RECEIPT, block_hash: HASH, outcome: { executor_id: 'bob.near', status: { SuccessValue: '' }, receipt_ids: [] } }] });
const bytes = (v) => Array.from(Buffer.from(JSON.stringify(v)));

async function rpc(route) {
  const r = JSON.parse(route.request().postData() ?? '{}');
  const p = r.params ?? {};
  let result; let error;
  if (r.method === 'status') result = { chain_id: 'mainnet', sync_info: { syncing: false } };
  else if (r.method === 'block') {
    if (p.block_id === 9820210) result = { header: { hash: GENESIS, height: 9820210, timestamp_nanosec: '1595350551591948000' } };
    else if (typeof p.block_id === 'string') result = { header: { hash: p.block_id, height: 199999999, timestamp_nanosec: '1793519990000000000' } };
    else result = { header: { hash: HASH, height: 200000000, timestamp_nanosec: blockNs } };
  } else if (r.method === 'gas_price') result = { gas_price: '100000000' };
  else if (r.method === 'EXPERIMENTAL_protocol_config') result = { runtime_config: { storage_amount_per_byte: '10000000000000000000' } };
  else if (r.method === 'EXPERIMENTAL_tx_status') {
    if (txMode === 'unknown') error = { code: -32000, name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_TRANSACTION', info: {} }, message: 'unknown tx' };
    else result = directTx();
  } else if (p.request_type === 'view_access_key') result = { nonce: 7, permission: 'FullAccess', block_hash: HASH, block_height: 200000000 };
  else if (p.request_type === 'view_account') result = { amount: '2000000000000000000000000', locked: '0', storage_usage: 182, code_hash: SYNTHETIC.codeHash, block_hash: HASH, block_height: 200000000 };
  else if (p.request_type === 'call_function') {
    const args = JSON.parse(Buffer.from(p.args_base64, 'base64').toString('utf8'));
    let value;
    if (p.account_id === USDC && p.method_name === 'ft_balance_of') value = usdcBalance;
    else if (p.account_id === USDC && p.method_name === 'storage_balance_of') value = args.account_id === 'unregistered.near' ? null : { total: '1250000000000000000000', available: '0' };
    else if (p.account_id === SYNTHETIC.giftContract && p.method_name === 'get_config') value = giftConfig;
    else if (p.account_id === SYNTHETIC.giftContract && p.method_name === 'get_gift') value = giftView(args.gift_id);
    else if (p.account_id === SYNTHETIC.escrowContract && p.method_name === 'get_config') value = escrowConfig;
    else if (p.account_id === SYNTHETIC.escrowContract && p.method_name === 'get_request') value = ESCROW[escrowState]?.terms.id === args.id ? ESCROW[escrowState] : escrowById(args.id);
    else if (p.account_id === SYNTHETIC.escrowContract && p.method_name === 'quote_create_request') {
      value = { quoteVersion: '1', requestId: args.terms.id, termsHash: shared.calculateMainnetEscrowTermsHash(args.terms), storageBytes: '950', depositYocto: quoteDeposit, gas: '30000000000000' };
    } else value = null;
    result = { result: bytes(value), logs: [], block_hash: HASH, block_height: 200000000 };
  } else error = { code: -32601, name: 'METHOD_NOT_FOUND', message: 'synthetic' };
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
const text = async (page, id) => (await page.getByTestId(id).textContent({ timeout: 20000 }).catch(() => '')) ?? '';
const overflow = [];
const noOverflow = async (page, label) => { const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth })); if (o.sw > o.iw) overflow.push(`${label}: ${o.sw}>${o.iw}`); };
const waitFor = (page, id, timeout = 30000) => page.waitForSelector(`[data-testid=${id}]`, { timeout }).then(() => true, () => false);

// ---------- Taply Wallet (create + backup), used by every flow below ----------
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
check('wallet ready and active on synthetic RPC (implicit 64-hex account)', /^[0-9a-f]{64}$/.test(ME), ME);

// ---------- 1. Send USDC: exact review with same-block token evidence ----------
await w.goto(`${BASE}/m/send`);
await w.getByLabel('USDC', { exact: true }).check();
await w.locator('#mw-to').fill('bob.near');
await w.locator('#mw-amount').fill('1.0000001');
await w.getByTestId('send-review').click();
check('USDC: 7th decimal refused (6-decimal precision)', /6 decimals/.test(await text(w, 'wallet-error')));
await w.locator('#mw-amount').fill('26');
await w.getByTestId('send-review').click();
check('USDC: above the 25 USDC pilot cap refused', /pilot limit/.test(await text(w, 'wallet-error')));
await w.locator('#mw-amount').fill('20');
await w.getByTestId('send-review').click();
await w.waitForFunction(() => /Not enough USDC/.test(document.querySelector('[data-testid=op-error]')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {});
check('USDC: amount above the balance read at the snapshot block refused (Codex planner)', /Not enough USDC/.test(await text(w, 'op-error')) && (await w.locator('[data-testid=op-error] [data-code]').getAttribute('data-code')) === 'TOKEN_BALANCE_OR_STORAGE');
await w.locator('#mw-to').fill('unregistered.near');
await w.locator('#mw-amount').fill('12.5');
await w.getByTestId('send-review').click();
await w.waitForFunction(() => /not registered/.test(document.querySelector('[data-testid=op-error]')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {});
check('USDC: recipient without USDC storage refused before any review (Codex planner)', /not registered with the USDC contract/.test(await text(w, 'op-error')) && !(await w.getByTestId('op-review').isVisible().catch(() => false)));
await w.locator('#mw-to').fill('bob.near');
await w.getByTestId('send-review').click();
const usdcReview = await waitFor(w, 'send-review-card') ? await text(w, 'send-review-card') : '';
check('USDC: exact ft_transfer review (recipient, 12.5 USDC, token contract, 1 yocto, 30 Tgas, block, next nonce 8)',
  /bob\.near/.test(usdcReview) && /12[.,]5 USDC/.test(usdcReview) && usdcReview.includes(USDC) && /ft_transfer/.test(usdcReview) && /1 yoctoNEAR/.test(usdcReview) && /30 Tgas/.test(usdcReview) && usdcReview.includes(HASH) && /Nonce\s*8/.test(usdcReview) && /NEAR Mainnet/.test(usdcReview), usdcReview.slice(0, 400));
check('no payment authority on this build: review says nothing can be reserved or sent', (await w.getByTestId('op-review').getAttribute('data-authority')) === 'unavailable' && /Not available on this build/.test(await text(w, 'op-authority')));
check('USDC: review card is for asset USDC and confirm stays disabled', (await w.getByTestId('send-review-card').getAttribute('data-asset')) === 'USDC' && await w.getByTestId('op-confirm').isDisabled());
await noOverflow(w, 'p4-01-usdc-review');
await w.screenshot({ path: `${OUT}/p4-01-usdc-review.png`, fullPage: true });

// ---------- 2. Personal Gift: compose (exact native review), open (separate unwrap, independent check) ----------
await w.goto(`${BASE}/m/gift/new`);
await w.locator('#pg-to').fill('bob.near');
await w.locator('#pg-amount').fill('0.5');
await w.locator('#pg-msg').fill('Happy birthday!');
await w.getByTestId('pg-review').click();
const pgReview = await waitFor(w, 'pg-review-card') ? await text(w, 'pg-review-card') : '';
check('Personal Gift: exact native transfer review (bob.near, 0.5 NEAR, from this wallet, nonce 8)', /bob\.near/.test(pgReview) && /0[.,]5 NEAR/.test(pgReview) && pgReview.includes(ME) && /8/.test(pgReview), pgReview.slice(0, 300));
await noOverflow(w, 'p4-02-personal-gift-review');
await w.screenshot({ path: `${OUT}/p4-02-personal-gift-review.png`, fullPage: true });
const payload = { v: 1, network: 'near-mainnet', from: 'alice.near', to: 'bob.near', amountYocto: '1000000000000000000000000', txHash: TX, message: 'Happy birthday, Bob!', design: 2 };
const frag = (v) => `#p=${Buffer.from(JSON.stringify(v)).toString('base64url')}`;
const { page: r } = await ctx('recipient', { width: 360, height: 780 });
await r.goto(`${BASE}/m/gift/p${frag(payload)}`);
await waitFor(r, 'pg-open');
check('Personal Gift link opens on /m/gift/p with the envelope and a separate Unwrap button', await r.getByTestId('pg-unwrap').isVisible() && await r.getByTestId('pg-check').isVisible());
await r.getByTestId('pg-unwrap').click();
await r.getByTestId('pg-check').click();
await waitFor(r, 'pg-result');
const verified = await r.locator('[data-testid=pg-result] [data-kind]').getAttribute('data-kind');
const verifiedText = await text(r, 'pg-result');
check('independent direct-transfer check: VERIFIED on a matching FINAL transfer (synthetic RPC)', verified === 'VERIFIED', verifiedText);
const verifiedLabel = (await r.locator('[data-testid=pg-result] [data-kind]').textContent()) ?? '';
check('result label is not "Verified Paid"; pre-release note says so explicitly', !/Verified Paid/i.test(verifiedLabel) && /pre-release/i.test(verifiedText), verifiedText);
await noOverflow(r, 'p4-03-personal-gift-verified');
await r.screenshot({ path: `${OUT}/p4-03-personal-gift-verified.png`, fullPage: true });
await r.goto('about:blank');
await r.goto(`${BASE}/m/gift/p${frag({ ...payload, amountYocto: '3000000000000000000000000' })}`);
await waitFor(r, 'pg-open');
await r.getByTestId('pg-check').click();
await waitFor(r, 'pg-result');
check('tampered amount in the link → NOT_VERIFIED (MISMATCH)', (await r.locator('[data-testid=pg-result] [data-kind]').getAttribute('data-kind')) === 'NOT_VERIFIED');
txMode = 'unknown';
await r.goto('about:blank');
await r.goto(`${BASE}/m/gift/p${frag(payload)}`);
await waitFor(r, 'pg-open');
await r.getByTestId('pg-check').click();
await waitFor(r, 'pg-result');
check('unknown transaction → NOT_VERIFIED (not found), never paid', (await r.locator('[data-testid=pg-result] [data-kind]').getAttribute('data-kind')) === 'NOT_VERIFIED');
txMode = 'ok';
await r.goto('about:blank');
await r.goto(`${BASE}/m/gift/p#p=not-a-payload!`);
check('malformed link refused', await waitFor(r, 'pg-bad'));

// ---------- 3. Open Gift pages: reader (code hash pinned), unwrap ≠ claim, claim / refund / retry / receipt ----------
await w.goto(`${BASE}/m/gift/${GIFT.available}#k=${SEED}`);
await waitFor(w, 'open-gift');
check('Open Gift: link key moved out of the URL (fragment stripped)', !(await w.evaluate(() => location.hash)).includes(SEED));
check('Open Gift: AVAILABLE read from the Gift contract', (await w.getByTestId('og-state').getAttribute('data-status')) === 'AVAILABLE');
check('Open Gift: unwrap and claim are separate actions', await w.getByTestId('og-unwrap').isVisible() && await w.getByTestId('og-sign').isVisible());
await w.getByTestId('og-unwrap').click();
check('unwrapping does not claim', !(await w.getByTestId('og-claim-ready').isVisible().catch(() => false)));
check('claimant is this Taply Wallet (the account that would sign)', (await text(w, 'og-claimant')).trim() === ME);
await w.getByTestId('og-sign').click();
const claimReady = await waitFor(w, 'og-claim-ready') ? await text(w, 'og-claim-ready') : '';
check('claim signed with the one-use link key → Codex planner verified it and prepared claim_gift (unsigned)', /claim_gift/.test(claimReady) && /[0-9a-f]{128}/.test(claimReady) && (await w.getByTestId('op-review').getAttribute('data-method')) === 'claim_gift', claimReady.slice(0, 200));
await noOverflow(w, 'p4-04-open-gift-claim');
await w.screenshot({ path: `${OUT}/p4-04-open-gift-claim.png`, fullPage: true });
const { page: nokey } = await ctx('no-key');
await nokey.goto(`${BASE}/m/gift/${GIFT.available}`);
check('Open Gift without the link key: claim not possible', await waitFor(nokey, 'og-no-key'));
await w.goto(`${BASE}/m/gift/${GIFT.expired}`);
await waitFor(w, 'open-gift');
check('expired gift (creator = this wallet): refund offered, no claim', (await w.getByTestId('og-state').getAttribute('data-status')) === 'EXPIRED' && await w.getByTestId('og-refund').isVisible() && !(await w.getByTestId('og-sign').isVisible().catch(() => false)));
await w.getByTestId('og-refund-review').click();
check('refund prepared by the planner as refund_gift (unsigned)', await waitFor(w, 'og-refund-ready') && (await w.getByTestId('op-review').getAttribute('data-method')) === 'refund_gift');
await w.goto(`${BASE}/m/gift/${GIFT.pending}`);
await waitFor(w, 'open-gift');
check('claimed, payout PENDING (R-2): no retry, no refund', (await w.getByTestId('og-payout').getAttribute('data-payout')) === 'PENDING' && !(await w.getByTestId('og-retry').isVisible().catch(() => false)) && !(await w.getByTestId('og-refund').isVisible().catch(() => false)));
await w.goto(`${BASE}/m/gift/${GIFT.failed}`);
await waitFor(w, 'open-gift');
check('claimed, payout FAILED: retry offered to the beneficiary', await w.getByTestId('og-retry').isVisible());
await w.getByTestId('og-retry-review').click();
check('retry prepared by the planner as retry_payout (unsigned)', await waitFor(w, 'og-retry-ready') && (await w.getByTestId('op-review').getAttribute('data-method')) === 'retry_payout');
await w.goto(`${BASE}/m/gift/${GIFT.refunded}/receipt`);
await waitFor(w, 'og-receipt');
const receipt = await text(w, 'og-receipt');
check('gift receipt: contract-state REFUNDED · CONFIRMED, never "Verified"', (await w.getByTestId('og-receipt-state').getAttribute('data-status')) === 'REFUNDED' && !/Verified/i.test(receipt), receipt.slice(0, 200));
await w.goto(`${BASE}/m/gift/${'9'.repeat(32)}`);
check('unknown gift id → not found on the contract', await waitFor(w, 'gift-read-error'));

// ---------- 4. Protected Pay: create from the escrow's quote, payer consent + funding, live states ----------
await w.goto(`${BASE}/m/protected/new`);
await waitFor(w, 'protected-create');
check('Protected create: creator is this Taply Wallet', (await text(w, 'pc-creator')).trim() === ME);
await w.locator('#pc-amount').fill('0.75');
await w.locator('#pc-cancel').fill('61');
await w.getByTestId('pc-quote').click();
check('cancellation window above 60 minutes refused', /1–60/.test(await text(w, 'pc-error')));
await w.locator('#pc-cancel').fill('15');
await w.locator('#pc-payer').fill(ME);
await w.getByTestId('pc-quote').click();
check('payer = recipient refused', /cannot be you/.test(await text(w, 'pc-error')));
await w.locator('#pc-payer').fill('bob.near');
quoteDeposit = '12000000000000000000000';
await w.getByTestId('pc-quote').click();
await w.waitForFunction(() => /refused/.test(document.querySelector('[data-testid=pc-error]')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {});
check('a quote asking more than the 0.01 NEAR storage ceiling is refused by the reviewed builder', /refused/.test(await text(w, 'pc-error')) && !(await w.getByTestId('pc-review').isVisible().catch(() => false)));
quoteDeposit = '9500000000000000000000';
await w.getByTestId('pc-quote').click();
const pcReview = await waitFor(w, 'pc-review') ? await text(w, 'pc-review') : await text(w, 'pc-error');
const pcId = (await text(w, 'pc-review-id')).trim();
check('Protected create: exact create_request review from the contract quote (0.75 NEAR, 15 min, only bob.near, storage deposit)',
  /0[.,]75 NEAR/.test(pcReview) && /15 min/.test(pcReview) && /bob\.near/.test(pcReview) && /0[.,]0095 NEAR/.test(pcReview) && /^[0-9a-f]{64}$/.test(pcId), pcReview.slice(0, 400));
check('unreviewed escrow candidate is labelled', await w.getByTestId('pc-unreviewed').isVisible());
check('call hidden until the recipient consents', !(await w.getByTestId('pc-ready').isVisible().catch(() => false)));
await w.getByText(/I agree that the payer can cancel/).click();
const pcReady = await text(w, 'pc-ready');
check('after consent: create_request call with the exact terms + payer link; create stays disabled', /create_request/.test(pcReady) && pcReady.includes(pcId) && /600000000000|900000000000/.test(pcReady) && await w.getByTestId('op-confirm').isDisabled(), pcReady.slice(0, 300));
await noOverflow(w, 'p4-05-protected-create');
await w.screenshot({ path: `${OUT}/p4-05-protected-create.png`, fullPage: true });
await w.getByTestId('pc-quote').click();
await waitFor(w, 'pc-review');
check('a second quote is a new request (fresh creation nonce → new id)', (await text(w, 'pc-review-id')).trim() !== pcId);

const open = ESCROW['protected-open'];
await w.goto(`${BASE}/m/protected/${open.terms.id}`);
await waitFor(w, 'protected-request');
check('payer page: OPEN read from the escrow, 1-minute window shown', (await w.getByTestId('pr-state').getAttribute('data-status')) === 'OPEN' && /1 min/.test(await text(w, 'pr-window')));
check('funding call hidden until the payer accepts the shown window', !(await w.getByTestId('pr-fund-ready').isVisible().catch(() => false)));
await w.getByText(/I understand I can cancel/).click();
check('payer consent recorded by tapping its text', await w.getByTestId('pr-consent').isChecked());
await waitFor(w, 'pr-fund-ready');
const fund = await text(w, 'pr-fund-ready');
check('payer consent → fund_protected_native with exact principal, terms hash and accepted window; Fund disabled',
  (await w.getByTestId('pr-fund-ready').getAttribute('data-method')) === 'fund_protected_native' && fund.includes(open.termsHash) && /Attached deposit\s*1 NEAR/.test(fund) && await w.getByTestId('op-confirm').isDisabled(), fund.slice(0, 300));
await noOverflow(w, 'p4-06-protected-fund');
await w.screenshot({ path: `${OUT}/p4-06-protected-fund.png`, fullPage: true });
// The Rust fixtures are one request at successive states; the synthetic chain serves one state at a chosen final-block time.
async function escrowAt(state, ns) {
  escrowState = state; blockNs = ns;
  await w.goto('about:blank');
  await w.goto(`${BASE}/m/protected/${ESCROW[state].terms.id}`);
  await waitFor(w, 'protected-request');
  await w.waitForFunction((st) => document.querySelector('[data-testid=pr-state]')?.getAttribute('data-status') === st, ESCROW[state].status, { timeout: 30000 }).catch(() => {});
  return text(w, 'protected-request');
}
const locked = await escrowAt('protected-locked', '1793520030000000000');
check('LOCKED before cutoff: "NOT PAID", countdown, no release yet, no cancel for a non-payer',
  (await w.getByTestId('pr-state').getAttribute('data-status')) === 'LOCKED' && /NOT PAID/.test(locked) && await w.getByTestId('pr-countdown').isVisible() && await w.getByTestId('pr-no-action').isVisible(), locked.slice(0, 300));
await noOverflow(w, 'p4-06b-locked');
await w.screenshot({ path: `${OUT}/p4-06b-protected-locked.png`, fullPage: true });
const lockedAfter = await escrowAt('protected-locked', '1793520070000000000');
check('LOCKED after cutoff: still NOT PAID (a passed deadline never pays); release_protected offered, unsigned',
  /NOT PAID/.test(lockedAfter) && !/Released to the merchant/.test(lockedAfter) && (await w.locator('[data-testid=pr-actions] li[data-method=release_protected]').count()) === 1 && /Cancellation window has ended/.test(await text(w, 'pr-countdown')));
await escrowAt('protected-release-in-flight', '1793520070000000000');
check('RELEASE_IN_FLIGHT: R-2 warning, no action, not paid', await w.getByTestId('pr-r2').isVisible() && await w.getByTestId('pr-no-action').isVisible() && !/Released to the merchant/.test(await text(w, 'pr-state')));
await escrowAt('protected-release-failed', '1793520070000000000');
check('RELEASE_FAILED: retry belongs to the merchant (alice.near) — not offered to this wallet, R-2-safe', (await w.locator('[data-testid=pr-actions] li[data-method=retry_native_transfer]').count()) === 0 && /failed/.test(await text(w, 'pr-state')), await text(w, 'pr-actions'));
await escrowAt('protected-final-paid', '1793520070000000000');
check('FINAL_PAID: "Payment recorded (contract state)", no action', /Payment recorded \(contract state\)/.test(await text(w, 'pr-state')) && await w.getByTestId('pr-no-action').isVisible());
await escrowAt('token-protected-locked', '1793520030000000000');
check('USDC protected request reads with exact 2.5 USDC', /2[.,]5 USDC/.test(await text(w, 'pr-amount')));
escrowState = 'protected-open'; blockNs = NOW_NS;

// ---------- 5. Merchant: register (fresh request per sale), checkout binding, incorrect merchant refusal ----------
await w.goto(`${BASE}/m/merchant/register`);
await waitFor(w, 'merchant-register');
async function reviewSale(amount) {
  await w.locator('#amount').fill(amount);
  await w.getByRole('button', { name: /^Review/ }).click();
  await waitFor(w, 'create-request-id');
  return (await text(w, 'create-request-id')).trim();
}
const sale1 = await reviewSale('4.2');
await w.getByTestId('next-sale').click();
check('next sale resets the register', (await text(w, 'sale-number')).trim() === '2');
const sale2 = await reviewSale('4.2');
check('each sale is a distinct request (same amount → different request id)', /^[0-9a-f]{64}$/.test(sale1) && /^[0-9a-f]{64}$/.test(sale2) && sale1 !== sale2, `${sale1} ${sale2}`);
await noOverflow(w, 'p4-07-merchant-register');
await w.screenshot({ path: `${OUT}/p4-07-merchant-register.png`, fullPage: true });
await w.goto(`${BASE}/m`);
const fixtureHref = async (name) => (await w.getByTestId('fixture-list').getByText(name, { exact: true }).locator('xpath=ancestor::a').getAttribute('href')).split('/').pop();
const awaiting = await fixtureHref('usdc-awaiting');
const recorded = await fixtureHref('usdc-recorded');
await w.goto(`${BASE}/m/checkout/shop.near`);
await waitFor(w, 'merchant-checkout');
check('checkout shows the bound store account', (await text(w, 'checkout-account')).trim() === 'shop.near');
await w.locator('#sale-code').fill('https://evil.example/m/pay/' + awaiting);
await w.getByTestId('open-sale').click();
check('foreign-origin sale link refused', await waitFor(w, 'sale-code-error', 5000));
await w.locator('#sale-code').fill(awaiting);
await w.getByTestId('open-sale').click();
await w.waitForURL(/\/m\/pay\/[0-9a-f]{64}\?m=shop\.near$/, { timeout: 20000 }).catch(() => {});
check('incorrect merchant account: request for another recipient refused, no payment method offered', await waitFor(w, 'merchant-mismatch') && !(await w.getByTestId('method-wallet').isVisible().catch(() => false)));
await noOverflow(w, 'p4-08-wrong-merchant');
await w.screenshot({ path: `${OUT}/p4-08-wrong-merchant.png`, fullPage: true });
await w.goto(`${BASE}/m/checkout/taply-fixture-merchant.near`);
await w.locator('#sale-code').fill(awaiting);
await w.getByTestId('open-sale').click();
check('matching store: binding confirmed and payment methods offered', await waitFor(w, 'merchant-match') && await waitFor(w, 'method-wallet'));

// ---------- 6. Account-filtered activity (Taply Wallet account) ----------
for (const id of [awaiting, recorded]) {
  await w.goto(`${BASE}/m/pay/${id}`);
  await waitFor(w, 'track-request');
  await w.getByTestId('track-request').click();
}
await w.goto(`${BASE}/m/activity`);
await w.waitForFunction(() => document.querySelectorAll('[data-testid=activity-row]').length === 2, null, { timeout: 30000 }).catch(() => {});
check('activity lists both saved requests for this wallet account', (await w.getByTestId('activity-row').count()) === 2);
await w.getByLabel('Open', { exact: true }).check();
check('filter Open → only the awaiting request', (await w.getByTestId('activity-row').count()) === 1);
await w.getByLabel('Received', { exact: true }).check();
check('filter Received → none (requests pay the fixture merchant, not this wallet) with the matched account shown',
  (await w.getByTestId('activity-row').count()) === 0 && await w.getByTestId('activity-no-match').isVisible() && (await text(w, 'activity-accounts')).includes(ME));
await noOverflow(w, 'p4-09-activity-filter');
await w.screenshot({ path: `${OUT}/p4-09-activity-filter.png`, fullPage: true });

// ---------- 7. Pending / unknown outcome: journal entry shown, new payments blocked ----------
await w.evaluate(async ({ account, tx }) => {
  const db = await new Promise((res, rej) => { const o = indexedDB.open('taply.mainnet.attempts.v1', 1); o.onupgradeneeded = () => o.result.createObjectStore('attempts'); o.onsuccess = () => res(o.result); o.onerror = () => rej(o.error); });
  await new Promise((res, rej) => { const t = db.transaction('attempts', 'readwrite'); t.objectStore('attempts').put(JSON.stringify({ version: 1, network: 'near-mainnet', accountId: account, operationHash: 'ab'.repeat(32), attemptId: crypto.randomUUID(), state: 'UNCERTAIN', transactionHash: tx }), account); t.oncomplete = res; t.onerror = () => rej(t.error); });
  db.close();
}, { account: ME, tx: TX });
await w.goto(`${BASE}/m/send`);
await waitFor(w, 'attempt-details');
check('unknown outcome: recorded state UNCERTAIN and transaction hash shown, "do not pay again"', (await w.getByTestId('attempt-details').getAttribute('data-state')) === 'UNCERTAIN' && (await text(w, 'attempt-details')).includes(TX) && /Do not pay again/.test(await text(w, 'attempt-unresolved')));
check('unknown outcome blocks a new review', await w.getByTestId('send-review').isDisabled());
await noOverflow(w, 'p4-10-unknown-outcome');
await w.screenshot({ path: `${OUT}/p4-10-unknown-outcome.png`, fullPage: true });

// ---------- 8. Turkish copy on new screens ----------
await wc.addCookies([{ name: 'taply_locale', value: 'tr', url: BASE }]);
await w.goto(`${BASE}/m/protected/new`);
await waitFor(w, 'protected-create');
check('Turkish: Protected create in Turkish', /Yeni korumalı talep/.test(await text(w, 'protected-create')));
await w.goto(`${BASE}/m/send`);
await waitFor(w, 'attempt-details');
check('Turkish: unknown-outcome details in Turkish', /Sonuç bilinmiyor/.test(await text(w, 'attempt-details')));
await w.goto(`${BASE}/m/checkout/shop.near`);
await waitFor(w, 'merchant-checkout');
check('Turkish: store checkout in Turkish', /Mağaza ödemesi/.test(await text(w, 'merchant-checkout')));

// ---------- 9. Layout + leak scan ----------
check('no horizontal overflow at 360–390 px on any new screen (long implicit accounts wrap)', overflow.length === 0, overflow.join('; '));
const found = [];
for (const [url, body] of scripts) for (const leak of LEAKS) if (body.includes(leak)) found.push(`${leak} in ${url.split('/').pop()}`);
check(`leak scan over ${scripts.size} loaded scripts (Testnet ids, vault key, Testnet gift domain)`, found.length === 0, found.join('; '));
check('no uncaught page errors', errors.length === 0, errors.join(' | '));

await browser.close();
fs.writeFileSync(`${OUT}/phase4-results.json`, JSON.stringify({ base: BASE, rpc: 'SYNTHETIC responder in the browser (no Mainnet access) — not live evidence', synthetic: SYNTHETIC, results, scripts: scripts.size, errors }, null, 2));
console.log(`\n${results.filter((x) => x.ok).length}/${results.length} passed`);
process.exit(results.every((x) => x.ok) ? 0 : 1);
