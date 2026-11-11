import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { calculateRequestId, calculateTermsHash, ContractRequestSchema } from '@taply/shared';
import { createReviewedWalletBackend } from '../dist/wallet-backend.js';
import { buildClient } from '../dist/client.js';
import {
  createProtectedReader, prepareCancelProtected, prepareCreateProtectedRequest, prepareFundProtectedNative,
  prepareReleaseProtected, prepareRetryProtectedTransfer,
} from '../dist/protected.js';
import { signerFixture } from './wallet-signer-fixture.mjs';

// Synthetic RPC only. Fixtures are real outputs of the candidate contract's Rust tests.
const CONTRACT = 'payments.fixture.testnet';
const CODE_HASH = 'Auw8pZ1TvqgGfQg2nJ5Mh6mNo6zBNyGr5uZiGQmQfHbR';
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const NS_FIELDS = ['createdAtNs', 'fundedAtNs', 'cancelUntilNs'];

/** Moves a captured record to "now" and rebinds its roles to the fixture wallet. */
function arrange(f, name, { role, atNs }) {
  const record = fixture(name);
  const shift = BigInt(f.state.now) * 1_000_000n - BigInt(atNs(record));
  for (const key of NS_FIELDS) if (record[key] !== null) record[key] = (BigInt(record[key]) + shift).toString();
  record.terms.fundingExpiresAtNs = (BigInt(record.terms.fundingExpiresAtNs) + shift).toString();
  if (record.latestOperation) for (const key of ['startedAtNs', 'resolvedAtNs'])
    if (record.latestOperation[key] != null) record.latestOperation[key] = (BigInt(record.latestOperation[key]) + shift).toString();
  if (role === 'recipient') {
    record.terms.creatorAccountId = record.recipientAccountId = f.identity.accountId;
    const { contractId, creationNonce, creatorAccountId, network } = record.terms;
    record.terms.id = calculateRequestId({ contractId, creationNonce, creatorAccountId, network });
    if (record.latestOperation) record.latestOperation.destinationAccountId = f.identity.accountId;
  }
  if (role === 'payer' && record.payerAccountId !== null) record.payerAccountId = f.identity.accountId;
  record.termsHash = calculateTermsHash(record.terms);
  ContractRequestSchema.parse(record);
  return record;
}

async function setup(method) {
  const f = await signerFixture();
  const config = fixture('protected-config');
  const plan = {
    create_request: ['protected-open', { role: 'recipient', atNs: (r) => BigInt(r.createdAtNs) + 1_000_000_000n }],
    fund_protected_native: ['protected-open', { role: 'payer', atNs: (r) => BigInt(r.createdAtNs) + 1_000_000_000n }],
    cancel_protected: ['protected-locked', { role: 'payer', atNs: (r) => BigInt(r.fundedAtNs) + 5_000_000_000n }],
    release_protected: ['protected-locked', { role: 'stranger', atNs: (r) => BigInt(r.cancelUntilNs) + 1_000_000_000n }],
    retry_native_transfer: ['protected-release-failed', { role: 'recipient', atNs: (r) => BigInt(r.cancelUntilNs) + 5_000_000_000n }],
  }[method];
  const record = arrange(f, ...plan);
  const quote = { quoteVersion: '1', requestId: record.terms.id, termsHash: record.termsHash, storageBytes: '700', depositYocto: '7000000000000000000000', gas: '30000000000000' };
  f.state.views = { get_config: config, get_request: record, quote_create_request: quote };
  const protectedContract = { accountId: CONTRACT, expectedCodeHash: CODE_HASH };
  // The synthetic RPC answers the candidate's code hash only for the candidate account.
  const fetcher = async (url, init) => {
    const response = await f.fetcher(url, init);
    const request = JSON.parse(init.body);
    if (request.method !== 'query' || request.params.request_type !== 'view_account' || request.params.account_id !== CONTRACT) return response;
    const body = await response.json(); body.result.code_hash = f.state.codeHash ?? CODE_HASH;
    return Response.json(body);
  };
  const observedAtNs = (BigInt(f.state.now) * 1_000_000n).toString();
  const common = { contractId: CONTRACT, config, request: record, signerAccountId: f.identity.accountId, observedAtNs };
  const call = method === 'create_request' ? prepareCreateProtectedRequest({ ...common, terms: record.terms, quote })
    : method === 'fund_protected_native' ? prepareFundProtectedNative({ ...common, acceptedCancelDurationNs: record.terms.cancelDurationNs })
    : method === 'cancel_protected' ? prepareCancelProtected(common)
    : method === 'release_protected' ? prepareReleaseProtected(common)
    : prepareRetryProtectedTransfer(common);
  const make = (extra = { protectedContract }) => createReviewedWalletBackend({ config: f.config, vault: f.vault, storage: f.storage, policy: f.policy, chain: f.chain,
    reader: buildClient(f.config, f.fetcher, false, () => new Date(f.state.now)), fetcher, crypto: f.guardedCrypto, now: () => f.state.now,
    ...(extra.protectedContract ? { protectedContract: extra.protectedContract,
      protectedReader: createProtectedReader({ ...f.config, contract: extra.protectedContract }, fetcher, () => new Date(f.state.now)) } : {}) });
  return { f, record, call, make, config };
}

