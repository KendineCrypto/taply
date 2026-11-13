import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  GiftConfigSchema, GiftViewSchema, NearClientError, claimMessage, decodeGiftSecret, encodeGiftSecret, giftMessageProblem,
  giftPublicKeyHex, isGiftId, newGiftLink, prepareClaimGift, prepareCreateGift, prepareRefundGift, prepareRetryGiftPayout,
  signGiftClaim, verifyGiftClaim, verifyDirectTransfer, createGiftReader,
} from '../dist/index.js';
import { TESTNET_GENESIS_HASH } from '../dist/index.js';
import { HASH, HASH2 } from './helpers.mjs';

// Real `get_gift` outputs captured from the sandbox suite (contracts/gift/sandbox).
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const CONTRACT = 'gift.fixture.testnet';
const CONFIG = GiftConfigSchema.parse({
  contract: 'taply-gift', version: '0.1.0', reviewStatus: 'UNREVIEWED_NOT_FOR_REAL_FUNDS', asset: 'near:native',
  giftFeeYocto: '10000000000000000000000', minAmountYocto: '10000000000000000000000', maxAmountYocto: '100000000000000000000000000',
  minLifetimeS: '600', maxLifetimeS: '2592000', maxMessageBytes: 280, maxDesign: 7, claimDomain: 'taply-gift-claim:v1',
});
const ONE = '1000000000000000000000000';
const ID = '0123456789abcdef0123456789abcdef';
const refused = (fn) => assert.throws(fn, (e) => e instanceof NearClientError && e.code === 'INVALID_ARGUMENT');
const seed7 = new Uint8Array(32).fill(7);
const PK7 = 'ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c';
const available = (over = {}) => ({ id: ID, creator: 'alice.testnet', amountYocto: ONE, publicKey: PK7, message: 'hi', design: 1,
  createdAtNs: '1000', createdHeight: '1', expiresAtNs: '5000', status: 'AVAILABLE', beneficiary: null, settledAtNs: null,
  settledHeight: null, payout: null, payoutNonce: null, ...over });

test('real contract views parse; inconsistent settlement shapes are refused', () => {
  const claimed = GiftViewSchema.parse(fixture('gift-claimed-sandbox'));
  assert.equal(claimed.status, 'CLAIMED'); assert.equal(claimed.payout, 'CONFIRMED');
  assert.equal(GiftViewSchema.parse(fixture('gift-refunded-sandbox')).status, 'REFUNDED');
  assert.equal(GiftViewSchema.parse(fixture('gift-pending-sandbox')).payout, 'PENDING');
  assert.equal(GiftViewSchema.safeParse({ ...claimed, payout: null }).success, false);
  assert.equal(GiftViewSchema.safeParse({ ...available(), beneficiary: 'bob.testnet' }).success, false);
  assert.equal(GiftViewSchema.safeParse({ ...claimed, beneficiary: claimed.creator }).success, false, 'creator cannot be a claimant');
  assert.equal(GiftViewSchema.safeParse({ ...fixture('gift-refunded-sandbox'), beneficiary: 'bob.testnet' }).success, false);
  assert.equal(GiftViewSchema.safeParse({ ...claimed, extra: 1 }).success, false);
  assert.equal(GiftConfigSchema.safeParse({ ...CONFIG, version: '9.9.9' }).success, false);
});

test('link key: Web Crypto matches the contract vector; secret round-trips; ids are strict', async () => {
  assert.equal(await giftPublicKeyHex(crypto, seed7), PK7);
  const sig = await signGiftClaim(crypto, seed7, CONTRACT, ID, 'bob.testnet');
  assert.equal(sig, '94844b9df33401de393c9c888c7237c984e397c48300c62c53687ab82850f1cce298f9ad5e3d25692e570779e9b92ec808703bc0b06450d4d252ee87a2166500');
  assert.equal(await verifyGiftClaim(crypto, PK7, CONTRACT, ID, 'bob.testnet', sig), true);
  assert.equal(await verifyGiftClaim(crypto, PK7, CONTRACT, ID, 'carol.testnet', sig), false, 'bound to the claimant');
  assert.equal(await verifyGiftClaim(crypto, PK7, 'other.testnet', ID, 'bob.testnet', sig), false, 'bound to the contract');
  assert.equal(await verifyGiftClaim(crypto, PK7, CONTRACT, ID, 'bob.testnet', 'zz'), false);
  assert.equal(claimMessage(CONTRACT, ID, 'bob.testnet'), `taply-gift-claim:v1:${CONTRACT}:${ID}:bob.testnet`);
  refused(() => claimMessage(CONTRACT, 'NOT-AN-ID', 'bob.testnet'));
  const secret = encodeGiftSecret(seed7);
  assert.equal(secret.length, 43);
  assert.deepEqual(decodeGiftSecret(secret), seed7);
  for (const bad of ['', 'abc', secret + 'A', secret.slice(0, 42) + '!', '+'.repeat(43)]) assert.equal(decodeGiftSecret(bad), null);
  const link = await newGiftLink(crypto);
  assert.ok(isGiftId(link.giftId)); assert.equal(link.seed.length, 32);
  assert.equal(link.publicKeyHex, await giftPublicKeyHex(crypto, link.seed));
  for (const bad of ['', ID.toUpperCase(), ID + '0', ID.slice(1), '../' + ID.slice(3)]) assert.equal(isGiftId(bad), false);
});

