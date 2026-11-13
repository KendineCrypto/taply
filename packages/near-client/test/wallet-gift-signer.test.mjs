import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReviewedWalletBackend } from '../dist/wallet-backend.js';
import { buildClient } from '../dist/client.js';
import { createGiftReader, prepareClaimGift, prepareCreateGift, prepareRefundGift, prepareRetryGiftPayout, signGiftClaim } from '../dist/gift.js';
import { signerFixture } from './wallet-signer-fixture.mjs';

// Synthetic RPC and disposable in-memory keys only.
const CONTRACT = 'gift.fixture.testnet';
const CODE_HASH = 'Auw8pZ1TvqgGfQg2nJ5Mh6mNo6zBNyGr5uZiGQmQfHbR';
const CONFIG = { contract: 'taply-gift', version: '0.1.0', reviewStatus: 'UNREVIEWED_NOT_FOR_REAL_FUNDS', asset: 'near:native',
  giftFeeYocto: '10000000000000000000000', minAmountYocto: '10000000000000000000000', maxAmountYocto: '100000000000000000000000000',
  minLifetimeS: '600', maxLifetimeS: '2592000', maxMessageBytes: 280, maxDesign: 7, claimDomain: 'taply-gift-claim:v1' };
const ONE = '1000000000000000000000000';
const ID = '0123456789abcdef0123456789abcdef';
const seed = new Uint8Array(32).fill(7);
const PK = 'ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c';

async function setup() {
  const f = await signerFixture();
  const nowNs = BigInt(f.state.now) * 1_000_000n;
  const gift = (over = {}) => ({ id: ID, creator: 'alice.testnet', amountYocto: ONE, publicKey: PK, message: 'hi', design: 0,
    createdAtNs: (nowNs - 10_000_000_000n).toString(), createdHeight: '90', expiresAtNs: (nowNs + 3_600_000_000_000n).toString(),
    status: 'AVAILABLE', beneficiary: null, settledAtNs: null, settledHeight: null, payout: null, payoutNonce: null, ...over });
  f.state.views = { get_config: CONFIG, get_gift: gift() };
  const giftContract = { accountId: CONTRACT, expectedCodeHash: CODE_HASH };
  const fetcher = async (url, init) => {
    const response = await f.fetcher(url, init);
    const request = JSON.parse(init.body);
    if (request.method !== 'query' || request.params.request_type !== 'view_account' || request.params.account_id !== CONTRACT) return response;
    const body = await response.json(); body.result.code_hash = f.state.codeHash ?? CODE_HASH;
    return Response.json(body);
  };
  const make = (withGift = true) => createReviewedWalletBackend({ config: f.config, vault: f.vault, storage: f.storage, policy: f.policy, chain: f.chain,
    reader: buildClient(f.config, f.fetcher, false, () => new Date(f.state.now)), fetcher, crypto: f.guardedCrypto, now: () => f.state.now,
    ...(withGift ? { giftContract, giftReader: createGiftReader({ ...f.config, contract: giftContract }, fetcher, () => new Date(f.state.now)) } : {}) });
  return { f, gift, make, me: f.identity.accountId, nowNs };
}

async function signsExactly(f, backend, call) {
  await assert.rejects(backend.prepareGiftCall({ ...call, depositYocto: (BigInt(call.depositYocto) + 1n).toString() }), { code: 'CALL_NOT_ALLOWED' });
  await assert.rejects(backend.prepareGiftCall({ ...call, gas: (BigInt(call.gas) + 1n).toString() }), { code: 'CALL_NOT_ALLOWED' });
  await assert.rejects(backend.prepareGiftCall({ ...call, methodName: 'withdraw' }), { code: 'CALL_NOT_ALLOWED' });
  await assert.rejects(backend.prepareGiftCall({ ...call, receiverId: 'other.fixture.testnet' }), { code: 'CALL_NOT_ALLOWED' });
  await assert.rejects(backend.prepareGiftCall({ ...call, args: { ...call.args, extra: 1 } }), { code: 'CALL_NOT_ALLOWED' });
  assert.equal(f.state.sends, 0);
  const review = await backend.prepareGiftCall(call);
  assert.equal(review.kind, 'contract_call'); assert.equal(review.receiverId, CONTRACT); assert.equal(review.methodName, call.methodName);
  assert.equal(review.depositYocto, call.depositYocto);
  const result = await backend.submit(review.id, async () => true);
  assert.equal(result.kind, 'final'); assert.equal(f.state.sends, 1);
  const action = f.state.tx.transaction.actions[0].functionCall;
  assert.equal(f.state.tx.transaction.receiverId, CONTRACT);
  assert.equal(action.methodName, call.methodName);
  assert.equal(action.deposit.toString(), call.depositYocto);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(new Uint8Array(action.args))), call.args);
}

test('wallet signs create_gift only as the exact rebuilt call, and only for a fresh id', async () => {
  const { f, make, me } = await setup();
  f.state.views.get_gift = null;
  const call = prepareCreateGift({ contractId: CONTRACT, config: CONFIG, signerAccountId: me, giftId: ID, publicKeyHex: PK, amountYocto: ONE, lifetimeS: 86_400, message: 'hey', design: 2 });
  await signsExactly(f, make(), call);
  f.vault.lock();
  const s = await setup();
  // The id already exists on chain: refused (the contract would refuse too).
  const again = prepareCreateGift({ contractId: CONTRACT, config: CONFIG, signerAccountId: s.me, giftId: ID, publicKeyHex: PK, amountYocto: ONE, lifetimeS: 86_400, message: 'hey', design: 2 });
  await assert.rejects(s.make().prepareGiftCall(again), { code: 'CALL_NOT_ALLOWED' });
  s.f.vault.lock();
});

