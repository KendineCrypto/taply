// Mainnet release-path check in a REAL Chromium (real IndexedDB + real WebCrypto Ed25519 vault)
// against a SYNTHETIC in-page Mainnet RPC. Never contacts a chain; no real key or funds.
// Exercises exactly what the app uses: deviceLedgerStore (apps/web) → Codex's
// createMainnetWalletBackend({store}) → planner → coordinator → executeReservedMainnetHandoff
// → vault signing → OneShotMainnetProvider → FINAL reconciliation.
// With the protocol gate CLOSED (default) it proves nothing is reserved or signed.
// With the release patch applied (docs/release/mainnet-signing-release.patch) it proves the
// full send → FINAL → replay refusal → lost-response UNCERTAIN → block → FINAL cycle.
// usage: node apps/web/scripts/mainnet-release-browser.mjs <playwright-index> <out-dir> [expect=closed|open]
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { realpathSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '../../..');
const require = createRequire(realpathSync(resolve(root, 'apps/web/node_modules/vitest/package.json')));
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const pw = await import(pathToFileURL(resolve(process.argv[2])).href);
const chromium = pw.chromium ?? pw.default.chromium;
const output = resolve(process.argv[3]); mkdirSync(output, { recursive: true });
const expect = process.argv[4] ?? 'closed';
assert.ok(expect === 'closed' || expect === 'open');

const server = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: 0, fs: { allow: [root] },
  watch: { ignored: ['**/artifacts/**', '**/.git/**', '**/.next/**'] } }, logLevel: 'error' });
