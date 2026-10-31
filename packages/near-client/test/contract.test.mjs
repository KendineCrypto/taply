import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  ABI_MINIMUM_GAS, contractConfigProblems, createNearTestnetClient, prepareCancelUnfunded,
  prepareCreateRequest, preparePayInstantNative, prepareRetryNativeTransfer,
} from '../dist/index.js';
import { account, block, HASH, HASH2, mock, status } from './helpers.mjs';

// Real `get_request` outputs captured from the 9/9 sandbox run (CI run 41236806667).
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const OPEN = fixture('request-open');
const OPEN_RESTRICTED = fixture('request-open-restricted');
const IN_FLIGHT = fixture('request-payout-in-flight');
const FAILED = fixture('request-payout-failed');
const PAID = fixture('request-final-paid');
const CANCELLED = fixture('request-cancelled-unfunded');
// Real quote for IN_FLIGHT's terms, from the same run's MEASURE log.
const QUOTE = { depositYocto: '5860000000000000000000', gas: '30000000000000', quoteVersion: '1',
  requestId: '4844781a85b56dd49a75b87c0dd6954c41c1ac69c487e20315d5e91c6856dcd0', storageBytes: '586',
  termsHash: 'bfe59f76ae03c1a9144b0d49f3a419a26625ec8d198a9e53dd9d40b1ffb8d2df' };
const configFor = (contractId, overrides = {}) => ({
  schemaVersion: 'taply.contract-config.v1', contractVersion: '0.4.0', network: 'near-testnet', contractId,
  intentVersion: 'taply.intent.v1', eventVersion: '0.4.0',
  capabilities: { instantNative: true, protectedPay: false, handshake: false, merchantProfiles: false, nep141: false, sponsoredGas: false },
  quoteVersion: '1', storageByteCostYocto: '10000000000000000000',
  gas: { createRequest: '30000000000000', payInstantNative: '50000000000000', retryNativeTransfer: '50000000000000',
    cancelUnfunded: '15000000000000', callback: '15000000000000' },
  storageRefundPolicy: 'PERMANENT_RECORD_NO_WITHDRAWAL', unknownCallbackPolicy: 'IN_FLIGHT_NO_RETRY_NO_ADMIN_OVERRIDE',
  testFaultBuild: false, ...overrides,
});

const bytes = (value) => Array.from(new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)));
const decodeArgs = (request) => JSON.parse(Buffer.from(request.params.args_base64, 'base64').toString('utf8'));
/** RPC routes for one contract: view_account carries the code hash, call_function answers by method. */
function contractRoutes(answers, { codeHash = HASH, callBlock = {} } = {}) {
  return {
    query: (request) => {
      if (request.params.request_type === 'view_account') return { ...account, code_hash: codeHash };
      const answer = answers[request.params.method_name];
      if (answer?.rpcError) return answer;
      assert.notEqual(answer, undefined, `unexpected view ${request.params.method_name}`);
      return { result: bytes(typeof answer === 'function' ? answer(decodeArgs(request)) : answer), logs: [],
        block_hash: HASH, block_height: 123, ...callBlock };
    },
  };
}
const contractOf = (request, codeHash = HASH) => ({ contract: { accountId: request.terms.contractId, expectedCodeHash: codeHash } });

test('get_request is read at one final block after checking the approved code hash', async () => {
  for (const record of [OPEN, OPEN_RESTRICTED, IN_FLIGHT, FAILED, PAID, CANCELLED]) {
    const { client, calls } = mock(contractRoutes({ get_request: record }), contractOf(record));
    const read = await client.readPaymentRequest(record.terms.id);
    assert.equal(read.error, null, record.status);
    assert.deepEqual(read.observation.data, { id: record.terms.id, request: record });
    // Injected transports can never verify anything.
    assert.equal(read.observation.source, 'mock');
    assert.equal(read.observation.assurance, 'unverified');
    assert.deepEqual(calls.map((c) => [c.method, c.params.request_type ?? null]), [
      ['status', null], ['block', null], ['query', 'view_account'], ['query', 'call_function'],
    ]);
    const call = calls[3].params;
    assert.equal(call.account_id, record.terms.contractId);
    assert.equal(call.block_id, HASH);
    assert.deepEqual(decodeArgs(calls[3]), { id: record.terms.id });
  }
});

test('unknown request id is an explicit null at a final block, not an error or a zero', async () => {
  const { client } = mock(contractRoutes({ get_request: null }), contractOf(OPEN));
  const read = await client.readPaymentRequest('ab'.repeat(32));
  assert.equal(read.error, null);
  assert.deepEqual(read.observation.data, { id: 'ab'.repeat(32), request: null });
});