for (const method of ['create_request', 'fund_protected_native', 'cancel_protected', 'release_protected', 'retry_native_transfer']) {
  test(`wallet signs Protected ${method} only as the exact call rebuilt from the escrow candidate`, async () => {
    const { f, call, make } = await setup(method);
    const backend = make();
    // Any difference from the rebuilt call is refused before a review exists.
    await assert.rejects(backend.prepareProtectedCall({ ...call, depositYocto: (BigInt(call.depositYocto) + 1n).toString() }), { code: 'CALL_NOT_ALLOWED' });
    await assert.rejects(backend.prepareProtectedCall({ ...call, gas: (BigInt(call.gas) + 1n).toString() }), { code: 'CALL_NOT_ALLOWED' });
    await assert.rejects(backend.prepareProtectedCall({ ...call, methodName: 'withdraw_all' }), { code: 'CALL_NOT_ALLOWED' });
    await assert.rejects(backend.prepareProtectedCall({ ...call, receiverId: 'other.fixture.testnet' }), { code: 'CALL_NOT_ALLOWED' });
    assert.equal(f.state.sends, 0);
    const review = await backend.prepareProtectedCall(call);
    assert.equal(review.kind, 'contract_call'); assert.equal(review.receiverId, CONTRACT); assert.equal(review.methodName, method);
    const result = await backend.submit(review.id, async () => true);
    assert.equal(result.kind, 'final'); assert.equal(result.settlementProof, 'NOT_VERIFIED'); assert.equal(f.state.sends, 1);
    const action = f.state.tx.transaction.actions[0].functionCall;
    assert.equal(f.state.tx.transaction.receiverId, CONTRACT);
    assert.equal(action.methodName, method);
    assert.equal(action.deposit.toString(), call.depositYocto);
    assert.equal(action.gas.toString(), call.gas);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(new Uint8Array(action.args))), call.args);
    f.vault.lock();
  });
}

test('no Protected contract configured: every Protected call is refused', async () => {
  const { f, call, make } = await setup('fund_protected_native');
  await assert.rejects(make({}).prepareProtectedCall(call), { code: 'CALL_NOT_ALLOWED' });
  // The payment path does not accept it either (no approved pilot contract here).
  await assert.rejects(make({}).prepareContractCall(call), { code: 'CALL_NOT_ALLOWED' });
  assert.equal(f.state.sends, 0); f.vault.lock();
});

test('Protected call is refused when the deployed code, config or chain state does not allow it', async () => {
  // Deployed code differs from the approved hash.
  let s = await setup('fund_protected_native');
  s.f.state.codeHash = '963iSEB8XFKeUMY1gmj5bCuA2JMVD55ksjdLfCwiPA84';
  await assert.rejects(s.make().prepareProtectedCall(s.call));
  s.f.vault.lock();
  // A fault build is never signed for, even on a QA candidate.
  s = await setup('fund_protected_native');
  s.f.state.views.get_config = { ...s.config, testFaultBuild: true };
  await assert.rejects(s.make().prepareProtectedCall(s.call), { code: 'CALL_NOT_ALLOWED' });
  s.f.vault.lock();
  // Cancel after the on-chain cutoff: the builder refuses, so nothing is signed.
  s = await setup('cancel_protected');
  s.f.state.now += 56_000; // chain time is now past cancelUntilNs
  await assert.rejects(s.make().prepareProtectedCall(s.call), { code: 'CALL_NOT_ALLOWED' });
  s.f.vault.lock();
  // Release before the cutoff.
  s = await setup('cancel_protected');
  const early = prepareCancelProtected({ contractId: CONTRACT, config: s.config, request: s.record, signerAccountId: s.f.identity.accountId, observedAtNs: (BigInt(s.f.state.now) * 1_000_000n).toString() });
  await assert.rejects(s.make().prepareProtectedCall({ ...early, methodName: 'release_protected', args: { id: s.record.terms.id } }), { code: 'CALL_NOT_ALLOWED' });
  s.f.vault.lock();
  // Someone who is not the payer cannot cancel.
  s = await setup('cancel_protected');
  s.f.state.views.get_request = { ...s.record, payerAccountId: 'bob.testnet' };
  await assert.rejects(s.make().prepareProtectedCall(s.call), { code: 'CALL_NOT_ALLOWED' });
  assert.equal(s.f.state.sends, 0); s.f.vault.lock();
});

test('a token Protected request is not signable by the wallet', async () => {
  const { f, call, make, record } = await setup('create_request');
  const terms = { ...record.terms, assetId: 'nep141:tusd.fixture.testnet' };
  await assert.rejects(make().prepareProtectedCall({ ...call, args: { ...call.args, terms } }), { code: 'CALL_NOT_ALLOWED' });
  assert.equal(f.state.sends, 0); f.vault.lock();
});

test('rejecting the review signs nothing', async () => {
  const { f, call, make } = await setup('fund_protected_native');
  const backend = make();
  const review = await backend.prepareProtectedCall(call);
  await assert.rejects(backend.submit(review.id, async () => false), { code: 'REVIEW_REJECTED' });
  assert.equal(f.state.sends, 0); assert.equal(f.state.signs, 0); f.vault.lock();
});
