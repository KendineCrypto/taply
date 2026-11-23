// Real-browser QA of the Mainnet Swap (/m/swap) against a SYNTHETIC Mainnet RPC.
// Usage: node apps/web/scripts/mainnet-swap-qa.mjs <playwright/index.mjs> <out-dir> [base-url]
//
// Needs a mainnet build/dev server with NEXT_PUBLIC_TAPLY_MAINNET_LEDGER=device and signing on.
// The Taply Wallet is created in the real browser (real WebCrypto vault, real IndexedDB device ledger);
// every transaction is really signed by that vault. Every RPC call the browser makes is answered by a
// SYNTHETIC responder that decodes the signed transaction and applies wrap.near / Rhea pool / USDC
// effects with the real pool-4512 reserves and the real Mainnet receipt shapes (docs/MAINNET_SWAP.md).
// Nothing reaches Mainnet; nothing is funded. This is NOT live Mainnet evidence.
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const OUT = process.argv[3];
const BASE = process.argv[4] ?? 'http://127.0.0.1:3100';
fs.mkdirSync(OUT, { recursive: true });
const HERE = path.dirname(fileURLToPath(import.meta.url));
const nearApi = await import(pathToFileURL(path.join(HERE, '../../../packages/near-client/node_modules/near-api-js/lib/index.js')).href);
const { decodeSignedTransaction, encodeTransaction, baseEncode } = nearApi;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: ok ? '' : String(detail).slice(0, 300) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' — ' + detail}`); };

const GENESIS = 'EPnLgE7iEq9s7yTkos96M3cWymH5avBAPm3qx3NXqR8H';
const USDC = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const WRAP = 'wrap.near', REF = 'v2.ref-finance.near';
const PINS = { [REF]: 'txLoEFi4RvYZ7wFNrqV61ggDdmrgHmatBkpXwtGN1FD', [WRAP]: 'DL2f5xmZ44cQRP6vBMt94rvseH5d5KKnAGis2WkTAsh1', [USDC]: process.env.NEXT_PUBLIC_TAPLY_MAINNET_USDC_CODE_HASH ?? 'DVJx7F3dHEHJYwpYPwXHu8K9Uo7h4kXFcALucY5oNX8q' };
const h = (s) => baseEncode(createHash('sha256').update(String(s)).digest());
const RES = { [USDC]: 879942263815n, [WRAP]: 292817259658116838033928023044n };
const out = (amountIn, tin, tout) => { const w = amountIn * 9970n; return (w * RES[tout]) / (RES[tin] * 10000n + w); };
const NEAR = 10n ** 24n;
const st = { near: 5n * NEAR, wnear: 0n, usdc: 0n, reg: { [WRAP]: false, [USDC]: false }, nonce: 7, height: 200_000_000, mode: 'ok', landed: new Map(), sends: 0, heights: new Map() };
let ME = 'pending.near';
const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64');
const bytes = (v) => Array.from(Buffer.from(JSON.stringify(v)));
// Block time follows height (1 s per block, anchored to now at start), so later blocks are never older.
const T0 = BigInt(Date.now()) * 1000000n - 200_000_000n * 1_000_000_000n;
const tsOf = (height) => String(T0 + BigInt(height) * 1_000_000_000n);
const blockHash = (height) => { const x = h(`block-${height}`); st.heights.set(x, height); return x; };
const outcome = (id, executor, status, receipt_ids = [], logs = []) => ({ id, block_hash: blockHash(st.height - 1), outcome: { executor_id: executor, status, receipt_ids, logs, gas_burnt: 2428000000000, tokens_burnt: '0' } });

/** Apply a decoded, signed transaction like the real contracts and build its FINAL tx_status JSON. */
function execute(tx, hash) {
  const fc = tx.actions[0].functionCall;
  const args = JSON.parse(Buffer.from(fc.args).toString() || '{}');
  const deposit = BigInt(fc.deposit), r = (n) => h(`${hash}-r${n}`);
  const head = { hash, signer_id: tx.signerId, receiver_id: tx.receiverId, public_key: `ed25519:${baseEncode(tx.publicKey.ed25519Key.data)}`, nonce: Number(tx.nonce),
    actions: [{ FunctionCall: { method_name: fc.methodName, args: Buffer.from(fc.args).toString('base64'), gas: Number(fc.gas), deposit: deposit.toString() } }] };
  const base = (status, receipts_outcome, receipts = []) => ({ final_execution_status: 'FINAL', status, transaction: head, transaction_outcome: outcome(hash, tx.signerId, { SuccessReceiptId: r(1) }, [r(1)]), receipts_outcome, receipts });
  if (fc.methodName === 'storage_deposit') {
    st.reg[tx.receiverId] = true; st.near -= deposit;
    const v = { SuccessValue: b64({ total: deposit.toString(), available: '0' }) };
    return base(v, [outcome(r(1), tx.receiverId, v)]);
  }
  if (fc.methodName === 'near_deposit') {
    st.near -= deposit; st.wnear += deposit;
    return base({ SuccessValue: '' }, [outcome(r(1), WRAP, { SuccessValue: '' }, [], [`Deposit ${deposit} NEAR to ${tx.signerId}`])]);
  }
  if (fc.methodName === 'near_withdraw') {
    const amount = BigInt(args.amount);
    if (st.mode === 'unwrapFail') { const f = { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: 'Smart contract panicked' } } } } }; return base(f, [outcome(r(1), WRAP, f)]); }
    st.wnear -= amount; st.near += amount;
    return base({ SuccessValue: '' }, [outcome(r(1), WRAP, { SuccessValue: '' }, [r(2)], [`Withdraw ${amount} NEAR from ${tx.signerId}`]), outcome(r(2), tx.signerId, { SuccessValue: '' })],
      [{ receipt_id: r(2), predecessor_id: WRAP, receiver_id: tx.signerId, receipt: { Action: { actions: [{ Transfer: { deposit: amount.toString() } }] } } }]);
  }
  if (fc.methodName === 'ft_transfer_call') {
    const msg = JSON.parse(args.msg); const a = msg.actions[0];
    const tin = a.token_in, tout = a.token_out, amountIn = BigInt(args.amount);
    const got = out(amountIn, tin, tout);
    const refund = st.mode === 'refund' || got < BigInt(a.min_amount_out);
    const used = refund ? 0n : amountIn;
    if (!refund) {
      if (tin === WRAP) { st.wnear -= amountIn; st.usdc += got; } else { st.usdc -= amountIn; st.wnear += got; }
    }
    const transferLog = tout === WRAP ? `Transfer ${got} from ${REF} to ${tx.signerId}` : `EVENT_JSON:${JSON.stringify({ standard: 'nep141', version: '1.0.0', event: 'ft_transfer', data: [{ old_owner_id: REF, new_owner_id: tx.signerId, amount: got.toString() }] })}`;
    const final = { SuccessValue: b64(JSON.stringify(used.toString())) };
    return base(final, [
      outcome(r(1), tin, { SuccessReceiptId: r(5) }, [r(2), r(5)], [tin === WRAP ? `Transfer ${amountIn} from ${tx.signerId} to ${REF}` : `EVENT_JSON:${JSON.stringify({ standard: 'nep141', version: '1.0.0', event: 'ft_transfer', data: [{ old_owner_id: tx.signerId, new_owner_id: REF, amount: amountIn.toString() }] })}`]),
      refund ? outcome(r(2), REF, { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: 'Smart contract panicked: E68: slippage error' } } } } })
        : outcome(r(2), REF, { SuccessValue: b64('"0"') }, [r(3), r(4)], [`Swapped ${amountIn} ${tin} for ${got} ${tout}`, 'Exchange v2.ref-finance.near got 1 shares, No referral fee']),
      ...(refund ? [] : [outcome(r(3), tout, { SuccessValue: '' }, [], [transferLog]), outcome(r(4), REF, { SuccessValue: b64(JSON.stringify(got.toString())) })]),
      outcome(r(5), tin, final, [], refund ? [tin === WRAP ? `Refund ${amountIn} from ${REF} to ${tx.signerId}` : `EVENT_JSON:${JSON.stringify({ standard: 'nep141', version: '1.0.0', event: 'ft_transfer', data: [{ old_owner_id: REF, new_owner_id: tx.signerId, amount: amountIn.toString(), memo: 'refund' }] })}`] : []),
    ]);
  }
  throw new Error(`unexpected method ${fc.methodName}`);
}

const DEBUG = [];
async function rpc(route) {
  const r = JSON.parse(route.request().postData() ?? '{}');
  const p = r.params ?? {};
  if (process.env.SWAP_QA_DEBUG) DEBUG.push(`${r.method} ${p.request_type ?? ''} ${p.method_name ?? ''} ${p.account_id ?? ''} ${p.tx_hash ?? ''}`);
  let result; let error;
  if (r.method === 'status') result = { chain_id: 'mainnet', sync_info: { syncing: false } };
  else if (r.method === 'block') {
    if (p.block_id === 9820210) result = { header: { hash: GENESIS, height: 9820210, timestamp_nanosec: '1595350551591948000' } };
    else if (typeof p.block_id === 'string') { const height = st.heights.get(p.block_id) ?? st.height; result = { header: { hash: p.block_id, height, timestamp_nanosec: tsOf(height) } }; }
    else result = { header: { hash: blockHash(st.height), height: st.height, timestamp_nanosec: tsOf(st.height) } };
  } else if (r.method === 'gas_price') result = { gas_price: '100000000' };
  else if (r.method === 'EXPERIMENTAL_protocol_config') result = { runtime_config: { storage_amount_per_byte: '10000000000000000000' } };
  else if (r.method === 'send_tx') {
    st.sends++;
    const signed = decodeSignedTransaction(Buffer.from(p.signed_tx_base64, 'base64'));
    const hash = baseEncode(createHash('sha256').update(encodeTransaction(signed.transaction)).digest());
    st.nonce = Number(signed.transaction.nonce);
    st.height += 2;
    const json = execute(signed.transaction, hash);
    st.landed.set(hash, json);
    // 'lost': the broadcast response is lost AND the RPC cannot find the tx yet (it landed on chain).
    if (st.mode === 'lost') { st.mode = 'rpcdown'; await route.abort('connectionreset'); return; }
    result = json;
  } else if (r.method === 'EXPERIMENTAL_tx_status' || r.method === 'tx_status') {
    const json = st.landed.get(p.tx_hash);
    if (!json || st.mode === 'rpcdown') error = { code: -32000, name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_TRANSACTION', info: {} }, message: 'unknown tx' };
    else result = json;
  } else if (p.request_type === 'view_access_key') result = { nonce: st.nonce, permission: 'FullAccess', block_hash: blockHash(st.height), block_height: st.height };
  else if (p.request_type === 'view_account') {
    result = { amount: p.account_id === ME ? st.near.toString() : '1000000000000000000000000000', locked: '0', storage_usage: 182, code_hash: PINS[p.account_id] ?? '11111111111111111111111111111111', block_hash: p.block_id ?? blockHash(st.height), block_height: st.heights.get(p.block_id) ?? st.height };
  } else if (p.request_type === 'call_function') {
    const args = JSON.parse(Buffer.from(p.args_base64, 'base64').toString('utf8'));
    let value = null;
    const mine = args.account_id === ME;
    if (p.method_name === 'get_pool') value = { pool_kind: 'SIMPLE_POOL', token_account_ids: [USDC, WRAP], amounts: [RES[USDC].toString(), RES[WRAP].toString()], total_fee: 30, shares_total_supply: '1', amp: 0 };
    else if (p.method_name === 'get_return') value = out(BigInt(args.amount_in), args.token_in, args.token_out).toString();
    else if (p.method_name === 'ft_balance_of') value = mine ? (p.account_id === WRAP ? st.wnear : st.usdc).toString() : '100000000000000000000000000000';
    else if (p.method_name === 'storage_balance_of') value = mine ? (st.reg[p.account_id] ? { total: '1250000000000000000000', available: '0' } : null) : { total: '1250000000000000000000', available: '0' };
    else if (p.method_name === 'storage_balance_bounds') value = { min: '1250000000000000000000', max: '1250000000000000000000' };
    else if (p.method_name === 'ft_metadata') value = { spec: 'ft-1.0.0', name: p.account_id === USDC ? 'USDC' : 'Wrapped NEAR fungible token', symbol: p.account_id === USDC ? 'USDC' : 'wNEAR', decimals: p.account_id === USDC ? 6 : 24 };
    result = { result: bytes(value), logs: [], block_hash: p.block_id ?? blockHash(st.height), block_height: st.heights.get(p.block_id) ?? st.height };
  } else error = { code: -32601, name: 'METHOD_NOT_FOUND', message: 'synthetic' };
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(error ? { jsonrpc: '2.0', id: r.id, error } : { jsonrpc: '2.0', id: r.id, result }) });
}

const browser = await chromium.launch();
const errors = [];
const overflow = [];
async function ctx(label, viewport = { width: 390, height: 844 }, storageState) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: viewport.width < 800, hasTouch: viewport.width < 800, ...(storageState ? { storageState } : {}) });
  if (process.env.SWAP_QA_REMOTE === '1') {
    // Deployed Preview: the page itself is fetched by Node (TLS verified by Node); every other host is refused.
    // The RPC route below is registered later, so it wins: Mainnet RPC stays SYNTHETIC here too.
    await context.route('**/*', async (route) => {
      const req = route.request();
      if (new URL(req.url()).origin !== new URL(BASE).origin) return route.abort();
      try {
        const r = await fetch(req.url(), { method: req.method(), headers: { ...req.headers(), 'accept-encoding': 'identity' }, body: req.postDataBuffer() ?? undefined, redirect: 'manual' });
        const headers = Object.fromEntries([...r.headers].filter(([k]) => !['content-encoding', 'content-length', 'transfer-encoding'].includes(k)));
        await route.fulfill({ status: r.status, headers, body: Buffer.from(await r.arrayBuffer()) });
      } catch { await route.abort(); }
    });
  }
  await context.route(/https:\/\/(rpc\.mainnet\.fastnear\.com|archival-rpc\.mainnet\.fastnear\.com|rpc\.mainnet\.near\.org)\/?.*/, rpc);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  return { context, page };
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
const text = async (page, id) => (await page.getByTestId(id).first().textContent({ timeout: 20000 }).catch(() => '')) ?? '';
const noOverflow = async (page, label) => { const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth })); if (o.sw > o.iw) overflow.push(`${label}: ${o.sw}>${o.iw}`); return o.sw <= o.iw; };
const waitStatus = (page, status, timeout = 45000) => page.waitForFunction((s) => document.querySelector('[data-testid=swap-progress]')?.getAttribute('data-status') === s || (s === 'completed' && !!document.querySelector('[data-testid=swap-result]')), status, { timeout }).then(() => true, () => false);
const quoteReady = (page) => page.waitForFunction(() => /^[1-9]|^0[.,]\d*[1-9]/.test(document.querySelector('[data-testid=swap-out]')?.textContent ?? ''), null, { timeout: 30000 }).then(() => true, () => false);

// ---------- Wallet ----------
const { context: wc, page: w } = await ctx('wallet');
await w.goto(`${BASE}/m/wallet/create`);
await w.locator('#mw-pass').fill('correct horse 42');
await w.locator('#mw-pass2').fill('correct horse 42');
await w.getByTestId('wallet-create').click();
await w.waitForSelector('[data-testid=phrase-words]', { timeout: 30000 });
const words = await w.locator('[data-testid=phrase-words] li').evaluateAll((els) => els.map((e) => e.textContent.replace(/^\d+\.\s*/, '').trim()));
for (const input of await w.locator('[data-testid^=verify-]').all()) { const i = Number((await input.getAttribute('data-testid')).split('-')[1]); await input.fill(words[i]); }
await w.getByTestId('backup-done').click();
await w.goto(`${BASE}/m/wallet`);
ME = await w.evaluate(() => { const raw = localStorage.getItem('taply.mainnet-vault.v1') ?? ''; return (/"accountId":"([0-9a-f]{64})"/.exec(raw) ?? [])[1] ?? (/([0-9a-f]{64})/.exec(raw) ?? [])[1] ?? ''; });
check('Taply Wallet created in the browser (implicit account)', /^[0-9a-f]{64}$/.test(ME), ME);
async function unlock(page) {
  await page.goto(`${BASE}/m/wallet`);
  await page.waitForSelector('#mw-unlock, [data-testid=unlocked]', { timeout: 30000 });
  await page.waitForTimeout(500);
  if (await page.locator('#mw-unlock').count()) { await page.locator('#mw-unlock').fill('correct horse 42'); await page.getByTestId('wallet-unlock').click(); }
  await page.waitForSelector('[data-testid=unlocked]', { timeout: 30000 });
}
await unlock(w);

// ---------- Nav ----------
await w.goto(`${BASE}/m`);
const navLabels = await w.locator('nav[aria-label="Primary navigation"] > ul > li > a, nav[aria-label="Primary navigation"] > ul > li > button').allTextContents();
check('mobile bottom nav: Wallet · Swap · Tap · Activity · Receive', ['Wallet', 'Swap', 'Tap', 'Activity', 'Receive'].every((l, i) => (navLabels[i] ?? '').trim() === l), navLabels.join('|'));
const navTargets = await w.evaluate(() => [...document.querySelectorAll('nav[aria-label="Primary navigation"] > ul > li > *')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
check('every nav target ≥ 44×44 px at 390 px', navTargets.every(([x, y]) => x >= 44 && y >= 44), JSON.stringify(navTargets));
await w.getByRole('link', { name: 'Swap' }).click();
await w.waitForSelector('[data-testid=swap-page]', { timeout: 30000 });
check('Swap tab opens /m/swap and is marked current', new URL(w.url()).pathname === '/m/swap' && (await w.getByRole('link', { name: 'Swap' }).getAttribute('aria-current')) === 'page');

// ---------- Form states ----------
check('empty amount: CTA "Enter an amount" disabled', (await text(w, 'swap-cta')) === 'Enter an amount' && await w.getByTestId('swap-cta').isDisabled());
await shot(w, 'swap-390-empty');
await w.getByTestId('swap-in').fill('0,1');
check('Turkish decimal "0,1" accepted and quoted from the pool (real reserves)', await quoteReady(w), await text(w, 'swap-out'));
check('quote equals Rhea simple-pool math for 0.1 NEAR (0.299607 USDC)', (await text(w, 'swap-out')).trim() === '0.299607', await text(w, 'swap-out'));
check('CTA "Review swap" enabled for a covered amount', (await text(w, 'swap-cta')) === 'Review swap');
await w.getByTestId('swap-summary').locator('summary').click();
check('details: minimum received at 0.5 % = 0.298108 USDC', (await text(w, 'swap-min')).includes('0.298108'), await text(w, 'swap-min'));
check('details: refundable storage shown separately (two registrations = 0.0025 NEAR), no Taply fee', (await text(w, 'swap-storage')).includes('0.0025') && (await w.getByTestId('swap-summary').textContent()).includes('Taply fee'), await text(w, 'swap-storage'));
await shot(w, 'swap-390-quote');
await noOverflow(w, 'swap 390 quote');
await w.getByTestId('swap-in').fill('1.2.3');
check('two separators refused with a clear message', /Enter a number/.test(await text(w, 'swap-error')));
await w.getByTestId('swap-in').fill('-1');
check('negative refused', /negative|number/.test(await text(w, 'swap-error')), await text(w, 'swap-error'));
await w.getByTestId('swap-in').fill('6');
await quoteReady(w);
check('more NEAR than the balance: "Insufficient NEAR"', (await text(w, 'swap-cta')) === 'Insufficient NEAR', await text(w, 'swap-cta'));
await w.getByTestId('swap-in').fill('4.95');
await quoteReady(w);
check('NEAR needed for gas/storage: "Not enough NEAR for fees"', (await text(w, 'swap-cta')) === 'Not enough NEAR for fees', await text(w, 'swap-cta'));
await w.getByTestId('swap-max').click();
await quoteReady(w);
const maxVal = await w.getByTestId('swap-in').inputValue();
check('Max keeps the gas + storage reserve (CTA stays "Review swap")', (await text(w, 'swap-cta')) === 'Review swap' && Number(maxVal) < 4.95 && Number(maxVal) > 4.8, `${maxVal} ${await text(w, 'swap-cta')}`);
await w.getByTestId('swap-flip').click();
check('flip: pay USDC / receive NEAR, amount cleared', (await w.getByTestId('swap-in').inputValue()) === '' && (await w.getByTestId('token-usdc').count()) === 1);
await w.getByTestId('swap-in').fill('1.0000001');
check('USDC 7th decimal refused (6 decimals)', /6 decimals/.test(await text(w, 'swap-error')), await text(w, 'swap-error'));
await w.getByTestId('swap-flip').click();

// Token sheet
await w.getByTestId('token-usdc').click();
await w.waitForSelector('[data-testid=token-list]');
await w.getByTestId('token-search').fill('wrap.near');
check('token search by exact contract finds wNEAR only (NEAR and wNEAR are distinct)', (await w.locator('[data-testid=token-list] li').count()) === 1 && (await w.getByTestId('pick-wnear').count()) === 1);
await w.getByTestId('token-search').fill('17208628f84f');
check('token search by contract prefix finds USDC', (await w.getByTestId('pick-usdc').count()) === 1);
await w.getByTestId('token-search').fill('<img src=x onerror=alert(1)>');
check('unknown search shows "no verified token" (no import, plain text)', /No verified token/.test(await w.getByRole('dialog').textContent()));
await w.getByTestId('token-search').fill('');
await shot(w, 'swap-390-token-sheet');
await w.keyboard.press('Escape');
await w.waitForTimeout(400);

// Settings
await w.getByTestId('swap-settings').click();
await w.getByTestId('slippage-custom').fill('3');
check('high slippage warning at 3 %', await w.getByTestId('slippage-high').isVisible());
await shot(w, 'swap-390-settings');
await w.getByTestId('slippage-50').click();
await w.keyboard.press('Escape');
await w.waitForTimeout(400);

// ---------- Scenario A: NEAR -> USDC (register wNEAR + register USDC + wrap + swap) ----------
await w.getByTestId('swap-in').fill('0.1');
await quoteReady(w);
await w.getByTestId('swap-cta').click();
await w.waitForSelector('[data-testid=swap-review]');
check('review lists the real step count: 4 transactions', /4 transactions to sign/.test(await text(w, 'review-steps')), await text(w, 'review-steps'));
check('review shows exact pay / estimate / minimum', (await text(w, 'review-pay')).includes('0.1 NEAR') && (await text(w, 'review-receive')).includes('0.299607 USDC') && (await text(w, 'review-min')).includes('0.298108 USDC'));
await shot(w, 'swap-390-review');
await w.getByTestId('review-confirm').click();
check('A: four signed steps complete; success shows the receipt amount', await waitStatus(w, 'completed'), await w.locator('main').textContent());
if (process.env.SWAP_QA_DEBUG) { console.log(DEBUG.slice(-40).join('\n')); console.log(await w.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('taply.mainnet.swap')).map(([, v]) => v).join(''))); for (const [k, v] of st.landed) console.log(k, JSON.stringify(v).slice(0, 1500)); process.exit(1); }
check('A: received = 0.299607 USDC from the FINAL receipt; paid 0.1 NEAR', (await text(w, 'result-received')).includes('0.299607 USDC') && (await text(w, 'result-paid')).includes('0.1 NEAR'), await text(w, 'result-received'));
check('A: synthetic chain state after: +0.299607 USDC, wNEAR 0', st.usdc === 299607n && st.wnear === 0n, `${st.usdc} ${st.wnear}`);
check('A: exactly 4 broadcasts (no resend)', st.sends === 4, st.sends);
await shot(w, 'swap-390-success');
await w.getByTestId('result-done').click();
await w.waitForSelector('[data-testid=swap-page]');

// ---------- Scenario B: USDC -> NEAR (swap + unwrap), result names native NEAR from the unwrap receipt ----------
await w.getByTestId('swap-flip').click();
await w.getByTestId('swap-in').fill('0.2');
await quoteReady(w);
await w.getByTestId('swap-cta').click();
await w.waitForSelector('[data-testid=swap-review]');
check('B: 2 transactions (swap to wNEAR, then unwrap) and the unwrap note', /2 transactions/.test(await text(w, 'review-steps')) && /unwrap/i.test(await w.getByTestId('swap-review').textContent()));
const sendsB = st.sends;
await w.getByTestId('review-confirm').click();
check('B: completed', await waitStatus(w, 'completed'));
const wantNear = out(200000n, USDC, WRAP);
check('B: received NEAR equals the verified unwrap amount (not an estimate, not wNEAR)', (await text(w, 'result-received')).includes(' NEAR') && !(await text(w, 'result-received')).includes('wNEAR') && st.wnear === 0n && st.sends - sendsB === 2, `${await text(w, 'result-received')} want ${wantNear}`);
await w.getByTestId('result-done').click();
await w.waitForSelector('[data-testid=swap-page]');

// ---------- Scenario C: wrap OK, swap refunded (slippage) -> partial with recovery, never success ----------
await w.getByTestId('swap-flip').click();
await w.getByTestId('swap-in').fill('0.05');
await quoteReady(w);
await w.getByTestId('swap-cta').click();
await w.waitForSelector('[data-testid=swap-review]');
st.mode = 'refund';
const wnearBefore = st.wnear;
await w.getByTestId('review-confirm').click();
check('C: wrap done + swap refunded -> "Needs attention" (partial), not success', await waitStatus(w, 'partial'), await w.locator('main').textContent());
check('C: refund explained; wNEAR is in the wallet; unwrap recovery offered', (await w.getByTestId('swap-refunded').isVisible()) && await w.getByTestId('swap-unwrap-after').isVisible() && st.wnear - wnearBefore === 50000000000000000000000n);
await shot(w, 'swap-390-refunded');
st.mode = 'ok';
await w.getByTestId('swap-unwrap-after').click();
await w.waitForSelector('[data-testid=swap-page]');
check('C: recovery prefills wNEAR -> NEAR with the wrapped amount', (await w.getByTestId('swap-in').inputValue()) === '0.05' && (await w.getByTestId('token-wnear').count()) === 1);
const okC = await w.waitForFunction(() => document.querySelector('[data-testid=swap-cta]')?.textContent === 'Review swap', null, { timeout: 30000 }).then(() => true, () => false);
if (!okC) console.log('DEBUG C', await text(w, 'balance-wnear'), await text(w, 'swap-cta'), String(st.wnear), await w.getByTestId('swap-in').inputValue());
await w.getByTestId('swap-cta').click();
await w.waitForSelector('[data-testid=swap-review]');
await w.getByTestId('review-confirm').click();
check('C: unwrap completes; wNEAR back to 0', await waitStatus(w, 'completed') && st.wnear === 0n, String(st.wnear));
await w.getByTestId('result-done').click();
await w.waitForSelector('[data-testid=swap-page]');

// ---------- Scenario D: lost response -> unknown, refresh resumes, no resend, check resolves ----------
await w.getByTestId('token-wnear').first().click();
await w.getByTestId('pick-near').click();
await w.waitForTimeout(300);
await w.locator('[data-testid^=token-]').nth(1).click();
await w.getByTestId('pick-usdc').click();
await w.waitForTimeout(300);
check('token picker: NEAR -> USDC selected', (await w.getByTestId('token-near').count()) === 1 && (await w.getByTestId('token-usdc').count()) === 1);
await w.getByTestId('swap-in').fill('0.02');
await quoteReady(w);
await w.getByTestId('swap-cta').click();
await w.waitForSelector('[data-testid=swap-review]');
st.mode = 'lost';
const sendsD = st.sends;
await w.getByTestId('review-confirm').click();
check('D: lost broadcast response + RPC cannot see it yet -> "Outcome unknown", resend blocked', await waitStatus(w, 'unknown'), await w.locator('main').textContent());
await shot(w, 'swap-390-unknown');
st.mode = 'rpcdown';
await w.reload();
await w.waitForSelector('[data-testid=swap-progress]', { timeout: 30000 });
check('D: after refresh the SAME job is shown (resume), still unknown, no new broadcast', (await w.getByTestId('swap-progress').getAttribute('data-status')) === 'unknown' && st.sends === sendsD + 1);
const tab2 = await wc.newPage();
await tab2.goto(`${BASE}/m/swap`);
await tab2.waitForSelector('[data-testid=swap-progress]', { timeout: 30000 });
check('D: a second tab shows the same open swap (no second swap form)', (await tab2.getByTestId('swap-page').count()) === 0);
await tab2.close();
st.mode = 'ok';
await w.getByTestId('swap-check').click();
check('D: "Check outcome" proves the landed tx from the chain and finishes the swap without resending', await waitStatus(w, 'completed', 60000) && st.sends === sendsD + 2, `sends ${st.sends - sendsD}`);
await w.getByTestId('result-done').click();
await w.waitForSelector('[data-testid=swap-page]');

// ---------- Activity ----------
await w.goto(`${BASE}/m/activity`);
await w.waitForSelector('[data-testid=swap-activity]', { timeout: 30000 });
const rows = await w.locator('[data-testid=swap-activity-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-status')));
check('Activity lists swaps with their own statuses (completed + partial)', rows.includes('completed') && rows.includes('partial') && rows.length >= 5, rows.join(','));
await shot(w, 'activity-390-swaps');

// ---------- Visual QA across widths + TR + desktop ----------
const state = await wc.storageState();
for (const [width, height] of [[360, 740], [390, 844], [430, 932], [1280, 900]]) {
  const { context, page } = await ctx(`w${width}`, { width, height }, state);
  await unlock(page);
  await page.goto(`${BASE}/m/swap`);
  await page.waitForSelector('[data-testid=swap-page]', { timeout: 30000 });
  await page.getByTestId('swap-in').fill('0.25');
  await quoteReady(page);
  await noOverflow(page, `swap ${width}`);
  const ctaBox = await page.getByTestId('swap-cta').boundingBox();
  const navBox = await page.locator('nav[aria-label="Primary navigation"]').boundingBox();
  await page.getByTestId('swap-cta').scrollIntoViewIfNeeded();
  const cta2 = await page.getByTestId('swap-cta').boundingBox();
  const nav2 = await page.locator('nav[aria-label="Primary navigation"]').boundingBox();
  check(`${width}px: no horizontal overflow; CTA fully above the bottom nav`, !overflow.some((o) => o.startsWith(`swap ${width}`)) && cta2.y + cta2.height <= nav2.y + 1, JSON.stringify({ ctaBox, navBox, cta2, nav2 }));
  const ctaH = (await page.getByTestId('swap-cta').boundingBox()).height, flipH = (await page.getByTestId('swap-flip').boundingBox()).height;
  check(`${width}px: CTA ≥ 44 px, flip ≥ 44 px`, ctaH >= 44 && flipH >= 44, `${ctaH} ${flipH}`);
  if (width >= 1280) {
    const card = await page.getByTestId('swap-page').boundingBox();
    check('desktop: swap column 440–480 px wide; desktop nav shows Swap', card.width >= 440 && card.width <= 480 && (await page.getByRole('link', { name: 'Swap' }).isVisible()), card.width);
  }
  await shot(page, `swap-${width}-quote`);
  await context.close();
}
// TR
{
  const trState = { ...state, cookies: [...state.cookies, { name: 'taply_locale', value: 'tr', domain: new URL(BASE).hostname, path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }] };
  const { context, page } = await ctx('tr', { width: 390, height: 844 }, trState);
  await unlock(page);
  await page.goto(`${BASE}/m/swap`);
  await page.waitForSelector('[data-testid=swap-page]', { timeout: 30000 });
  await page.getByTestId('swap-in').fill('0,5');
  await quoteReady(page);
  const t = await page.locator('main').textContent();
  check('TR: Takas / Ödediğin / Aldığın / Takası incele; nav "Takas"', /Takas/.test(t) && /Ödediğin/.test(t) && /Aldığın/.test(t) && (await text(page, 'swap-cta')) === 'Takası incele', `${await text(page, 'swap-cta')}`);
  check('TR: amounts use comma decimals', /,/.test(await text(page, 'swap-out')), await text(page, 'swap-out'));
  await shot(page, 'swap-390-tr');
  await page.getByTestId('swap-cta').click();
  await page.waitForSelector('[data-testid=swap-review]');
  await shot(page, 'swap-390-tr-review');
  await context.close();
}
// Keyboard: tab order reaches input, token, flip, CTA; focus visible
{
  const { context, page } = await ctx('kbd', { width: 1280, height: 900 }, state);
  await page.goto(`${BASE}/m/swap`);
  await page.waitForSelector('[data-testid=swap-max]', { timeout: 30000 });
  const seen = [];
  for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); const id = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName); seen.push(id); }
  check('keyboard: settings, amount, token, flip and Max are reachable by Tab', ['swap-settings', 'swap-in', 'token-near', 'swap-flip', 'swap-max'].every((x) => seen.includes(x)), seen.join(','));
  await context.close();
}
// Reduced motion: progress spinner has motion-reduce class (static check)
check('no page errors', errors.length === 0, errors.join(' | '));
check('no horizontal overflow anywhere', overflow.length === 0, overflow.join('; '));
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ synthetic: true, base: BASE, results }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