test('create: exact deposit = amount + fee, contract guards repeated', () => {
  const base = { contractId: CONTRACT, config: CONFIG, signerAccountId: 'alice.testnet', giftId: ID, publicKeyHex: PK7,
    amountYocto: ONE, lifetimeS: 86_400, message: 'Happy birthday 🎁', design: 3 };
  const call = prepareCreateGift(base);
  assert.equal(call.methodName, 'create_gift');
  assert.equal(call.depositYocto, '1010000000000000000000000');
  assert.equal(call.gas, '30000000000000');
  assert.deepEqual(call.args, { gift_id: ID, public_key: PK7, amount: ONE, lifetime_s: 86_400, message: 'Happy birthday 🎁', design: 3 });
  refused(() => prepareCreateGift({ ...base, amountYocto: '9999999999999999999999' }));
  refused(() => prepareCreateGift({ ...base, amountYocto: '100000000000000000000000001' }));
  refused(() => prepareCreateGift({ ...base, amountYocto: '1.5' }));
  refused(() => prepareCreateGift({ ...base, lifetimeS: 599 }));
  refused(() => prepareCreateGift({ ...base, lifetimeS: 2_592_001 }));
  refused(() => prepareCreateGift({ ...base, message: 'x'.repeat(281) }));
  refused(() => prepareCreateGift({ ...base, message: 'bell\u0007' }));
  refused(() => prepareCreateGift({ ...base, design: 8 }));
  refused(() => prepareCreateGift({ ...base, giftId: 'ABC' }));
  refused(() => prepareCreateGift({ ...base, publicKeyHex: 'zz' }));
  assert.equal(giftMessageProblem('🎁'.repeat(70), CONFIG), null);
  assert.equal(giftMessageProblem('🎁'.repeat(71), CONFIG), 'TOO_LONG');
  assert.equal(giftMessageProblem('line\nbreak', CONFIG), null);
});

test('claim / refund / retry builders follow chain time and roles', () => {
  const sig = 'a'.repeat(128);
  const claim = prepareClaimGift({ contractId: CONTRACT, gift: available(), signerAccountId: 'bob.testnet', signatureHex: sig, observedAtNs: '4999' });
  assert.deepEqual(claim, { receiverId: CONTRACT, methodName: 'claim_gift', args: { gift_id: ID, signature: sig }, gas: '50000000000000', depositYocto: '0' });
  refused(() => prepareClaimGift({ contractId: CONTRACT, gift: available(), signerAccountId: 'bob.testnet', signatureHex: sig, observedAtNs: '5000' }));
  refused(() => prepareClaimGift({ contractId: CONTRACT, gift: available(), signerAccountId: 'alice.testnet', signatureHex: sig, observedAtNs: '1' }));
  refused(() => prepareClaimGift({ contractId: CONTRACT, gift: fixture('gift-claimed-sandbox'), signerAccountId: 'bob.testnet', signatureHex: sig, observedAtNs: '1' }));
  refused(() => prepareClaimGift({ contractId: CONTRACT, gift: available(), signerAccountId: 'bob.testnet', signatureHex: 'ab', observedAtNs: '1' }));
  const refund = prepareRefundGift({ contractId: CONTRACT, gift: available({ status: 'EXPIRED' }), signerAccountId: 'alice.testnet', observedAtNs: '5000' });
  assert.equal(refund.methodName, 'refund_gift'); assert.equal(refund.depositYocto, '0');
  refused(() => prepareRefundGift({ contractId: CONTRACT, gift: available(), signerAccountId: 'alice.testnet', observedAtNs: '4999' }));
  refused(() => prepareRefundGift({ contractId: CONTRACT, gift: available(), signerAccountId: 'bob.testnet', observedAtNs: '9999' }));
  const pending = fixture('gift-pending-sandbox');
  refused(() => prepareRetryGiftPayout({ contractId: CONTRACT, gift: pending, signerAccountId: pending.beneficiary }));
  const failed = { ...pending, payout: 'FAILED' };
  assert.equal(prepareRetryGiftPayout({ contractId: CONTRACT, gift: failed, signerAccountId: failed.beneficiary }).methodName, 'retry_payout');
  refused(() => prepareRetryGiftPayout({ contractId: CONTRACT, gift: failed, signerAccountId: 'stranger.testnet' }));
});

