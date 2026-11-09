import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  NearClientError, PROTECTED_CONSENT_VERSION, ProtectedContractConfigSchema, prepareCancelProtected,
  prepareCreateProtectedRequest, prepareFundProtectedNative, prepareReleaseProtected, prepareRetryProtectedTransfer,
  protectedConfigProblems,
} from '../dist/index.js';
import { calculateTermsHash } from '@taply/shared';

// Real outputs of the Protected Pay candidate contract's Rust unit tests
// (contracts/payments-protected/src/protected_tests.rs `snapshot`).
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const CONFIG = ProtectedContractConfigSchema.parse(fixture('protected-config'));
const OPEN = fixture('protected-open');
const LOCKED = fixture('protected-locked');
const REFUND_FAILED = fixture('protected-refund-failed');
const RELEASE_FAILED = fixture('protected-release-failed');
const REFUND_IN_FLIGHT = fixture('protected-refund-in-flight');
const PAID = fixture('protected-final-paid');
const CONTRACT = 'payments.fixture.testnet';
const refused = (fn) => assert.throws(fn, (e) => e instanceof NearClientError && e.code === 'INVALID_ARGUMENT');
const cutoff = BigInt(LOCKED.cancelUntilNs);

test('candidate config parses and always reports UNREVIEWED_CANDIDATE', () => {
  assert.deepEqual(protectedConfigProblems(CONFIG, CONTRACT), ['UNREVIEWED_CANDIDATE']);
  assert.ok(protectedConfigProblems(CONFIG, 'other.testnet').includes('CONTRACT_ID_MISMATCH'));
  assert.ok(protectedConfigProblems({ ...CONFIG, contractId: 'taply-pay-pilot-1.testnet' }, 'taply-pay-pilot-1.testnet')
    .includes('PILOT_CANNOT_HOLD_ESCROW'));
  assert.ok(protectedConfigProblems({ ...CONFIG, testFaultBuild: true }, CONTRACT).includes('TEST_FAULT_BUILD'));
  assert.ok(protectedConfigProblems({ ...CONFIG, capabilities: { ...CONFIG.capabilities, nep141: true } }, CONTRACT)
    .includes('UNSUPPORTED_CAPABILITY'));
  assert.ok(protectedConfigProblems({ ...CONFIG, capabilities: { ...CONFIG.capabilities, protectedPay: false } }, CONTRACT)
    .includes('PROTECTED_DISABLED'));
  assert.ok(protectedConfigProblems({ ...CONFIG, gas: { ...CONFIG.gas, cancelProtected: '1' } }, CONTRACT)
    .includes('GAS_BELOW_MINIMUM'));
  // The G1 config shape is not a Protected config.
  assert.equal(ProtectedContractConfigSchema.safeParse({ ...CONFIG, contractVersion: '0.4.0' }).success, false);
  assert.equal(ProtectedContractConfigSchema.safeParse({ ...CONFIG, extra: true }).success, false);
});

test('create: recipient signs protected terms with the exact quoted bond', () => {
  const terms = OPEN.terms;
  const quote = { quoteVersion: '1', requestId: terms.id, termsHash: calculateTermsHash(terms), storageBytes: '700',
    depositYocto: '7000000000000000000000', gas: '30000000000000' };
  const call = prepareCreateProtectedRequest({ contractId: CONTRACT, config: CONFIG, terms, quote, signerAccountId: 'alice.testnet' });
  assert.equal(call.methodName, 'create_request');
  assert.equal(call.depositYocto, quote.depositYocto);
  assert.deepEqual(call.args, { terms, quoteVersion: '1' });
  refused(() => prepareCreateProtectedRequest({ contractId: CONTRACT, config: CONFIG, terms, quote, signerAccountId: 'bob.testnet' }));
  refused(() => prepareCreateProtectedRequest({ contractId: CONTRACT, config: CONFIG, terms,
    quote: { ...quote, termsHash: 'f'.repeat(64) }, signerAccountId: 'alice.testnet' }));
  refused(() => prepareCreateProtectedRequest({ contractId: 'taply-pay-pilot-1.testnet', config: CONFIG,
    terms: { ...terms, contractId: 'taply-pay-pilot-1.testnet' }, quote, signerAccountId: 'alice.testnet' }));
});