test('no configured contract means no RPC traffic at all', async () => {
  const { client, calls } = mock();
  for (const read of [client.readContractConfig(), client.readPaymentRequest(OPEN.terms.id),
    client.readTerminalFacts(OPEN.terms.id), client.quoteCreateRequest(OPEN.terms)]) {
    assert.equal((await read).error.code, 'CONTRACT_NOT_CONFIGURED');
  }
  assert.equal(calls.length, 0);
});

test('a code hash that differs from the approved pin fails before any contract view runs', async () => {
  const { client, calls } = mock(contractRoutes({ get_request: OPEN }, { codeHash: HASH2 }), contractOf(OPEN));
  const read = await client.readPaymentRequest(OPEN.terms.id);
  assert.equal(read.error.code, 'CONTRACT_CODE_MISMATCH');
  assert.equal(read.observation.assurance, 'unverified'); // mock transport stays unverified even on mismatch
  assert.equal(read.observation.data, null);
  assert.equal(calls.some((c) => c.params?.request_type === 'call_function'), false);
});

test('contract answers are cross-checked: wrong id, wrong contract, wrong block, tampered or duplicate JSON', async () => {
  const otherId = { ...OPEN, terms: { ...OPEN.terms } };
  const cases = [
    ['another request', { get_request: PAID }, contractOf(PAID), OPEN.terms.id, 'EVIDENCE_MISMATCH'],
    ['answer from another block', { get_request: OPEN }, contractOf(OPEN), OPEN.terms.id, 'EVIDENCE_MISMATCH', { block_height: 124 }],
    ['tampered terms hash', { get_request: { ...OPEN, termsHash: 'f'.repeat(64) } }, contractOf(OPEN), OPEN.terms.id, 'RPC_MALFORMED_RESPONSE'],
    ['tampered amount', { get_request: { ...otherId, terms: { ...otherId.terms, amountBaseUnits: '2' } } }, contractOf(OPEN), OPEN.terms.id, 'RPC_MALFORMED_RESPONSE'],
    ['duplicate keys', { get_request: '{"status":"OPEN","status":"FINAL_PAID"}' }, contractOf(OPEN), OPEN.terms.id, 'RPC_MALFORMED_RESPONSE'],
    ['not JSON', { get_request: 'paid' }, contractOf(OPEN), OPEN.terms.id, 'RPC_MALFORMED_RESPONSE'],
  ];
  for (const [label, answers, contract, id, code, callBlock] of cases) {
    const { client } = mock(contractRoutes(answers, { callBlock }), contract);
    const read = await client.readPaymentRequest(id);
    assert.equal(read.error?.code, code, label);
    assert.equal(read.observation.data, null, label);
  }
  const { client } = mock(contractRoutes({ get_request: OPEN }), { contract: { accountId: 'payments.testnet', expectedCodeHash: HASH } });
  assert.equal((await client.readPaymentRequest(OPEN.terms.id)).error.code, 'EVIDENCE_MISMATCH');
});

test('a real (non-injected) client produces verified_final rpc observations with block provenance', async (t) => {
  const routes = contractRoutes({ get_request: PAID });
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    const result = request.method === 'status' ? status : request.method === 'block' ? block : routes.query(request);
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  });
  const client = createNearTestnetClient({ network: 'near-testnet', rpcUrl: 'https://rpc.testnet.near.org',
    rpcProviderId: 'testnet-public', ...contractOf(PAID) });
  const read = await client.readPaymentRequest(PAID.terms.id);
  assert.equal(read.error, null);
  assert.equal(read.observation.source, 'rpc');
  assert.equal(read.observation.assurance, 'verified_final');
  assert.deepEqual(read.observation.observedBlock, { hash: HASH, height: '123', timestampNs: '1793520000000000001' });
  assert.equal(read.observation.data.request.status, 'FINAL_PAID');
});