server.middlewares.use('/release-test', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Mainnet release test</title>'); });
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}/release-test`;
const userData = resolve(output, `profile-${Date.now()}`);
const checks = [];
const ok = (name, detail = '') => { checks.push({ name, ok: true, detail }); console.log(`ok - ${name}${detail ? ` (${detail})` : ''}`); };

async function open(context) {
  const p = await context.newPage();
  await p.goto(url);
  await p.evaluate(async () => {
    const ledger = await import('/apps/web/src/lib/mainnet/device-ledger.ts');
    window.T = { store: ledger.deviceLedgerStore(indexedDB) };
  });
  return p;
}

let context;
try {
  context = await chromium.launchPersistentContext(userData, { headless: true });
  const a = await open(context), b = await open(context);

  // 1. Device ledger CAS: atomic across tabs, durable across reload.
  assert.equal(await a.evaluate(() => T.store.scope), 'device-local');
  const wins = await Promise.all([
    a.evaluate(() => Promise.all(Array.from({ length: 10 }, (_, i) => T.store.compareAndSwap('cas.near', null, `a${i}`)))),
    b.evaluate(() => Promise.all(Array.from({ length: 10 }, (_, i) => T.store.compareAndSwap('cas.near', null, `b${i}`)))),
  ]);
  assert.equal(wins.flat().filter(Boolean).length, 1);
  const winner = await b.evaluate(() => T.store.read('cas.near'));
  ok('20 concurrent compare-and-swaps from two tabs: exactly one wins', winner);
  await a.reload(); await a.evaluate(async () => { const l = await import('/apps/web/src/lib/mainnet/device-ledger.ts'); window.T = { store: l.deviceLedgerStore(indexedDB) }; });
  assert.equal(await a.evaluate(() => T.store.read('cas.near')), winner);
  assert.equal(await a.evaluate(() => T.store.compareAndSwap('cas.near', 'stale', 'x')), false);
  ok('ledger survives reload; stale expected value refused');

  // 2. Full release path through Codex's backend.
  const result = await a.evaluate(async () => {
    const nc = await import('/packages/near-client/src/index.ts');
    const { MAINNET_PROTOCOL_SIGNING_RELEASED } = await import('/packages/near-client/src/mainnet-vault.ts');
    // No bundler in the page: decode the signed transaction by hand (borsh tx || 0x00 || 64-byte ed25519 signature).
    const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const baseEncode = (bytes) => { let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b); let o = ''; while (n > 0n) { o = B58[Number(n % 58n)] + o; n /= 58n; } for (const b of bytes) { if (b !== 0) break; o = '1' + o; } return o; };
    const hexBytes = (h) => Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16));
    const HASH = '11111111111111111111111111111111', HASH2 = '11111111111111111111111111111112';
    const values = new Map();
    const storage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
    const vault = new nc.EncryptedMainnetVault(storage);
    const id = await vault.create('synthetic-offline-only-passphrase');
    await vault.unlock('synthetic-offline-only-passphrase');
    const publicKey = nc.ed25519PublicKeyFromHex(id.publicKeyHex);
    const s = { nonce: 7, height: 120000000, sends: 0, mode: 'ok', tx: null, hash: null, landed: new Map() };
    const outcome = (oid, executor, status, receipt_ids = []) => ({ id: oid, block_hash: HASH, outcome: { executor_id: executor, status, receipt_ids, logs: [], gas_burnt: 1000, tokens_burnt: '0' } });
    const txJson = (t, hash) => ({ final_execution_status: 'FINAL', status: { SuccessValue: '' },
      transaction: { hash, signer_id: t.signer, receiver_id: t.receiver, public_key: publicKey, nonce: t.nonce, actions: [{ Transfer: { deposit: t.deposit } }] },
      transaction_outcome: outcome(hash, t.signer, { SuccessReceiptId: HASH2 }, [HASH2]),
      receipts_outcome: [outcome(HASH2, t.receiver, { SuccessValue: '' })], receipts: [] });
    const reply = (rid, result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: rid, result }), { headers: { 'Content-Type': 'application/json' } });
    const fetcher = async (_url, init) => {
      const r = JSON.parse(init.body); const p = r.params;
      if (r.method === 'status') return reply(r.id, { chain_id: 'mainnet', genesis_hash: nc.MAINNET_GENESIS_HASH, sync_info: { syncing: false } });
      if (r.method === 'block') return reply(r.id, p.block_id === nc.MAINNET_GENESIS_HEIGHT
        ? { header: { hash: nc.MAINNET_GENESIS_HASH, height: nc.MAINNET_GENESIS_HEIGHT, timestamp_nanosec: '1' } }
        : { header: { hash: HASH, height: s.height, timestamp_nanosec: String(BigInt(Date.now()) * 1000000n) } });
      if (r.method === 'EXPERIMENTAL_protocol_config') return reply(r.id, { runtime_config: { storage_amount_per_byte: '10000000000000000000' } });
      if (r.method === 'gas_price') return reply(r.id, { gas_price: '100000000' });
      if (r.method === 'query' && p.request_type === 'view_access_key') return reply(r.id, { nonce: s.nonce, permission: 'FullAccess', block_hash: HASH, block_height: s.height });
      if (r.method === 'query' && p.request_type === 'view_account') return reply(r.id, { amount: '1000000000000000000000000', locked: '0', storage_usage: 182, code_hash: HASH, block_hash: HASH, block_height: s.height });
      if (r.method === 'send_tx') {
        s.sends++;
        const raw = Uint8Array.from(atob(p.signed_tx_base64), (c) => c.charCodeAt(0));
        const body = raw.slice(0, raw.length - 65), sig = raw.slice(raw.length - 64);
        if (raw[raw.length - 65] !== 0) throw new Error('BAD_SIGNATURE_TYPE');
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', body));
        const key = await crypto.subtle.importKey('raw', hexBytes(id.publicKeyHex), 'Ed25519', false, ['verify']);
        if (!(await crypto.subtle.verify('Ed25519', key, sig, digest))) throw new Error('BAD_SIGNATURE');
        const hash = baseEncode(digest);
        const pending = JSON.parse(await T.store.read(id.accountId)).pending;
        if (!pending || pending.state !== 'HANDOFF' || pending.transactionHash !== hash) throw new Error('NOT_RESERVED_BEFORE_BROADCAST');
        const e = pending.expectation;
        s.nonce = Number(e.nonce); s.landed.set(hash, { signer: e.accountId, receiver: e.receiverId, nonce: Number(e.nonce), deposit: e.action.depositYocto });
        if (s.mode === 'lost') throw new TypeError('network connection lost');
        return reply(r.id, txJson(s.landed.get(hash), hash));
      }
      if (r.method === 'EXPERIMENTAL_tx_status' || r.method === 'tx_status') {
        const signed = s.landed.get(p.tx_hash);
        if (!signed) return new Response(JSON.stringify({ jsonrpc: '2.0', id: r.id, error: { code: -32000, name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_TRANSACTION' } } }), { headers: { 'Content-Type': 'application/json' } });
        return reply(r.id, txJson(signed, p.tx_hash));
      }
      throw new Error(`unexpected synthetic method ${r.method}`);
    };
    const profiles = { network: { network: 'near-mainnet', rpcUrl: 'https://rpc.mainnet.fastnear.com', rpcProviderId: 'synthetic' } };
    const DEVICE = crypto.randomUUID();
    const backend = () => nc.createMainnetWalletBackend({ profiles, deviceId: DEVICE, signer: { kind: 'internal', vault }, store: T.store }, fetcher);
    const op = (n) => ({ kind: 'nativeSend', receiverId: 'bob.near', amountNear: '0.01', businessId: String(n).repeat(64).slice(0, 64) });
    const err = async (f) => { try { await f(); return 'NO_ERROR'; } catch (e) { return e?.code ?? e?.message ?? String(e); } };
    const out = { gate: MAINNET_PROTOCOL_SIGNING_RELEASED, accountId: id.accountId };
    const b1 = backend();
    const r1 = await b1.prepare(op(1));
    out.review = { receiver: r1.receiverId, action: r1.action, nonce: r1.nonce, authorityReadsLedger: true };
    if (!MAINNET_PROTOCOL_SIGNING_RELEASED) {
      out.closedSubmit = await err(() => b1.submit(r1.id, async () => true));
      out.closedLedger = await T.store.read(id.accountId);
      out.sends = s.sends;
      return out;
    }
    // Declined confirmation: nothing reserved.
    out.declined = await err(() => b1.submit(r1.id, async () => false));
    out.declinedLedger = await T.store.read(id.accountId);
    // Happy path.
    const r2 = await b1.prepare(op(1));
    const sent = await b1.submit(r2.id, async () => true);
    out.sent = sent;
    out.finalRead = await b1.reconcile(sent.transactionHash);
    out.replay = await err(() => backend().prepare(op(1)));
    // Lost response after broadcast: precomputed hash is durable, outcome unresolved, new payments blocked.
    s.mode = 'lost';
    const r3 = await b1.prepare(op(2));
    const lost = await b1.submit(r3.id, async () => true);
    out.lost = lost;
    out.blockedWhileUnknown = await err(() => backend().prepare(op(3)));
    out.pendingState = JSON.parse(await T.store.read(id.accountId)).pending?.state ?? null;
    s.mode = 'ok';
    out.reconciled = await backend().reconcile();
    out.afterReconcile = (await backend().prepare(op(3))).receiverId;
    out.sends = s.sends;
    out.completed = JSON.parse(await T.store.read(id.accountId)).completed.length;
    return out;
  });
  writeFileSync(resolve(output, 'release-path.json'), JSON.stringify(result, null, 2));
  assert.equal(result.review.receiver, 'bob.near');
  assert.deepEqual(result.review.action, { kind: 'transfer', depositYocto: '10000000000000000000000' });
  assert.equal(result.review.nonce, '8');
  ok('exact review: 0.01 NEAR transfer to bob.near, nonce pinned to chain nonce + 1');
  if (expect === 'closed') {
    assert.equal(result.gate, false);
    assert.equal(result.closedSubmit, 'MAINNET_SIGNING_DISABLED');
    assert.equal(result.closedLedger, null);
    assert.equal(result.sends, 0);
    ok('gate closed: submit refused before any reservation; nothing signed or broadcast');
  } else {
    assert.equal(result.gate, true);
    assert.equal(result.declined, 'USER_REJECTED_BEFORE_HANDOFF'); assert.equal(result.declinedLedger, null);
    ok('declined confirmation: nothing reserved or signed');
    assert.equal(result.sent.kind, 'OUTCOME_UNRESOLVED'); assert.match(result.sent.transactionHash, /^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    assert.equal(result.finalRead.kind, 'FINAL_EXECUTION'); assert.equal(result.finalRead.execution, 'SUCCESS');
    ok('vault-signed 0.01 NEAR broadcast; FINAL execution verified for the exact transaction', result.sent.transactionHash);
    assert.equal(result.replay, 'OPERATION_ALREADY_CONSUMED');
    ok('same payment can never be prepared again (permanent tombstone)');
    assert.equal(result.lost.kind, 'OUTCOME_UNRESOLVED'); assert.ok(result.lost.transactionHash);
    assert.equal(result.blockedWhileUnknown, 'OUTCOME_UNRESOLVED'); assert.equal(result.pendingState, 'UNCERTAIN');
    ok('lost response after broadcast: UNCERTAIN with the precomputed hash; every new payment blocked; no resend');
    assert.equal(result.reconciled.kind, 'FINAL_EXECUTION'); assert.equal(result.afterReconcile, 'bob.near');
    assert.equal(result.sends, 2); assert.equal(result.completed, 2);
    ok('FINAL reconciliation releases the block; exactly 2 broadcasts for 2 payments');
  }
  writeFileSync(resolve(output, 'checks.json'), JSON.stringify(checks, null, 2));
  console.log(`release browser: ${checks.length} checks passed (gate ${expect})`);
} finally {
  await context?.close();
  await server.close();
}
