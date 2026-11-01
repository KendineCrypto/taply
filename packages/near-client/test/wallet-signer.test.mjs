import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signerFixture, PASSWORD } from './wallet-signer-fixture.mjs';
import { WALLET_REVIEW_TTL_MS } from '../dist/wallet-backend.js';
import { signVaultTransaction } from '../dist/wallet-vault.js';
import { PublicKey, actions, createTransaction } from 'near-api-js';
import { ed25519PublicKeyFromHex } from '../dist/wallet-chain.js';

const receiver = 'receiver.testnet';
test('official SDK signs with nonextractable Web Crypto; persists exact local hash before one-shot send and FINAL', async () => {
  const f = await signerFixture();
  const review = await f.backend.prepareTransfer(receiver, '0.1');
  assert.equal(Object.isFrozen(review), true); assert.equal(review.depositYocto, '100000000000000000000000');
  assert.equal(review.signerAccountId, f.identity.accountId);
  const result = await f.backend.submit(review.id, async seen => { assert.equal(seen, review); return true; });
  assert.equal(result.kind, 'final'); assert.equal(result.outcome, 'SUCCEEDED'); assert.equal(result.settlementProof, 'NOT_VERIFIED');
  assert.equal(f.state.sends, 1); assert.equal(f.state.signs, 1); assert.equal(f.state.nonextractable, true); assert.equal(f.state.exportAttempts, 0);
  assert.equal(f.journal.read().phase, 'FINAL_SUCCEEDED');
  assert.equal(JSON.stringify([...f.values.values()]).includes(PASSWORD), false);
  const again = await f.makeBackend().reconcile(); assert.deepEqual(again, result); assert.equal(f.state.sends, 1);
  f.vault.lock();
});
test('explicit decline, disabled approval, locked vault, stale review and stale nonce never sign or send', async () => {
  for (const scenario of ['decline', 'disabled', 'locked', 'expired', 'nonce', 'lock-during-confirm', 'revoke-during-confirm']) {
    const f = await signerFixture(); const review = await f.backend.prepareTransfer(receiver, '0.1');
    if (scenario === 'disabled') f.state.enabled = false;
    if (scenario === 'locked') f.vault.lock();
    if (scenario === 'expired') f.state.now += WALLET_REVIEW_TTL_MS;
    await assert.rejects(f.backend.submit(review.id, async () => {
      if (scenario === 'nonce') f.state.nonce++;
      if (scenario === 'lock-during-confirm') f.vault.lock();
      if (scenario === 'revoke-during-confirm') f.state.enabled = false;
      return scenario !== 'decline';
    }));
    assert.equal(f.state.signs, 0, scenario); assert.equal(f.state.sends, 0, scenario); f.vault.lock();
  }
});
for (const mode of ['timeout', 'body_timeout', 'http503', 'stale_nonce']) test(`${mode}: one send only, durable UNKNOWN, reload reconciles same hash without a retry`, async () => {
  const f = await signerFixture(); f.state.mode = mode;
  const review = await f.backend.prepareTransfer(receiver, '0.1');
  const result = await f.backend.submit(review.id, async () => true);
  assert.equal(result.kind, 'unknown'); assert.equal(result.transactionHash, f.journal.read().transactionHash);
  assert.equal(f.state.sends, 1); assert.equal(f.journal.read().phase, 'UNKNOWN');
  if (mode === 'body_timeout') assert.equal(f.state.bodyCancelled, true);
  await assert.rejects(f.backend.prepareTransfer(receiver, '0.1'), { code: 'OUTCOME_UNRESOLVED' });
  await assert.rejects(f.backend.submit(review.id, async () => true));
  f.vault.lock(); f.state.dropHistory = true;
  assert.equal((await f.makeBackend().reconcile()).kind, 'unknown');
  assert.equal(f.journal.read().phase, 'UNKNOWN');
  f.state.dropHistory = false;
  assert.equal((await f.makeBackend().reconcile()).kind, 'final'); assert.equal(f.state.sends, 1);
});
test('signature corruption, changed key identity and insufficient funds fail before broadcast', async () => {
  const f = await signerFixture(); const review = await f.backend.prepareTransfer(receiver, '0.1');
  f.state.corruptSignature = true;
  assert.equal((await f.backend.submit(review.id, async () => true)).kind, 'unknown');
  assert.equal(f.state.sends, 0); assert.equal(f.journal.read().phase, 'NOT_SENT');
  f.state.corruptSignature = false; f.state.amount = '1';
  await assert.rejects(f.backend.prepareTransfer(receiver, '0.1'), { code: 'INSUFFICIENT_AVAILABLE_BALANCE' });
  const wrongKey = new PublicKey({ keyType: 0, data: crypto.getRandomValues(new Uint8Array(32)) });
  await assert.rejects(signVaultTransaction(f.vault, createTransaction(f.identity.accountId, wrongKey, receiver, 8n, [actions.transfer(1n)], new Uint8Array(32))), { code: 'INVALID_RECORD' });
  f.vault.lock();
});
test('storage failure before hash persistence, forged actions and wrong network cannot produce a send or false FINAL', async () => {
  const f = await signerFixture(); const review = await f.backend.prepareTransfer(receiver, '0.1');
  const set = f.storage.setItem;
  f.storage.setItem = (key, value) => { if (JSON.parse(value).phase === 'SUBMITTED') throw Error('storage full'); set(key, value); };
  assert.equal((await f.backend.submit(review.id, async () => true)).kind, 'unknown'); assert.equal(f.state.sends, 0);
  f.storage.setItem = set; f.state.mode = 'http503';
  const next = await f.backend.prepareTransfer(receiver, '0.1'); await f.backend.submit(next.id, async () => true);
  f.state.forgeAction = true;
  assert.equal((await f.backend.reconcile()).kind, 'unknown'); assert.equal(f.journal.read().phase, 'UNKNOWN');
  f.state.forgeAction = false; assert.equal((await f.backend.reconcile()).kind, 'final');
  f.state.network = 'mainnet'; await assert.rejects(f.backend.prepareTransfer(receiver, '0.1'), { code: 'NETWORK_MISMATCH' });
  assert.equal(f.state.sends, 1); f.vault.lock();
});
test('duplicate and concurrent submission cannot cause a second send', async () => {
  const f = await signerFixture(); const review = await f.backend.prepareTransfer(receiver, '0.1');
  let release; const hold = new Promise(resolve => { release = resolve; });
  const first = f.backend.submit(review.id, async () => { await hold; return true; });
  await assert.rejects(f.backend.submit(review.id, async () => true), { code: 'OUTCOME_UNRESOLVED' });
  release(); assert.equal((await first).kind, 'final');
  await assert.rejects(f.backend.submit(review.id, async () => true), { code: 'REVIEW_EXPIRED' });
  assert.equal(f.state.sends, 1); f.vault.lock();
});
test('FINAL failure remains failure; a forged RPC action or journal FINAL marker cannot settle', async () => {
  const f = await signerFixture(); f.state.failed = true;
  const review = await f.backend.prepareTransfer(receiver, '0.1');
  assert.equal((await f.backend.submit(review.id, async () => true)).outcome, 'FAILED');
  f.state.failed = false; // same hash now has conflicting evidence: never trust the cached marker
  assert.equal((await f.makeBackend().reconcile()).kind, 'unknown');
  f.vault.lock();
});
test('a lock/reunlock cycle invalidates an already signed transaction lease', async () => {
  const f = await signerFixture();
  const tx = createTransaction(f.identity.accountId, PublicKey.fromString(ed25519PublicKeyFromHex(f.identity.publicKeyHex)), receiver, 8n, [actions.transfer(1n)], new Uint8Array(32));
  const signed = await signVaultTransaction(f.vault, tx); signed.assertActive();
  f.vault.lock(); await f.vault.unlock(PASSWORD);
  assert.throws(() => signed.assertActive(), { code: 'CANCELLED' });
  assert.equal(f.state.sends, 0); f.vault.lock();
});
test('a stale RPC nonce after FINAL cannot replay the same signed transfer from a fresh backend', async () => {
  const f = await signerFixture(); const review = await f.backend.prepareTransfer(receiver, '0.1');
  assert.equal((await f.backend.submit(review.id, async () => true)).kind, 'final');
  await assert.rejects(f.makeBackend().prepareTransfer(receiver, '0.1'), { code: 'REVIEW_EXPIRED' });
  assert.equal(f.state.sends, 1); f.state.nonce++;
  assert.equal((await f.makeBackend().prepareTransfer(receiver, '0.1')).nonce, '9'); f.vault.lock();
});