test('get_config parses the contract output; capability problems are reported, not hidden', async () => {
  const contractId = OPEN.terms.contractId;
  const { client } = mock(contractRoutes({ get_config: configFor(contractId) }), contractOf(OPEN));
  const read = await client.readContractConfig();
  assert.equal(read.error, null);
  assert.deepEqual(contractConfigProblems(read.observation.data, contractId), []);
  assert.deepEqual(contractConfigProblems(configFor(contractId, { testFaultBuild: true }), contractId), ['TEST_FAULT_BUILD']);
  assert.deepEqual(contractConfigProblems(configFor(contractId, {
    capabilities: { ...configFor(contractId).capabilities, protectedPay: true } }), contractId), ['UNREVIEWED_CAPABILITY']);
  assert.deepEqual(contractConfigProblems(configFor('other.testnet'), contractId), ['CONTRACT_ID_MISMATCH']);
  assert.deepEqual(contractConfigProblems(configFor(contractId, { gas: { ...configFor(contractId).gas, payInstantNative: '1' } }), contractId),
    ['GAS_BELOW_ABI_MINIMUM']);
  assert.equal(ABI_MINIMUM_GAS.payInstantNative, 50_000_000_000_000n);
  // A config that names another account is someone else's contract.
  const foreign = mock(contractRoutes({ get_config: configFor('other.testnet') }), contractOf(OPEN));
  assert.equal((await foreign.client.readContractConfig()).error.code, 'EVIDENCE_MISMATCH');
  const extra = mock(contractRoutes({ get_config: { ...configFor(contractId), owner: 'x.testnet' } }), contractOf(OPEN));
  assert.equal((await extra.client.readContractConfig()).error.code, 'RPC_MALFORMED_RESPONSE');
});

test('a quote must bind the exact terms it was asked about', async () => {
  const good = mock(contractRoutes({ quote_create_request: (args) => {
    assert.deepEqual(args, { terms: IN_FLIGHT.terms });
    return QUOTE;
  } }), contractOf(IN_FLIGHT));
  const read = await good.client.quoteCreateRequest(IN_FLIGHT.terms);
  assert.equal(read.error, null);
  assert.deepEqual(read.observation.data, QUOTE);
  const swapped = mock(contractRoutes({ quote_create_request: { ...QUOTE, termsHash: 'a'.repeat(64) } }), contractOf(IN_FLIGHT));
  assert.equal((await swapped.client.quoteCreateRequest(IN_FLIGHT.terms)).error.code, 'EVIDENCE_MISMATCH');
  const otherContract = mock(contractRoutes({}), contractOf(OPEN));
  assert.equal((await otherContract.client.quoteCreateRequest(IN_FLIGHT.terms)).error.code, 'INVALID_ARGUMENT');
});

test('a view panic surfaces only a known ABI code, never provider prose', async () => {
  const panic = (message) => ({ rpcError: { code: -32000, name: 'HANDLER_ERROR',
    cause: { name: 'CONTRACT_EXECUTION_ERROR', info: { vm_error: message } }, data: message } });
  const known = mock(contractRoutes({ quote_create_request: panic('Smart contract panicked: NONCE_CONSUMED <script>') }), contractOf(IN_FLIGHT));
  const read = await known.client.quoteCreateRequest(IN_FLIGHT.terms);
  assert.deepEqual(read.error, { code: 'CONTRACT_VIEW_REJECTED', messageKey: 'nearClient.errors.CONTRACT_VIEW_REJECTED',
    retry: 'NONE', providerId: 'testnet-public', contractCode: 'NONCE_CONSUMED' });
  const unknown = mock(contractRoutes({ quote_create_request: panic('HOSTILE_TEXT here') }), contractOf(IN_FLIGHT));
  const other = await unknown.client.quoteCreateRequest(IN_FLIGHT.terms);
  assert.equal(other.error.code, 'CONTRACT_VIEW_REJECTED');
  assert.equal(Object.hasOwn(other.error, 'contractCode'), false);
});

test('get_receipt returns contract terminal facts, which are explicitly not finality proof', async () => {
  const facts = { schemaVersion: 'taply.terminal-facts.v1', request: PAID, terminalBlockHeight: '200',
    terminalAtNs: PAID.latestOperation.resolvedAtNs, payoutConfirmed: true, evidenceKind: 'CONTRACT_FACTS_NOT_FINALITY_PROOF' };
  const { client } = mock(contractRoutes({ get_receipt: facts }), contractOf(PAID));
  const read = await client.readTerminalFacts(PAID.terms.id);
  assert.equal(read.error, null);
  assert.equal(read.observation.data.facts.evidenceKind, 'CONTRACT_FACTS_NOT_FINALITY_PROOF');
  const lying = mock(contractRoutes({ get_receipt: { ...facts, request: FAILED } }), contractOf(PAID));
  assert.equal((await lying.client.readTerminalFacts(PAID.terms.id)).error.code, 'RPC_MALFORMED_RESPONSE');
  const none = mock(contractRoutes({ get_receipt: null }), contractOf(IN_FLIGHT));
  assert.equal((await none.client.readTerminalFacts(IN_FLIGHT.terms.id)).observation.data.facts, null);
});

