import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mock, block, HASH, HASH2, HASH3, rpcError } from './helpers.mjs';

const ref = { transactionHash: HASH, signerAccountId: 'alice.testnet' };
const receiptRef = { ...ref, receiptId: HASH2 };
const outcome = (id, executor, status, children = []) => ({
  id, block_hash: HASH,
  outcome: { executor_id: executor, receipt_ids: children, status, logs: [], gas_burnt: 12345, tokens_burnt: '123456789123456789' },
});
const success = { SuccessValue: '' };
const failure = { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: 'callback panicked' } } } } };
function fixture() {
  return {
    final_execution_status: 'FINAL', status: success,
    transaction: { hash: HASH, signer_id: 'alice.testnet', receiver_id: 'payments.testnet' },
    transaction_outcome: outcome(HASH, 'alice.testnet', { SuccessReceiptId: HASH2 }, [HASH2]),
    receipts_outcome: [outcome(HASH2, 'payments.testnet', success)],
  };
}
function txMock(change = value => value, routes = {}) {
  return mock({ tx_status: () => change(fixture()), ...routes });
}

test('requests FINAL explicitly and observes every outcome, without payment state or VerifiedReceipt', async () => {
  const { client, calls } = txMock();
  const result = await client.observeTransaction(ref);
  assert.equal(result.error, null);
  const data = result.observation.data;
  assert.equal(data.executionFinality, 'FINAL');
  assert.equal(data.outcomeGraphComplete, true);
  assert.equal(data.status.kind, 'SUCCESS_VALUE');
  assert.equal(data.blocks[0].timestampNs, block.header.timestamp_nanosec);
  assert.equal(data.receiptOutcomes[0].gasBurnt, '12345');
  assert.equal(data.receiptOutcomes[0].tokensBurntYoctoNear, '123456789123456789');
  assert.equal(result.observation.assurance, 'unverified');
  assert.equal(result.observation.source, 'mock');
  assert.equal(result.observation.observedBlock, null);
  assert.deepEqual(calls.find(c => c.method === 'tx_status').params, {
    tx_hash: HASH, sender_account_id: 'alice.testnet', wait_until: 'FINAL',
  });
  assert.equal(JSON.stringify(result).includes('FINAL_PAID'), false);
  assert.equal(Object.hasOwn(data, 'paymentState'), false);
  assert.equal(Object.hasOwn(data, 'verification'), false);
});

test('receipt observation is bound to its originating transaction, executor and finalized block', async () => {
  const { client } = txMock();
  const result = await client.observeReceipt(receiptRef);
  assert.equal(result.error, null);
  assert.equal(result.observation.data.outcome.executorAccountId, 'payments.testnet');
  assert.equal(result.observation.data.block.hash, HASH);
  assert.equal(result.observation.data.executionFinality, 'FINAL');
  assert.equal((await client.observeReceipt({ ...ref, receiptId: HASH3 })).error.code, 'RECEIPT_NOT_FOUND');
  assert.equal((await client.observeReceipt({ ...ref, receiptId: HASH })).error.code, 'RECEIPT_NOT_FOUND');
});

for (const finality of ['NONE', 'INCLUDED', 'EXECUTED_OPTIMISTIC', 'INCLUDED_FINAL', 'EXECUTED']) test(`${finality} is not finalized receipt evidence`, async () => {
  const { client } = txMock(v => ({ ...v, final_execution_status: finality }));
  const result = await client.observeTransaction(ref);
  assert.equal(result.error, null);
  assert.equal(result.observation.data.executionFinality, finality);
  assert.deepEqual(result.observation.data.blocks, []);
  const receipt = await client.observeReceipt(receiptRef);
  assert.equal(receipt.observation.data.block, null);
});

test('missing pending receipt is unknown, never a definitive not-found', async () => {
  const { client } = txMock(v => ({ ...v, final_execution_status: 'INCLUDED_FINAL', receipts_outcome: [] }));
  const tx = await client.observeTransaction(ref);
  assert.equal(tx.error, null);
  assert.equal(tx.observation.data.outcomeGraphComplete, false);
  assert.equal((await client.observeReceipt(receiptRef)).error.code, 'EVIDENCE_INCOMPLETE');
});

test('callback failure stays visible after successful transfer, with no payment retry inference', async () => {
  const { client } = txMock(v => ({ ...v, status: failure,
    receipts_outcome: [outcome(HASH2, 'recipient.testnet', { SuccessReceiptId: HASH3 }, [HASH3]),
      outcome(HASH3, 'payments.testnet', failure)],
  }));
  const result = await client.observeTransaction(ref);
  assert.equal(result.error, null);
  assert.equal(result.observation.data.status.kind, 'FAILURE');
  assert.equal(result.observation.data.receiptOutcomes[0].status.kind, 'SUCCESS_RECEIPT_ID');
  assert.equal(result.observation.data.receiptOutcomes[1].status.kind, 'FAILURE');
  assert.equal(JSON.stringify(result).includes('FINAL_PAID'), false);
});