test('wallet signs claim_gift only with a link signature for THIS signer', async () => {
  const { f, make, me, nowNs } = await setup();
  const signature = await signGiftClaim(crypto, seed, CONTRACT, ID, me);
  const call = prepareClaimGift({ contractId: CONTRACT, gift: f.state.views.get_gift, signerAccountId: me, signatureHex: signature, observedAtNs: nowNs.toString() });
  const backend = make();
  // A signature made for another account (e.g. copied from someone else's claim) is refused before signing.
  const stolen = await signGiftClaim(crypto, seed, CONTRACT, ID, 'carol.testnet');
  await assert.rejects(backend.prepareGiftCall({ ...call, args: { ...call.args, signature: stolen } }), { code: 'CALL_NOT_ALLOWED' });
  const wrongKey = await signGiftClaim(crypto, new Uint8Array(32).fill(9), CONTRACT, ID, me);
  await assert.rejects(backend.prepareGiftCall({ ...call, args: { ...call.args, signature: wrongKey } }), { code: 'CALL_NOT_ALLOWED' });
  await signsExactly(f, backend, call);
  f.vault.lock();
});

test('claim is refused once the chain shows the gift claimed or expired', async () => {
  for (const over of [{ status: 'CLAIMED', beneficiary: 'carol.testnet', settledAtNs: '1', settledHeight: '1', payout: 'PENDING', payoutNonce: 1 }, 'expired']) {
    const { f, make, me, gift, nowNs } = await setup();
    const signature = await signGiftClaim(crypto, seed, CONTRACT, ID, me);
    const call = prepareClaimGift({ contractId: CONTRACT, gift: gift(), signerAccountId: me, signatureHex: signature, observedAtNs: nowNs.toString() });
    f.state.views.get_gift = over === 'expired' ? gift({ expiresAtNs: nowNs.toString(), status: 'EXPIRED' }) : gift(over);
    await assert.rejects(make().prepareGiftCall(call), { code: 'CALL_NOT_ALLOWED' });
    assert.equal(f.state.sends, 0); f.vault.lock();
  }
});

test('refund (creator, after expiry) and retry (beneficiary, after recorded failure)', async () => {
  let s = await setup();
  s.f.state.views.get_gift = s.gift({ creator: s.me, expiresAtNs: (s.nowNs - 1n).toString(), status: 'EXPIRED' });
  await signsExactly(s.f, s.make(), prepareRefundGift({ contractId: CONTRACT, gift: s.f.state.views.get_gift, signerAccountId: s.me, observedAtNs: s.nowNs.toString() }));
  s.f.vault.lock();
  s = await setup();
  s.f.state.views.get_gift = s.gift({ status: 'CLAIMED', beneficiary: s.me, settledAtNs: '1', settledHeight: '1', payout: 'FAILED', payoutNonce: 1 });
  await signsExactly(s.f, s.make(), prepareRetryGiftPayout({ contractId: CONTRACT, gift: s.f.state.views.get_gift, signerAccountId: s.me }));
  s.f.vault.lock();
  // An unknown (PENDING) payout is never retried by the wallet.
  s = await setup();
  const failed = s.gift({ status: 'CLAIMED', beneficiary: s.me, settledAtNs: '1', settledHeight: '1', payout: 'FAILED', payoutNonce: 1 });
  const retry = prepareRetryGiftPayout({ contractId: CONTRACT, gift: failed, signerAccountId: s.me });
  s.f.state.views.get_gift = { ...failed, payout: 'PENDING' };
  await assert.rejects(s.make().prepareGiftCall(retry), { code: 'CALL_NOT_ALLOWED' });
  assert.equal(s.f.state.sends, 0); s.f.vault.lock();
});

test('no gift contract configured, or different code deployed: refused', async () => {
  let s = await setup();
  const call = prepareCreateGift({ contractId: CONTRACT, config: CONFIG, signerAccountId: s.me, giftId: 'f'.repeat(32), publicKeyHex: PK, amountYocto: ONE, lifetimeS: 600, message: '', design: 0 });
  await assert.rejects(s.make(false).prepareGiftCall(call), { code: 'CALL_NOT_ALLOWED' });
  await assert.rejects(s.make(false).prepareContractCall(call), { code: 'CALL_NOT_ALLOWED' });
  s.f.vault.lock();
  s = await setup();
  s.f.state.views.get_gift = null;
  s.f.state.codeHash = '963iSEB8XFKeUMY1gmj5bCuA2JMVD55ksjdLfCwiPA84';
  await assert.rejects(s.make().prepareGiftCall(call));
  assert.equal(s.f.state.sends, 0); s.f.vault.lock();
});

test('rejecting the review signs nothing', async () => {
  const { f, make, me } = await setup();
  f.state.views.get_gift = null;
  const call = prepareCreateGift({ contractId: CONTRACT, config: CONFIG, signerAccountId: me, giftId: ID, publicKeyHex: PK, amountYocto: ONE, lifetimeS: 600, message: '', design: 0 });
  const backend = make();
  const review = await backend.prepareGiftCall(call);
  await assert.rejects(backend.submit(review.id, async () => false), { code: 'REVIEW_REJECTED' });
  assert.equal(f.state.sends, 0); assert.equal(f.state.signs, 0); f.vault.lock();
});
