import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateRequestId, calculateTermsHash, calculateSessionCommitment } from '@taply/shared';
import { createMerchantRequestReader, matchMerchantSession, verifyMerchantObservation } from '../dist/index.js';
import { TESTNET_GENESIS_HASH } from '../dist/rpc.js';
const NOW = 1793500000000, HASH = '1'.repeat(32), CODE = '1'.repeat(31) + '2';
const config = { network: 'near-testnet', rpcUrl: 'https://rpc.testnet.near.org', rpcProviderId: 'test-fixture',
  contract: { accountId: 'candidate.testnet', expectedCodeHash: CODE } };
const deployment = { network: 'near-testnet', contractId: config.contract.accountId, codeHash: CODE };
function fixture() {
  const terms = { schemaVersion: 'taply.intent.v1', id: '', network: 'near-testnet', contractId: deployment.contractId,
    creatorAccountId: 'merchant.testnet', creationNonce: 'a'.repeat(64), amountBaseUnits: '1000000000000000000000001',
    assetId: 'near:native', mode: 'instant', cancelDurationNs: null, fundingExpiresAtNs: String(BigInt(NOW + 180000) * 1000000n),
    merchantAccountId: 'merchant.testnet', permittedPayerAccountId: null, memo: 'İstanbul café',
    sessionBinding: { id: '11111111-1111-4111-8111-111111111111', nonce: 'b'.repeat(64), expiresAtNs: String(BigInt(NOW + 120000) * 1000000n) } };
  const { network, contractId, creatorAccountId, creationNonce } = terms;
  terms.id = calculateRequestId({ network, contractId, creatorAccountId, creationNonce });
  return { terms, termsHash: calculateTermsHash(terms), sessionCommitment: calculateSessionCommitment(terms),
    recipientAccountId: terms.creatorAccountId, status: 'OPEN', revision: '1', createdAtNs: String(BigInt(NOW) * 1000000n),
    payerAccountId: null, fundedAtNs: null, cancelUntilNs: null, settlementBranch: null, latestOperation: null };
}
const expectation = r => ({ merchantAccountId: r.terms.creatorAccountId, requestId: r.terms.id, termsHash: r.termsHash,
  sessionBinding: r.terms.sessionBinding, permittedPayerAccountId: null });
function transport(record, mutate = x => x) {
  const calls = [];
  return { calls, fetch: async (_url, init) => {
    const call = JSON.parse(init.body); calls.push(call);
    let result;
    if (call.method === 'status') result = { chain_id: 'testnet', genesis_hash: TESTNET_GENESIS_HASH, version: { version: 'fixture' }, sync_info: { syncing: false } };
    else if (call.method === 'block') result = { header: { hash: HASH, height: 123, timestamp_nanosec: String(BigInt(NOW) * 1000000n) } };
    else if (call.params.request_type === 'view_account') result = { amount: '1', locked: '0', storage_usage: 1, code_hash: CODE, block_hash: HASH, block_height: 123 };
    else result = { result: [...Buffer.from(JSON.stringify(record))], logs: [], block_hash: HASH, block_height: 123 };
    return Response.json({ jsonrpc: '2.0', id: call.id, result: mutate(result, call) });
  } };
}
test('two independent read clients derive identical authenticated-terms codes, never payment claims', async () => {
  const record = fixture(), a = transport(record), b = transport(record);
  const [left, right] = await Promise.all([a, b].map(t => createMerchantRequestReader(config, t.fetch, () => NOW).readForSession(expectation(record))));
  assert.equal(left.comparisonCode, right.comparisonCode); assert.match(left.comparisonCode, /^[0-9A-HJKMNP-TV-Z]{6}$/);
  assert.equal(left.provenance.evidenceKind, 'CANONICAL_REQUEST_NOT_PAYOUT_RECEIPT');
  assert.equal(Object.hasOwn(left, 'verifiedPaid'), false);
  for (const t of [a, b]) {
    assert.deepEqual(t.calls.map(c => c.method), ['status', 'block', 'query', 'query']);
    assert.ok(t.calls.filter(c => c.method === 'query').every(c => c.params.block_id === HASH));
    assert.equal(t.calls[1].params.finality, 'final');
  }
});
test('malicious session server cannot replace authentic chain terms or add payer restrictions', async () => {
  const record = fixture(), t = transport(record);
  const verified = await createMerchantRequestReader(config, t.fetch, () => NOW).read(record.terms.id);
  for (const mutation of [
    { merchantAccountId: 'eve.testnet' }, { requestId: 'f'.repeat(64) }, { termsHash: 'f'.repeat(64) },
    { sessionBinding: { ...record.terms.sessionBinding, nonce: 'f'.repeat(64) } },
    { sessionBinding: { ...record.terms.sessionBinding, id: '22222222-2222-4222-8222-222222222222' } },
    { sessionBinding: { ...record.terms.sessionBinding, expiresAtNs: '1793500119999999999' } },
    { permittedPayerAccountId: 'eve.testnet' },
  ]) assert.throws(() => matchMerchantSession(verified, { ...expectation(record), ...mutation }));
  const substituted = fixture(); substituted.terms.amountBaseUnits = '2';
  substituted.termsHash = calculateTermsHash(substituted.terms); substituted.sessionCommitment = calculateSessionCommitment(substituted.terms);
  await assert.rejects(createMerchantRequestReader(config, transport(substituted).fetch, () => NOW).readForSession(expectation(record)));
});
test('wrong genesis, syncing, deployment hash, final block or request bytes refuse binding', async () => {
  const record = fixture();
  for (const mutate of [
    (r, c) => c.method === 'status' ? { ...r, chain_id: 'mainnet' } : r,
    (r, c) => c.method === 'status' ? { ...r, genesis_hash: CODE } : r,
    (r, c) => c.method === 'status' ? { ...r, sync_info: { syncing: true } } : r,
    (r, c) => c.params?.request_type === 'view_account' ? { ...r, code_hash: HASH } : r,
    (r, c) => c.params?.request_type === 'call_function' ? { ...r, block_hash: CODE } : r,
    (r, c) => c.params?.request_type === 'call_function' ? { ...r, block_height: 124 } : r,
    (r, c) => c.method === 'block' ? { ...r, header: { ...r.header, timestamp_nanosec: '1793499800000000000' } } : r,
    (r, c) => c.params?.request_type === 'call_function' ? { ...r, result: [...Buffer.from('{"status":"OPEN","status":"FINAL_PAID"}')] } : r,
  ]) await assert.rejects(createMerchantRequestReader(config, transport(record, mutate).fetch, () => NOW).readForSession(expectation(record)));
});
test('observation assurance, timestamp consistency, expiry and incomplete terms fail closed', () => {
  const record = fixture();
  const valid = { error: null, observation: { source: 'rpc', assurance: 'verified_final', rpcAvailable: true, stale: false,
    checkedAt: new Date(NOW).toISOString(), observedBlock: { hash: HASH, height: '123', timestampNs: String(BigInt(NOW) * 1000000n) }, data: { id: record.terms.id, request: record } } };
  for (const patch of [{ source: 'mock' }, { assurance: 'pending_finality' }, { stale: true }, { rpcAvailable: false },
    { observedBlock: null }, { checkedAt: new Date(NOW - 120001).toISOString() }, { checkedAt: new Date(NOW + 30001).toISOString() }]) {
    assert.throws(() => verifyMerchantObservation({ ...valid, observation: { ...valid.observation, ...patch } }, deployment, record.terms.id, NOW));
  }
  for (const mutate of [r => { r.createdAtNs = String(BigInt(NOW + 1) * 1000000n); },
    r => { r.terms.sessionBinding = null; }, r => { r.terms.merchantAccountId = null; },
    r => { r.terms.sessionBinding.expiresAtNs = r.createdAtNs; }]) {
    const bad = structuredClone(valid); mutate(bad.observation.data.request);
    assert.throws(() => verifyMerchantObservation(bad, deployment, record.terms.id, NOW));
  }
  assert.throws(() => verifyMerchantObservation(valid, deployment, record.terms.id, NOW + 120000));
  assert.throws(() => createMerchantRequestReader({ ...config, contract: { ...config.contract, accountId: 'taply-pay-pilot-1.testnet' } }));
});