test('top-level success does not conceal a failed child payout; return false remains base64', async () => {
  const returnedFalse = { SuccessValue: 'ZmFsc2U=' };
  const { client } = txMock(v => ({ ...v, status: returnedFalse,
    receipts_outcome: [outcome(HASH2, 'payments.testnet', returnedFalse, [HASH3]), outcome(HASH3, 'recipient.testnet', failure)],
  }));
  const result = await client.observeTransaction(ref);
  assert.equal(result.error, null);
  assert.equal(result.observation.data.status.kind, 'SUCCESS_VALUE');
  assert.equal(result.observation.data.status.valueBase64, 'ZmFsc2U=');
  assert.equal(result.observation.data.receiptOutcomes[1].status.kind, 'FAILURE');
});

for (const [label, change, expected] of [
  ['transaction hash', v => { v.transaction.hash = HASH2; }, 'EVIDENCE_MISMATCH'],
  ['signer', v => { v.transaction.signer_id = 'mallory.testnet'; }, 'EVIDENCE_MISMATCH'],
  ['root id', v => { v.transaction_outcome.id = HASH2; }, 'EVIDENCE_MISMATCH'],
  ['root executor', v => { v.transaction_outcome.outcome.executor_id = 'mallory.testnet'; }, 'EVIDENCE_MISMATCH'],
  ['duplicate receipt', v => { v.receipts_outcome.push(v.receipts_outcome[0]); }, 'EVIDENCE_MISMATCH'],
  ['missing receipt', v => { v.receipts_outcome = []; }, 'EVIDENCE_INCOMPLETE'],
  ['unrelated receipt', v => { v.receipts_outcome.push(outcome(HASH3, 'eve.testnet', success)); }, 'EVIDENCE_MISMATCH'],
  ['cycle', v => { v.receipts_outcome[0].outcome.receipt_ids = [HASH]; }, 'EVIDENCE_MISMATCH'],
  ['duplicate edge', v => { v.transaction_outcome.outcome.receipt_ids.push(HASH2); }, 'EVIDENCE_MISMATCH'],
  ['unknown final receipt', v => { v.receipts_outcome[0].outcome.status = 'Unknown'; }, 'EVIDENCE_INCOMPLETE'],
  ['unknown final top status', v => { v.status = 'Started'; }, 'EVIDENCE_INCOMPLETE'],
  ['contradictory top success', v => { v.receipts_outcome[0].outcome.status = failure; }, 'EVIDENCE_MISMATCH'],
  ['contradictory return value', v => { v.status = { SuccessValue: 'ZmFsc2U=' }; }, 'EVIDENCE_MISMATCH'],
  ['unlinked selected receipt', v => { v.transaction_outcome.outcome.status = { SuccessReceiptId: HASH3 }; }, 'EVIDENCE_MISMATCH'],
  ['future finality enum', v => { v.final_execution_status = 'VERY_FINAL'; }, 'RPC_MALFORMED_RESPONSE'],
  ['ambiguous status union', v => { v.status = { ...success, ...failure }; }, 'RPC_MALFORMED_RESPONSE'],
  ['invalid amount', v => { v.receipts_outcome[0].outcome.tokens_burnt = '-1'; }, 'RPC_MALFORMED_RESPONSE'],
]) test(`rejects ${label}`, async () => {
  const { client } = txMock(v => { change(v); return v; });
  const result = await client.observeTransaction(ref);
  assert.equal(result.error.code, expected);
  assert.equal(result.observation.data, null);
});

test('legacy method alias only follows method-not-found; never timeout or unknown', async () => {
  const { client, calls } = txMock(v => v, {
    tx_status: () => rpcError('METHOD_NOT_FOUND', -32601), EXPERIMENTAL_tx_status: () => fixture(),
  });
  assert.equal((await client.observeTransaction(ref)).error, null);
  assert.deepEqual(calls.filter(c => c.method.includes('tx_status')).map(c => c.method), ['tx_status', 'EXPERIMENTAL_tx_status']);
  for (const [name, expected] of [['TIMEOUT_ERROR', 'RPC_TIMEOUT'], ['UNKNOWN_TRANSACTION', 'TRANSACTION_UNKNOWN']]) {
    const { client, calls } = txMock(v => v, { tx_status: () => rpcError(name) });
    const result = await client.observeTransaction(ref);
    assert.equal(result.error.code, expected);
    assert.equal(result.error.retry, 'WAIT_AND_RECONCILE');
    assert.equal(calls.length, 2);
  }
});