test('fund: payer echoes the exact duration shown and attaches exactly the principal', () => {
  const at = OPEN.createdAtNs;
  const base = { contractId: CONTRACT, config: CONFIG, request: OPEN, signerAccountId: 'bob.testnet', observedAtNs: at };
  const call = prepareFundProtectedNative({ ...base, acceptedCancelDurationNs: OPEN.terms.cancelDurationNs });
  assert.equal(call.methodName, 'fund_protected_native');
  assert.equal(call.depositYocto, OPEN.terms.amountBaseUnits);
  assert.equal(call.gas, CONFIG.gas.fundProtectedNative);
  assert.deepEqual(call.args, { id: OPEN.terms.id, expectedTermsHash: OPEN.termsHash,
    acceptedCancelDurationNs: OPEN.terms.cancelDurationNs, consentVersion: PROTECTED_CONSENT_VERSION });
  // Consent mismatch, expiry and non-OPEN refuse.
  refused(() => prepareFundProtectedNative({ ...base, acceptedCancelDurationNs: '120000000000' }));
  refused(() => prepareFundProtectedNative({ ...base, observedAtNs: OPEN.terms.fundingExpiresAtNs,
    acceptedCancelDurationNs: OPEN.terms.cancelDurationNs }));
  refused(() => prepareFundProtectedNative({ ...base, request: LOCKED, acceptedCancelDurationNs: OPEN.terms.cancelDurationNs }));
});

test('cancel: payer only, only while the observed block is before the cutoff', () => {
  const base = { contractId: CONTRACT, config: CONFIG, request: LOCKED, signerAccountId: 'bob.testnet' };
  const call = prepareCancelProtected({ ...base, observedAtNs: (cutoff - 1n).toString() });
  assert.equal(call.methodName, 'cancel_protected');
  assert.equal(call.depositYocto, '1');
  assert.deepEqual(call.args, { id: LOCKED.terms.id, expectedTermsHash: LOCKED.termsHash });
  refused(() => prepareCancelProtected({ ...base, observedAtNs: cutoff.toString() }));
  refused(() => prepareCancelProtected({ ...base, signerAccountId: 'alice.testnet', observedAtNs: (cutoff - 1n).toString() }));
  refused(() => prepareCancelProtected({ ...base, request: REFUND_IN_FLIGHT, observedAtNs: (cutoff - 1n).toString() }));
});

test('release: anyone, only once a block at/after the cutoff is observed', () => {
  const base = { contractId: CONTRACT, config: CONFIG, request: LOCKED };
  const call = prepareReleaseProtected({ ...base, observedAtNs: cutoff.toString() });
  assert.equal(call.methodName, 'release_protected');
  assert.equal(call.depositYocto, '1');
  assert.deepEqual(call.args, { id: LOCKED.terms.id });
  refused(() => prepareReleaseProtected({ ...base, observedAtNs: (cutoff - 1n).toString() }));
  refused(() => prepareReleaseProtected({ ...base, request: PAID, observedAtNs: cutoff.toString() }));
});

test('retry: beneficiary of the committed branch only, recorded nonce', () => {
  const refund = prepareRetryProtectedTransfer({ contractId: CONTRACT, config: CONFIG, request: REFUND_FAILED, signerAccountId: 'bob.testnet' });
  assert.deepEqual(refund.args, { id: REFUND_FAILED.terms.id, expectedOperationNonce: REFUND_FAILED.latestOperation.nonce });
  refused(() => prepareRetryProtectedTransfer({ contractId: CONTRACT, config: CONFIG, request: REFUND_FAILED, signerAccountId: 'alice.testnet' }));
  const release = prepareRetryProtectedTransfer({ contractId: CONTRACT, config: CONFIG, request: RELEASE_FAILED, signerAccountId: 'alice.testnet' });
  assert.equal(release.methodName, 'retry_native_transfer');
  refused(() => prepareRetryProtectedTransfer({ contractId: CONTRACT, config: CONFIG, request: RELEASE_FAILED, signerAccountId: 'bob.testnet' }));
  refused(() => prepareRetryProtectedTransfer({ contractId: CONTRACT, config: CONFIG, request: LOCKED, signerAccountId: 'bob.testnet' }));
});

