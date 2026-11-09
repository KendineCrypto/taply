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