test('candidate-only preparation binds exact storage, account, immutable hash and explicit payer without signing', async () => {
  const { MerchantContractConfigSchema, ContractConfigSchema, prepareMerchantCreateRequest, prepareMerchantPayInstantNative } = await import('../dist/index.js');
  const r = fixture(), t = transport(r);
  const configValue = { schemaVersion: 'taply.contract-config.v1', contractVersion: '0.5.0-merchant.1', network: 'near-testnet', contractId: deployment.contractId,
    intentVersion: 'taply.intent.v1', eventVersion: '0.4.0', capabilities: { instantNative: true, handshake: true, protectedPay: false, merchantProfiles: false, nep141: false, sponsoredGas: false },
    quoteVersion: '1', storageByteCostYocto: '10000000000000000000', gas: { createRequest: '30000000000000', payInstantNative: '50000000000000', retryNativeTransfer: '50000000000000', cancelUnfunded: '15000000000000', callback: '15000000000000' },
    storageRefundPolicy: 'PERMANENT_RECORD_NO_WITHDRAWAL', unknownCallbackPolicy: 'IN_FLIGHT_NO_RETRY_NO_ADMIN_OVERRIDE', testFaultBuild: false };
  assert.equal(ContractConfigSchema.safeParse(configValue).success, false);
  assert.equal(MerchantContractConfigSchema.safeParse(configValue).success, true);
  const quote = { requestId: r.terms.id, termsHash: r.termsHash, quoteVersion: '1', gas: '30000000000000', storageBytes: '800', depositYocto: '8000000000000000000000' };
  const input = { deployment, config: configValue, terms: r.terms, quote, signerAccountId: r.terms.creatorAccountId, observedAtNs: String(BigInt(NOW) * 1000000n) };
  assert.equal(prepareMerchantCreateRequest(input).args.terms.sessionBinding.nonce, r.terms.sessionBinding.nonce);
  for (const patch of [{ signerAccountId: 'eve.testnet' }, { quote: { ...quote, depositYocto: '1' } }, { config: { ...configValue, testFaultBuild: true } },
    { config: { ...configValue, contractVersion: '0.4.0' } }, { terms: { ...r.terms, merchantAccountId: null, sessionBinding: null } }]) assert.throws(() => prepareMerchantCreateRequest({ ...input, ...patch }));
  const canonical = await createMerchantRequestReader(config, t.fetch, () => NOW).readForSession(expectation(r));
  const pay = { deployment, config: configValue, canonical, expected: expectation(r), signerAccountId: 'payer.testnet', nowMs: NOW };
  assert.deepEqual(prepareMerchantPayInstantNative(pay), { receiverId: deployment.contractId, methodName: 'pay_instant_native', gas: '50000000000000', depositYocto: r.terms.amountBaseUnits, args: { id: r.terms.id, expectedTermsHash: r.termsHash } });
  assert.throws(() => prepareMerchantPayInstantNative({ ...pay, nowMs: NOW + 120000 }));
  assert.throws(() => prepareMerchantPayInstantNative({ ...pay, expected: { ...pay.expected, permittedPayerAccountId: 'eve.testnet' } }));
});
