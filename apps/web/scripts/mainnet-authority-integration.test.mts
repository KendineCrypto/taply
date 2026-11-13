// Integration test: the APP's authority client (src/lib/mainnet/authority-client.ts) against Codex's REAL
// authenticated authority stack over HTTP, on a REAL redis-server, with the IN-MEMORY TEST WITNESS and a
// SYNTHETIC chain (scripts/mainnet-authority-harness.mts). Wallet authorization uses a TEST-ONLY disposable
// key and exactly Codex's mainnetAuthorityMessageParameters + mainnetAuthorityPayload bytes (the same
// bytes EncryptedMainnetVault.authorizeAuthorityCommand signs once the gate opens). The app itself has no
// such signer: in every app build the vault/NEAR Connect authorization rejects while signing is gated.
// Nothing here touches Mainnet, signs a transaction or moves funds.
//
// Run: node --test apps/web/scripts/mainnet-authority-integration.test.mts   (needs redis-server on PATH)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { calculateMainnetRequestId, canonicalJson } from '../../../packages/shared/dist/index.js';
import {
  createMainnetOperationPlanner, createMainnetWalletChain, mainnetAuthorityMessageParameters, mainnetAuthorityPayload,
  bindMainnetCommerceTerms, verifyMainnetCommerceBinding,
} from '../../../packages/near-client/dist/index.js';
import type { MainnetAuthorityCommand, MainnetCommerceSession, MainnetOperation } from '../../../packages/near-client/dist/index.js';
import { ed25519PublicKeyFromHex } from '../../../packages/near-client/dist/wallet-chain.js';
import { executeReservedMainnetHandoff } from '../../../packages/near-client/dist/mainnet-handoff.js';
import { AuthorityError, createHttpMainnetAuthority } from '../src/lib/mainnet/authority-client.ts';
import type { AuthoritySigner } from '../src/lib/mainnet/authority-client.ts';
import { saleMatches } from '../src/lib/mainnet/commerce.ts';
import { BLOCK, harnessProfiles, resp, startAuthorityHarness, syntheticChain } from './mainnet-authority-harness.mts';

const hasRedis = spawnSync('redis-server', ['--version']).status === 0;
if (!hasRedis && process.env['TAPLY_REQUIRE_REDIS'] === '1') throw new Error('redis-server is required for this integration test (TAPLY_REQUIRE_REDIS=1)');
const ONE = '1000000000000000000000000';
let redisProc: ReturnType<typeof spawn> | undefined;
let harness: Awaited<ReturnType<typeof startAuthorityHarness>> | undefined;
const chain = syntheticChain();
const profiles = harnessProfiles();
const redisPort = 21000 + Math.floor(Math.random() * 10000);
const port = 31000 + Math.floor(Math.random() * 10000);

