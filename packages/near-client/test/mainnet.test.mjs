import test from 'node:test';
import assert from 'node:assert/strict';
import { MainnetIntentTermsSchema, MainnetRequestSchema, IntentTermsSchema, MAINNET_USDC_ASSET, buildInstantRecipientMessage,
  calculateMainnetRequestId, calculateMainnetTermsHash } from '@taply/shared';
import { MAINNET_GENESIS_HASH, MainnetProfileSchema, prepareMainnetPayment, prepareMainnetTokenStorageDeposit,
  openMainnetVault, createMainnetReader } from '../dist/index.js';
const profile = { network: 'near-mainnet', rpcUrl: 'https://rpc.mainnet.fastnear.com', rpcProviderId: 'fixture',
  contract: { accountId: 'devkendinecrypto.near', expectedCodeHash: '11111111111111111111111111111112' } };
function terms(assetId = MAINNET_USDC_ASSET) {
  const t = { schemaVersion: 'taply.intent.v1', network: 'near-mainnet', contractId: profile.contract.accountId,
    creatorAccountId: 'merchant.near', creationNonce: 'a'.repeat(64), assetId, amountBaseUnits: '1000000', mode: 'instant',
    cancelDurationNs: null, fundingExpiresAtNs: '2000000000', permittedPayerAccountId: null, merchantAccountId: null, memo: '', sessionBinding: null };
  t.id = calculateMainnetRequestId({ network: t.network, contractId: t.contractId, creatorAccountId: t.creatorAccountId, creationNonce: t.creationNonce }); return t;
}
function input(t = terms()) { return { profile, terms: t, status: 'OPEN', termsHash: calculateMainnetTermsHash(t), signerAccountId: 'payer.near', observedAtNs: '1000000000' }; }
test('network schemas remain isolated and caps are exact', () => {
  assert.equal(MainnetIntentTermsSchema.safeParse(terms()).success, true);
  assert.equal(IntentTermsSchema.safeParse(terms()).success, false);
  assert.equal(MainnetIntentTermsSchema.safeParse({ ...terms(), network: 'near-testnet' }).success, false);
  for (const [asset, cap] of [[MAINNET_USDC_ASSET, 25000000n], ['near:native', 1000000000000000000000000n]]) {
    assert.equal(MainnetIntentTermsSchema.safeParse({ ...terms(asset), amountBaseUnits: cap.toString() }).success, true);
    assert.equal(MainnetIntentTermsSchema.safeParse({ ...terms(asset), amountBaseUnits: (cap + 1n).toString() }).success, false);
  }
});
test('malformed decimal, nonce and account input fails schema without throwing', () => {
  for (const change of [{ amountBaseUnits: 'oops' }, { amountBaseUnits: '-1' }, { creationNonce: 'oops' }, { creatorAccountId: 'Bad Account' }]) {
    assert.equal(MainnetIntentTermsSchema.safeParse({ ...terms(), ...change }).success, false);
  }
});
test('request schema accepts late router funding but refuses false paid or late wallet funding', () => {
  const t = terms(); const r = { terms: t, termsHash: calculateMainnetTermsHash(t), sessionCommitment: null,
    recipientAccountId: t.creatorAccountId, status: 'PAYOUT_IN_FLIGHT', revision: '2', createdAtNs: '1',
    payerAccountId: 'intents.near', fundedAtNs: '2000000001', cancelUntilNs: null, settlementBranch: 'RECIPIENT',
    latestOperation: { nonce: '1', kind: 'INSTANT_PAYOUT', destinationAccountId: t.creatorAccountId,
      amountBaseUnits: t.amountBaseUnits, status: 'IN_FLIGHT', startedAtNs: '2000000001', resolvedAtNs: null, failureCode: null } };
  assert.equal(MainnetRequestSchema.safeParse(r).success, true);
  assert.equal(MainnetRequestSchema.safeParse({ ...r, status: 'FINAL_PAID' }).success, false);
  assert.equal(MainnetRequestSchema.safeParse({ ...r, payerAccountId: 'payer.near' }).success, false);
});
test('USDC builder and 1Click use identical message, exact receiver and one yocto', () => {
  const i = input(); const call = prepareMainnetPayment(i);
  assert.equal(call.args.msg, buildInstantRecipientMessage(i.terms.id, i.termsHash));
  assert.equal(call.args.receiver_id, profile.contract.accountId); assert.equal(call.args.amount, '1000000');
  assert.equal(call.depositYocto, '1'); assert.equal(call.gas, '100000000000000');
});
test('native builder sends exact principal and never token calldata', () => {
  const call = prepareMainnetPayment(input(terms('near:native')));
  assert.equal(call.methodName, 'pay_instant_native'); assert.equal(call.depositYocto, '1000000');
  assert.deepEqual(Object.keys(call.args).sort(), ['expectedTermsHash', 'id']);
});
test('funding refuses non-open, expired, wrong hash, wrong payer, wrong contract', () => {
  const i = input();
  for (const change of [{ status: 'PAYOUT_IN_FLIGHT' }, { status: 'FINAL_PAID' }, { observedAtNs: '2000000000' }, { termsHash: '0'.repeat(64) }, { signerAccountId: 'payer.testnet' }])
    assert.throws(() => prepareMainnetPayment({ ...i, ...change }));
  const restricted = { ...terms(), permittedPayerAccountId: 'somebody.near' };
  assert.throws(() => prepareMainnetPayment(input(restricted)));
  assert.throws(() => prepareMainnetPayment({ ...i, profile: { ...profile, contract: { ...profile.contract, accountId: 'taply-pay.kendinecrypto.near' } } }));
});
test('profile rejects Testnet RPC, genesis profile and deployed Testnet code', () => {
  for (const change of [{ rpcUrl: 'https://rpc.testnet.near.org' }, { network: 'near-testnet' }, { rpcUrl: 'https://rpc.mainnet.fastnear.com/?testnet' },
    { contract: { ...profile.contract, expectedCodeHash: '963iSEB8XFKeUMY1gmj5bCuA2JMVD55ksjdLfCwiPA84' } }])
    assert.equal(MainnetProfileSchema.safeParse({ ...profile, ...change }).success, false);
});
test('storage registration is signer-only and bounded; mainnet vault never opens', () => {
  assert.equal(prepareMainnetTokenStorageDeposit(profile, 'payer.near', '1250000000000000000000').args.account_id, 'payer.near');
  assert.throws(() => prepareMainnetTokenStorageDeposit(profile, 'payer.near', '2000000000000000000001'));
  assert.throws(() => prepareMainnetTokenStorageDeposit(profile, 'payer.testnet', '1250000000000000000000'));
  assert.throws(() => openMainnetVault(), /DISABLED_USE_EXTERNAL_WALLET/);
});
test('reader refuses wrong genesis and code hash; no cross-network fallback', async () => {
  for (const fault of ['genesis', 'code']) {
    const calls = [];
    const fetcher = async (url, init) => {
      assert.equal(url, profile.rpcUrl); const req = JSON.parse(init.body); calls.push(req);
      const result = req.method === 'status' ? { chain_id: 'mainnet', sync_info: { syncing: false } } :
        req.method === 'block' ? { header: { hash: req.params.block_id === 9820210 && fault !== 'genesis' ? MAINNET_GENESIS_HASH : '11111111111111111111111111111113', timestamp_nanosec: '1' } } :
          { code_hash: '11111111111111111111111111111114' };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }));
    };
    await assert.rejects(createMainnetReader(profile, fetcher).readUsdcBalance('payer.near'), e => e.code === (fault === 'genesis' ? 'NETWORK_MISMATCH' : 'CONTRACT_CODE_MISMATCH'));
    assert.equal(calls.some(r => r.params?.request_type === 'call_function'), false);
  }
});