test('hash alone or NONE response cannot become final evidence', async () => {
  for (const value of [HASH, { final_execution_status: 'NONE' }]) {
    const { client } = txMock(() => value);
    const result = await client.observeTransaction(ref);
    assert.notEqual(result.error, null);
    assert.equal(result.observation.data, null);
  }
});

for (const [label, header] of [
  ['wrong hash', { hash: HASH3, height: 122 }],
  ['future height', { hash: HASH2, height: 124 }],
  ['same height different hash', { hash: HASH2, height: 123 }],
  ['future time', { hash: HASH2, height: 122, timestamp_nanosec: '1793520000000000002' }],
]) test(`receipt block rejects ${label}`, async () => {
  const { client } = txMock(v => { v.receipts_outcome[0].block_hash = HASH2; return v; }, {
    block: req => req.params.finality ? block : { header: { ...block.header, ...header } },
  });
  assert.equal((await client.observeTransaction(ref)).error.code, 'EVIDENCE_MISMATCH');
});

test('receipt cannot execute before parent transaction', async () => {
  const { client } = txMock(v => { v.receipts_outcome[0].block_hash = HASH2; return v; }, {
    block: req => req.params.finality ? block : { header: { ...block.header, hash: HASH2, height: 122 } },
  });
  assert.equal((await client.observeTransaction(ref)).error.code, 'EVIDENCE_MISMATCH');
});

test('invalid arguments reject without RPC; no bare receipt API', async () => {
  const { client, calls } = txMock();
  for (const invalid of [{ transactionHash: 'x', signerAccountId: 'alice.testnet' }, { transactionHash: HASH }, { ...ref, signed_tx_base64: 'secret' }])
    assert.equal((await client.observeTransaction(invalid)).error.code, 'INVALID_ARGUMENT');
  assert.equal((await client.observeReceipt({ receiptId: HASH2 })).error.code, 'INVALID_ARGUMENT');
  assert.equal(calls.length, 0);
});

test('transaction with a self receiver works without receipt payload details', async () => {
  const { client } = txMock(v => ({ ...v, transaction: { ...v.transaction, receiver_id: 'alice.testnet' }, receipts: [] }));
  assert.equal((await client.observeTransaction(ref)).error, null);
});

test('forged payment log has no authority over observation types or failures', async () => {
  const { client } = txMock(v => {
    v.status = failure;
    v.receipts_outcome[0].outcome.status = failure;
    v.receipts_outcome[0].outcome.logs = ['EVENT_JSON:{"event":"FINAL_PAID","verified":true}'];
    return v;
  });
  const result = await client.observeReceipt(receiptRef);
  assert.equal(result.error, null);
  assert.equal(result.observation.data.outcome.status.kind, 'FAILURE');
  assert.equal(result.observation.assurance, 'unverified');
  assert.equal(Object.hasOwn(result.observation.data, 'paymentState'), false);
});

test('oversized receipt arrays fail before block fan-out', async () => {
  const { client, calls } = txMock(v => ({ ...v, receipts_outcome: Array(257).fill(v.receipts_outcome[0]) }));
  assert.equal((await client.observeTransaction(ref)).error.code, 'RPC_MALFORMED_RESPONSE');
  assert.equal(calls.length, 2);
});

test('excessive distinct outcome blocks fail without historical block fan-out', async () => {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const ids = Array.from({ length: 33 }, (_, i) => '1'.repeat(31) + alphabet[i + 1]);
  const { client, calls } = txMock(v => ({ ...v,
    transaction_outcome: outcome(HASH, 'alice.testnet', { SuccessReceiptId: ids[0] }, ids),
    receipts_outcome: ids.map(id => ({ ...outcome(id, 'recipient.testnet', success), block_hash: id })),
  }));
  assert.equal((await client.observeTransaction(ref)).error.code, 'EVIDENCE_INCOMPLETE');
  assert.equal(calls.filter(call => call.method === 'block').length, 1);
});

test('valid multi-block receipt provenance remains decimal strings and links selected outcome', async () => {
  const { client } = txMock(v => {
    v.transaction_outcome.block_hash = HASH2;
    return v;
  }, { block: req => req.params.finality ? block : { header: { hash: HASH2, height: 122, timestamp_nanosec: '1793520000000000000' } } });
  const result = await client.observeTransaction(ref);
  assert.equal(result.error, null);
  assert.deepEqual(result.observation.data.blocks.map(block => block.height), ['122', '123']);
});