function key() {
  const k = generateKeyPairSync('ed25519');
  return { privateKey: k.privateKey, publicKey: ed25519PublicKeyFromHex(k.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex')) };
}
/** TEST-ONLY signer: Codex's challenge validation + NEP-413 bytes, signed with a disposable key. */
function testSigner(accountId: string, k: { privateKey: KeyObject; publicKey: string }, calls = { n: 0 }): AuthoritySigner {
  return {
    accountId, publicKey: k.publicKey,
    async authorize(challenge, command, policyHash) {
      calls.n++;
      const params = await mainnetAuthorityMessageParameters(challenge, { accountId, publicKey: k.publicKey, command, policyHash });
      const digest = createHash('sha256').update(mainnetAuthorityPayload(params)).digest();
      return { accountId, publicKey: k.publicKey, signature: sign(null, digest, k.privateKey).toString('base64') };
    },
  };
}
/** A browser-like device: exact Mainnet Origin and its own cookie jar (HttpOnly device credential). */
function device() {
  let cookie = '';
  return {
    cookie: () => cookie,
    fetcher: async (url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      headers.set('origin', 'https://mainnet.taplyapp.xyz');
      if (cookie) headers.set('cookie', cookie);
      // Node fetch has no browser credentials mode; the cookie jar above plays that role.
      const res = await fetch(url, { method: init.method ?? 'GET', body: init.body ?? null, headers, cache: 'no-store', redirect: 'error' });
      const set = res.headers.get('set-cookie');
      if (set) { assert.match(set, /HttpOnly/); assert.match(set, /Secure/); assert.match(set, /SameSite=Strict/); cookie = set.split(';')[0]!; }
      return res;
    },
  };
}
const client = (signer: AuthoritySigner, d = device(), p = profiles) =>
  createHttpMainnetAuthority({ signer, profiles: p, base: `http://127.0.0.1:${port}/api/mainnet/authority`, fetcher: d.fetcher });

async function review(accountId: string, publicKey: string, operation: MainnetOperation, external = false) {
  const s = (await createMainnetWalletChain(profiles.network, chain.fetcher as typeof fetch).snapshot(accountId, publicKey))!;
  const plan = await createMainnetOperationPlanner(profiles, chain.fetcher as typeof fetch).prepare(operation, s);
  const expectation = { accountId, publicKey, receiverId: plan.receiverId, action: plan.action,
    nonce: external ? null : (BigInt(s.nonce) + 1n).toString(), minimumNonce: s.nonce, anchorHash: s.blockHash, anchorHeight: s.blockHeight };
  return { operationHash: plan.operationHash, expectation };
}
const out = (id: string, executor: string, status: unknown, ids: string[] = []) => ({ id, block_hash: BLOCK, outcome: { executor_id: executor, status, receipt_ids: ids, logs: [], gas_burnt: 100, tokens_burnt: '1' } });
function finalTransfer(hash: string, from: string, publicKey: string, nonce: number, to: string, deposit: string) {
  const receipt = '11111111111111111111111111111119';
  return { final_execution_status: 'FINAL', status: { SuccessValue: '' },
    transaction: { hash, signer_id: from, public_key: publicKey, nonce, receiver_id: to, actions: [{ Transfer: { deposit } }] },
    transaction_outcome: out(hash, from, { SuccessReceiptId: receipt }, [receipt]), receipts_outcome: [out(receipt, to, { SuccessValue: '' })] };
}

before(async () => {
  if (!hasRedis) return;
  redisProc = spawn('redis-server', ['--port', String(redisPort), '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { const c = resp(redisPort); await c.command(['PING']); c.close(); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  harness = await startAuthorityHarness({ port, redisPort, profiles, chain });
});
after(() => { harness?.close(); redisProc?.kill(); });

test('authentication: NEP-413 challenge per command, HttpOnly device enrollment, single use, policy pinned locally', { skip: !hasRedis }, async () => {
  const k = key(), calls = { n: 0 };
  await harness!.provision('alice.near', k.publicKey);
  const a = device(), alice = client(testSigner('alice.near', k, calls), a);
  assert.equal(await alice.read('alice.near'), null, 'fresh account: no ledger');
  assert.match(a.cookie(), /^__Host-taply-mainnet-device=[A-Za-z0-9_-]{43}$/);
  const owner = alice.deviceId();
  assert.match(owner ?? '', /^[0-9a-f-]{36}$/);
  // A different policy (e.g. another contract pin) is refused BEFORE the wallet is asked to sign.
  const before = calls.n;
  const wrong = client(testSigner('alice.near', k, calls), a, { ...profiles, instant: { ...profiles.instant!, contract: { ...profiles.instant!.contract, accountId: 'taply-pay.kendinecrypto.near' } } });
  await assert.rejects(wrong.read('alice.near'), (e: unknown) => e instanceof AuthorityError && e.code === 'INVALID_AUTHORITY_CHALLENGE');
  assert.equal(calls.n, before, 'no signature for a mismatched policy');
  // Replay: re-sending an executed challenge is refused (consumed durably before verification).
  const command: MainnetAuthorityCommand = { method: 'read' };
  const ch = await (await a.fetcher(`http://127.0.0.1:${port}/api/mainnet/authority/challenge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ publicKey: k.publicKey, command }) })).json();
  const signed = await testSigner('alice.near', k).authorize(ch, command, await (await import('../src/lib/mainnet/authority-client.ts')).policyHashOf(profiles));
  const exec = () => a.fetcher(`http://127.0.0.1:${port}/api/mainnet/authority/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: ch.id, command, signed }) });
  assert.equal((await exec()).status, 200);
  assert.equal((await exec()).status, 503, 'replayed authorization refused');
  // A forged signature never authenticates.
  const forged = client({ accountId: 'alice.near', publicKey: k.publicKey, authorize: async () => ({ accountId: 'alice.near', publicKey: k.publicKey, signature: Buffer.alloc(64).toString('base64') }) }, a);
  await assert.rejects(forged.read('alice.near'), (e: unknown) => e instanceof AuthorityError && e.code === 'AUTHORITY_REFUSED');
});

test('device ownership: first enrolled device owns writes; a second device can read but never reserve (no takeover)', { skip: !hasRedis }, async () => {
  const k = key();
  await harness!.provision('dora.near', k.publicKey);
  const first = client(testSigner('dora.near', k), device());
  await first.read('dora.near');
  const second = client(testSigner('dora.near', k), device());
  await second.read('dora.near');
  assert.notEqual(second.deviceId(), first.deviceId());
  const r = await review('dora.near', k.publicKey, { kind: 'nativeSend', receiverId: 'bob.near', amountNear: '1', businessId: 'd'.repeat(64) });
  await assert.rejects(second.reserve(r.operationHash, r.expectation, { kind: 'nativeSend', receiverId: 'bob.near', amountNear: '1', businessId: 'd'.repeat(64) }),
    (e: unknown) => e instanceof AuthorityError && e.code === 'AUTHORITY_REFUSED');
  const owned = await first.reserve(r.operationHash, r.expectation, { kind: 'nativeSend', receiverId: 'bob.near', amountNear: '1', businessId: 'd'.repeat(64) });
  assert.equal(owned.state, 'RESERVED');
  assert.equal((await second.read('dora.near'))?.ownerDeviceId, first.deviceId(), 'ownership unchanged');
});

test('reserve-before-handoff, lost response, durable UNCERTAIN, FINAL reconciliation, permanent replay prevention', { skip: !hasRedis }, async () => {
  const k = key();
  await harness!.provision('bob.near', k.publicKey);
  const bob = client(testSigner('bob.near', k));
  await bob.read('bob.near');
  const op: MainnetOperation = { kind: 'nativeSend', receiverId: 'carol.near', amountNear: '1', businessId: 'b'.repeat(64) };
  const r = await review('bob.near', k.publicKey, op);
  const attempt = await bob.reserve(r.operationHash, r.expectation, op);
  assert.equal(attempt.state, 'RESERVED');
  const TX = '1111111111111111111111111111111A';
  // Codex's sequencer over the HTTP authority: hash persisted at handoff, then the network response is lost.
  const result = await executeReservedMainnetHandoff(bob, attempt, async () => ({ transactionHash: TX, async send() { throw new Error('connection reset'); } }));
  assert.deepEqual(result, { kind: 'OUTCOME_UNRESOLVED', transactionHash: TX }, 'a lost response is unresolved, never "failed"');
  const ledger = await bob.read('bob.near');
  assert.equal(ledger?.pending?.state, 'UNCERTAIN');
  assert.equal(ledger?.pending?.transactionHash, TX);
  const other = await review('bob.near', k.publicKey, { ...op, businessId: 'c'.repeat(64) });
  await assert.rejects(bob.reserve(other.operationHash, other.expectation, { ...op, businessId: 'c'.repeat(64) }), 'unknown outcome blocks every new payment');
  assert.equal((await bob.reconcile('bob.near')).kind, 'OUTCOME_UNRESOLVED', 'no FINAL transaction yet → still unknown');
  harness!.chain.addTx(TX, finalTransfer(TX, 'bob.near', k.publicKey, 8, 'carol.near', ONE));
  const proof = await bob.reconcile('bob.near');
  assert.equal(proof.kind, 'FINAL_EXECUTION');
  assert.equal((proof as { settlement: string }).settlement, 'NOT_ESTABLISHED');
  assert.equal((await bob.read('bob.near'))?.pending, null);
  await assert.rejects(bob.reserve(r.operationHash, { ...r.expectation, nonce: '9', minimumNonce: '8' }, op), 'same business operation can never be reserved again');
});

test('external wallet: a hash lost before persistence is never attributed later (account stays blocked)', { skip: !hasRedis }, async () => {
  const k = key();
  await harness!.provision('erin.near', k.publicKey);
  const erin = client(testSigner('erin.near', k));
  await erin.read('erin.near');
  const op: MainnetOperation = { kind: 'nativeSend', receiverId: 'carol.near', amountNear: '1', businessId: 'e'.repeat(64) };
  const r = await review('erin.near', k.publicKey, op, true);
  const attempt = await erin.reserve(r.operationHash, r.expectation, op);
  const result = await executeReservedMainnetHandoff(erin, attempt, async () => ({ transactionHash: null, async send() { throw new Error('wallet closed'); } }));
  assert.deepEqual(result, { kind: 'OUTCOME_UNRESOLVED', transactionHash: null });
  const GUESS = '1111111111111111111111111111111B';
  harness!.chain.addTx(GUESS, finalTransfer(GUESS, 'erin.near', k.publicKey, 8, 'carol.near', ONE));
  assert.equal((await erin.reconcile('erin.near', GUESS)).kind, 'OUTCOME_UNRESOLVED', 'a manual hint cannot retire an external attempt lost before hash persistence');
  assert.equal((await erin.read('erin.near'))?.pending?.state, 'UNCERTAIN');
});

test('merchant binding: one session ↔ one immutable set of terms (Codex bindCommerce)', { skip: !hasRedis }, async () => {
  const k = key();
  await harness!.provision('merchant.near', k.publicKey);
  const shop = client(testSigner('merchant.near', k));
  await shop.read('merchant.near');
  const nonce = randomBytes(32).toString('hex');
  const expires = (BigInt(Date.now()) * 1_000_000n + 3_600_000_000_000n).toString();
  const draft = { schemaVersion: 'taply.intent.v1' as const, id: calculateMainnetRequestId({ network: 'near-mainnet', contractId: 'devkendinecrypto.near', creatorAccountId: 'merchant.near', creationNonce: nonce }),
    network: 'near-mainnet' as const, contractId: 'devkendinecrypto.near' as const, creationNonce: nonce, creatorAccountId: 'merchant.near', assetId: 'near:native' as const,
    amountBaseUnits: '500000000000000000000000', mode: 'instant' as const, cancelDurationNs: null, fundingExpiresAtNs: expires,
    permittedPayerAccountId: null, merchantAccountId: null, memo: 'Table 4', sessionBinding: null };
  const session: MainnetCommerceSession = { version: 'taply.commerce.v1', network: 'near-mainnet', contractId: 'devkendinecrypto.near', merchantAccountId: 'merchant.near',
    sessionId: randomBytes(32).toString('hex'), sessionNonce: randomBytes(32).toString('hex'), expiresAtNs: expires };
  const first = await shop.bindCommerce('instant', draft, session);
  assert.equal(canonicalJson(first), canonicalJson(bindMainnetCommerceTerms('instant', draft, session)), 'server freeze equals the local binding');
  const again = await shop.bindCommerce('instant', draft, session);
  assert.equal(again.termsHash, first.termsHash, 'same session + same terms → same commitment');
  assert.equal(again.terms.id, first.terms.id, 'repeated request creation yields the same request id');
  await assert.rejects(shop.bindCommerce('instant', { ...draft, amountBaseUnits: '600000000000000000000000' }, session), 'same session, changed amount → refused');
  await assert.rejects(shop.bindCommerce('instant', draft, { ...session, merchantAccountId: 'mallory.near' }), 'changed merchant → refused');
  const otherSession = { ...session, sessionNonce: randomBytes(32).toString('hex') };
  assert.equal(verifyMainnetCommerceBinding('instant', first.terms, otherSession, first.termsHash), false, 'invalid commitment → refused');
  const different = bindMainnetCommerceTerms('instant', { ...draft, amountBaseUnits: '1' }, { ...session, sessionId: randomBytes(32).toString('hex') });
  assert.equal(saleMatches(different.terms, { session, termsHash: first.termsHash }), false, 'customer receiving a different request than reviewed → refused');
  assert.equal(saleMatches(first.terms, { session, termsHash: first.termsHash }), true);
});

test('fail closed: Redis rollback behind the witness, missing provisioning and unknown routes', { skip: !hasRedis }, async () => {
  const k = key();
  await harness!.provision('frank.near', k.publicKey);
  const frank = client(testSigner('frank.near', k));
  const keyName = 'taply:mainnet:authority:v1:frank.near';
  const before = await harness!.redis.command(['GET', keyName]) as string;
  await frank.read('frank.near');
  await harness!.redis.command(['SET', keyName, before]);
  await assert.rejects(frank.read('frank.near'), (e: unknown) => e instanceof AuthorityError && e.code === 'AUTHORITY_REFUSED', 'acknowledged rollback fails closed');
  const ghost = key();
  await assert.rejects(client(testSigner('ghost.near', ghost)).read('ghost.near'), 'unprovisioned account never initializes itself');
  const missing = createHttpMainnetAuthority({ signer: testSigner('frank.near', k), profiles, base: `http://127.0.0.1:${port}/api/mainnet/not-mounted`, fetcher: device().fetcher });
  await assert.rejects(missing.read('frank.near'), (e: unknown) => e instanceof AuthorityError && e.code === 'AUTHORITY_UNAVAILABLE', 'unmounted endpoint (every production deployment) → unavailable');
  const keys = await harness!.redis.command(['KEYS', '*']) as string[];
  assert.ok(keys.every((x) => x.startsWith('taply:mainnet:authority:')), 'only the authority namespace is used');
  const ttl = await harness!.redis.command(['PTTL', 'taply:mainnet:authority:v1:bob.near']);
  assert.equal(ttl, -1, 'ledger records never expire');
});