/** Synthetic RPC (never a real chain). */
function rpc(handlers) {
  return async (_url, init) => {
    const request = JSON.parse(init.body);
    const h = handlers[request.method === 'query' ? request.params.request_type : request.method];
    const value = typeof h === 'function' ? h(request) : h;
    if (value instanceof Response) return value;
    return Response.json({ jsonrpc: '2.0', id: request.id, ...(value?.error ? { error: value.error } : { result: value }) });
  };
}
const config = { network: 'near-testnet', rpcUrl: 'https://rpc.unit.invalid', rpcProviderId: 'synthetic', contract: { accountId: CONTRACT, expectedCodeHash: HASH2 } };
const status = { chain_id: 'testnet', genesis_hash: TESTNET_GENESIS_HASH, version: { version: 's' }, sync_info: { syncing: false } };
const block = { header: { hash: HASH, height: 100, timestamp_nanosec: '4000' } };
const view = (value) => ({ result: [...new TextEncoder().encode(JSON.stringify(value))], logs: [], block_hash: HASH, block_height: 100 });

test('reader: anchored to one final block with the pinned code hash', async () => {
  const handlers = { status, block, view_account: { amount: '1', locked: '0', storage_usage: 1, code_hash: HASH2, block_hash: HASH, block_height: 100 },
    call_function: (r) => view(r.params.method_name === 'get_config' ? CONFIG : available()) };
  const reader = createGiftReader(config, rpc(handlers));
  const read = await reader.readGift(ID);
  assert.equal(read.error, null);
  assert.equal(read.observation.assurance, 'verified_final');
  assert.equal(read.observation.data.gift.status, 'AVAILABLE');
  assert.equal(read.observation.data.observedAtNs, '4000');
  assert.equal((await reader.readConfig()).observation.data.claimDomain, 'taply-gift-claim:v1');
  // Different code at the contract account: mismatch, no data.
  const swapped = createGiftReader(config, rpc({ ...handlers, view_account: { ...handlers.view_account, code_hash: HASH } }));
  const bad = await swapped.readGift(ID);
  assert.equal(bad.observation.data, null); assert.equal(bad.observation.assurance, 'mismatch');
  // The view answers a different gift than asked: refused.
  const lying = createGiftReader(config, rpc({ ...handlers, call_function: view(available({ id: 'f'.repeat(32) })) }));
  assert.equal((await lying.readGift(ID)).observation.data, null);
  // Malformed id never reaches the RPC.
  assert.equal((await reader.readGift('../etc')).observation.data, null);
  // Unknown gift reads as null (not an error).
  const none = createGiftReader(config, rpc({ ...handlers, call_function: view(null) }));
  assert.equal((await none.readGift(ID)).observation.data.gift, null);
  // RPC down: no data, never "verified".
  const down = createGiftReader(config, async () => new Response('busy', { status: 503 }));
  const r = await down.readGift(ID);
  assert.equal(r.observation.data, null); assert.notEqual(r.observation.assurance, 'verified_final');
});

test('personal gift: only an exact successful transfer is VERIFIED', async () => {
  const tx = (over = {}) => ({ final_execution_status: 'FINAL', status: { SuccessValue: '' },
    transaction: { hash: HASH, signer_id: 'alice.testnet', receiver_id: 'bob.testnet', actions: [{ Transfer: { deposit: ONE } }] },
    transaction_outcome: { block_hash: HASH, outcome: { status: { SuccessReceiptId: 'r1' } } },
    receipts_outcome: [{ id: 'r1', block_hash: HASH2, outcome: { executor_id: 'bob.testnet', status: { SuccessValue: '' } } }], ...over });
  const ref = { txHash: HASH, from: 'alice.testnet', to: 'bob.testnet', amountYocto: ONE };
  const run = (txValue, r = ref) => verifyDirectTransfer(config, r, rpc({ status, block, EXPERIMENTAL_tx_status: txValue }));
  assert.equal((await run(tx())).kind, 'VERIFIED');
  assert.equal((await run(tx(), { ...ref, amountYocto: '2' })).kind, 'MISMATCH', 'link claims another amount');
  assert.equal((await run(tx(), { ...ref, to: 'mallory.testnet' })).kind, 'MISMATCH');
  assert.equal((await run(tx({ status: { Failure: {} } }))).kind, 'MISMATCH');
  assert.equal((await run(tx({ transaction: { ...tx().transaction, actions: [{ Transfer: { deposit: ONE } }, { Transfer: { deposit: ONE } }] } }))).kind, 'MISMATCH');
  assert.equal((await run(tx({ receipts_outcome: [{ id: 'r1', block_hash: HASH2, outcome: { executor_id: 'bob.testnet', status: { Failure: {} } } }] }))).kind, 'MISMATCH');
  assert.equal((await run({ error: { code: -32000, name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_TRANSACTION' } } })).kind === 'VERIFIED', false);
  assert.equal((await verifyDirectTransfer(config, ref, async () => new Response('x', { status: 503 }))).kind, 'UNAVAILABLE');
  assert.equal((await run(tx(), { ...ref, txHash: 'not-a-hash' })).kind, 'MISMATCH');
});