test('every candidate fixture is a valid frozen ContractRequest', () => {
  for (const name of ['protected-open', 'protected-locked', 'protected-refund-in-flight', 'protected-refund-failed',
    'protected-cancelled-refunded', 'protected-release-in-flight', 'protected-release-failed', 'protected-final-paid']) {
    const record = fixture(name);
    assert.equal(record.termsHash, calculateTermsHash(record.terms), name);
    assert.equal(record.terms.mode, 'protected');
  }
});

import { createProtectedReader } from '../dist/index.js';
import { HASH, HASH2, account, block, status } from './helpers.mjs';

function reader({ codeHash = HASH, callBlockHash = HASH, contractId = CONTRACT, answer = fixture('protected-config') } = {}) {
  const calls = [];
  const fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    calls.push(request.method + ':' + (request.params?.request_type ?? ''));
    let result;
    if (request.method === 'status') result = status;
    else if (request.method === 'block') result = block;
    else if (request.params.request_type === 'view_account') result = { ...account, code_hash: codeHash };
    else result = { result: Array.from(new TextEncoder().encode(JSON.stringify(answer))), logs: [], block_hash: callBlockHash, block_height: 123 };
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  };
  const r = createProtectedReader({ network: 'near-testnet', rpcUrl: 'https://rpc.testnet.near.org', rpcProviderId: 'testnet-public',
    contract: { accountId: contractId, expectedCodeHash: HASH } }, fetch, () => new Date('2026-10-29T12:00:00.000Z'));
  return { r, calls };
}

test('reader: candidate config is read at one final block after the code-hash check', async () => {
  const { r, calls } = reader();
  const read = await r.readConfig();
  assert.equal(read.error, null);
  assert.equal(read.observation.assurance, 'verified_final');
  assert.equal(read.observation.data.contractVersion, '0.5.0-g3-candidate');
  assert.deepEqual(calls.slice(-3), ['block:', 'query:view_account', 'query:call_function']);
});

test('reader: wrong code hash, unanchored view or wrong contract fail closed', async () => {
  assert.equal((await reader({ codeHash: HASH2 }).r.readConfig()).error.code, 'CONTRACT_CODE_MISMATCH');
  assert.equal((await reader({ callBlockHash: HASH2 }).r.readConfig()).error.code, 'EVIDENCE_MISMATCH');
  const g1 = { ...fixture('protected-config'), contractVersion: '0.4.0' };
  assert.equal((await reader({ answer: g1 }).r.readConfig()).error.code, 'RPC_MALFORMED_RESPONSE');
  const other = { ...fixture('protected-config'), contractId: 'other.testnet' };
  assert.equal((await reader({ answer: other }).r.readConfig()).observation.data, null);
  assert.throws(() => reader({ contractId: 'taply-pay-pilot-1.testnet' }), (e) => e.code === 'INVALID_CONFIG');
});

import { assetAllowed, prepareTokenFunding, prepareTokenStorageDeposit, preparePayInstantNative as g1Pay } from '../dist/index.js';

const TOKEN_CONFIG = ProtectedContractConfigSchema.parse(fixture('token-config'));
const TOKEN_OPEN = fixture('token-instant-open');
const TOKEN_LOCKED = fixture('token-protected-locked');

test('token config: allowlisted token is consistent; still UNREVIEWED_CANDIDATE only', () => {
  assert.deepEqual(protectedConfigProblems(TOKEN_CONFIG, CONTRACT), ['UNREVIEWED_CANDIDATE']);
  assert.equal(assetAllowed(TOKEN_CONFIG, 'nep141:tusd.fixture.testnet'), true);
  assert.equal(assetAllowed(TOKEN_CONFIG, 'nep141:evil.testnet'), false);
  // nep141 flag without tokens (or a mismatched asset id) is malformed.
  assert.ok(protectedConfigProblems({ ...TOKEN_CONFIG, tokens: [] }, CONTRACT).includes('UNSUPPORTED_CAPABILITY'));
  assert.ok(protectedConfigProblems({ ...TOKEN_CONFIG, tokens: [{ ...TOKEN_CONFIG.tokens[0], assetId: 'nep141:other.testnet' }] }, CONTRACT)
    .includes('UNSUPPORTED_CAPABILITY'));
});