test('prepared calls follow the ABI exactly and refuse anything the contract would reject', () => {
  const create = prepareCreateRequest({ contractId: IN_FLIGHT.terms.contractId, config: configFor(IN_FLIGHT.terms.contractId),
    terms: IN_FLIGHT.terms, quote: QUOTE, signerAccountId: IN_FLIGHT.terms.creatorAccountId });
  assert.deepEqual(create, { receiverId: IN_FLIGHT.terms.contractId, methodName: 'create_request',
    gas: '30000000000000', depositYocto: QUOTE.depositYocto, args: { terms: IN_FLIGHT.terms, quoteVersion: '1' } });
  assert.throws(() => prepareCreateRequest({ contractId: IN_FLIGHT.terms.contractId, config: configFor(IN_FLIGHT.terms.contractId),
    terms: IN_FLIGHT.terms, quote: QUOTE, signerAccountId: 'someone.testnet' }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => prepareCreateRequest({ contractId: IN_FLIGHT.terms.contractId, config: configFor(IN_FLIGHT.terms.contractId),
    terms: IN_FLIGHT.terms, quote: { ...QUOTE, requestId: OPEN.terms.id }, signerAccountId: IN_FLIGHT.terms.creatorAccountId }));

  const contractId = OPEN.terms.contractId;
  const config = configFor(contractId);
  const before = (BigInt(OPEN.terms.fundingExpiresAtNs) - 1n).toString();
  const pay = preparePayInstantNative({ contractId, config, request: OPEN, signerAccountId: 'payer.testnet', observedAtNs: before });
  assert.deepEqual(pay, { receiverId: contractId, methodName: 'pay_instant_native', gas: '50000000000000',
    depositYocto: OPEN.terms.amountBaseUnits, args: { id: OPEN.terms.id, expectedTermsHash: OPEN.termsHash } });
  // Expired at the observed block, wrong state, or a payer the terms do not permit.
  assert.throws(() => preparePayInstantNative({ contractId, config, request: OPEN, signerAccountId: 'payer.testnet',
    observedAtNs: OPEN.terms.fundingExpiresAtNs }));
  assert.throws(() => preparePayInstantNative({ contractId, config, request: CANCELLED, signerAccountId: 'payer.testnet', observedAtNs: before }));
  const restrictedBefore = (BigInt(OPEN_RESTRICTED.terms.fundingExpiresAtNs) - 1n).toString();
  assert.throws(() => preparePayInstantNative({ contractId, config, request: OPEN_RESTRICTED, signerAccountId: 'payer.testnet',
    observedAtNs: restrictedBefore }));
  assert.equal(preparePayInstantNative({ contractId, config, request: OPEN_RESTRICTED,
    signerAccountId: OPEN_RESTRICTED.terms.permittedPayerAccountId, observedAtNs: restrictedBefore }).methodName, 'pay_instant_native');
  // A different contract's request can never be paid through this one.
  assert.throws(() => preparePayInstantNative({ contractId: 'other.testnet', config, request: OPEN, signerAccountId: 'payer.testnet', observedAtNs: before }));

  const failedContract = FAILED.terms.contractId;
  const retry = prepareRetryNativeTransfer({ contractId: failedContract, config: configFor(failedContract), request: FAILED,
    signerAccountId: FAILED.recipientAccountId });
  assert.deepEqual(retry, { receiverId: failedContract, methodName: 'retry_native_transfer', gas: '50000000000000',
    depositYocto: '1', args: { id: FAILED.terms.id, expectedOperationNonce: FAILED.latestOperation.nonce } });
  // Payer has no retry; an in-flight or paid request never offers one.
  assert.throws(() => prepareRetryNativeTransfer({ contractId: failedContract, config: configFor(failedContract), request: FAILED, signerAccountId: 'payer.testnet' }));
  for (const request of [IN_FLIGHT, PAID]) assert.throws(() => prepareRetryNativeTransfer({ contractId: request.terms.contractId,
    config: configFor(request.terms.contractId), request, signerAccountId: request.recipientAccountId }));

  const cancel = prepareCancelUnfunded({ contractId, config, request: OPEN, signerAccountId: OPEN.recipientAccountId });
  assert.deepEqual(cancel, { receiverId: contractId, methodName: 'cancel_unfunded', gas: '15000000000000',
    depositYocto: '1', args: { id: OPEN.terms.id, expectedTermsHash: OPEN.termsHash } });
  assert.throws(() => prepareCancelUnfunded({ contractId, config, request: OPEN, signerAccountId: 'payer.testnet' }));
  assert.throws(() => prepareCancelUnfunded({ contractId: IN_FLIGHT.terms.contractId, config, request: IN_FLIGHT,
    signerAccountId: IN_FLIGHT.recipientAccountId }));
});