test('token funding: ft_transfer_call on the TOKEN, exact amount, 1 yocto, strict msg without payee', () => {
  const call = prepareTokenFunding({ contractId: CONTRACT, config: TOKEN_CONFIG, request: TOKEN_OPEN, signerAccountId: 'bob.testnet',
    observedAtNs: TOKEN_OPEN.createdAtNs });
  assert.equal(call.receiverId, 'tusd.fixture.testnet');
  assert.equal(call.methodName, 'ft_transfer_call');
  assert.equal(call.depositYocto, '1');
  assert.equal(call.args.receiver_id, CONTRACT);
  assert.equal(call.args.amount, TOKEN_OPEN.terms.amountBaseUnits);
  assert.deepEqual(JSON.parse(call.args.msg), { id: TOKEN_OPEN.terms.id, expectedTermsHash: TOKEN_OPEN.termsHash, action: 'pay_instant' });
  refused(() => prepareTokenFunding({ contractId: CONTRACT, config: { ...TOKEN_CONFIG, tokens: [] }, request: TOKEN_OPEN,
    signerAccountId: 'bob.testnet', observedAtNs: TOKEN_OPEN.createdAtNs }));
  refused(() => prepareTokenFunding({ contractId: CONTRACT, config: TOKEN_CONFIG, request: TOKEN_OPEN, signerAccountId: 'bob.testnet',
    observedAtNs: TOKEN_OPEN.terms.fundingExpiresAtNs }));
  refused(() => prepareTokenFunding({ contractId: CONTRACT, config: TOKEN_CONFIG, request: TOKEN_LOCKED, signerAccountId: 'bob.testnet',
    observedAtNs: TOKEN_LOCKED.createdAtNs, acceptedCancelDurationNs: '60000000000' }));
  // A native NEAR funding call can never be built for a token request.
  refused(() => prepareFundProtectedNative({ contractId: CONTRACT, config: TOKEN_CONFIG, request: { ...TOKEN_LOCKED, status: 'OPEN' },
    signerAccountId: 'bob.testnet', observedAtNs: TOKEN_LOCKED.createdAtNs, acceptedCancelDurationNs: '60000000000' }));
  assert.deepEqual(prepareTokenStorageDeposit({ tokenAccountId: 'tusd.fixture.testnet', accountId: 'bob.testnet', depositYocto: '1250000000000000000000' }).args,
    { account_id: 'bob.testnet', registration_only: true });
});

test('G1 builders refuse token terms outright', () => {
  const g1Config = { schemaVersion: 'taply.contract-config.v1', contractVersion: '0.4.0', network: 'near-testnet', contractId: CONTRACT,
    intentVersion: 'taply.intent.v1', eventVersion: '0.4.0',
    capabilities: { instantNative: true, protectedPay: false, handshake: false, merchantProfiles: false, nep141: false, sponsoredGas: false },
    quoteVersion: '1', storageByteCostYocto: '10000000000000000000',
    gas: { createRequest: '30000000000000', payInstantNative: '50000000000000', retryNativeTransfer: '50000000000000', cancelUnfunded: '15000000000000', callback: '15000000000000' },
    storageRefundPolicy: 'PERMANENT_RECORD_NO_WITHDRAWAL', unknownCallbackPolicy: 'IN_FLIGHT_NO_RETRY_NO_ADMIN_OVERRIDE', testFaultBuild: false };
  refused(() => g1Pay({ contractId: CONTRACT, config: g1Config, request: TOKEN_OPEN, signerAccountId: 'bob.testnet', observedAtNs: TOKEN_OPEN.createdAtNs }));
});
