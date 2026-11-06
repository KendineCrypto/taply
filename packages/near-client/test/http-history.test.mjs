import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mock, HASH, rpcError } from './helpers.mjs';

const ref = { transactionHash: HASH, signerAccountId: 'alice.testnet' };
const envelope = (request, name) => ({ jsonrpc: '2.0', id: request.id, error: rpcError(name).rpcError });

for (const status of [400, 404, 408, 422, 500]) {
  for (const [name, code, retry] of [
    ['UNKNOWN_BLOCK', 'BLOCK_UNAVAILABLE', 'NONE'],
    ['GARBAGE_COLLECTED_BLOCK', 'BLOCK_UNAVAILABLE', 'NONE'],
    ['UNKNOWN_CHUNK', 'BLOCK_UNAVAILABLE', 'NONE'],
    ['UNKNOWN_TRANSACTION', 'TRANSACTION_UNKNOWN', 'WAIT_AND_RECONCILE'],
    ['TIMEOUT_ERROR', 'RPC_TIMEOUT', 'WAIT_AND_RECONCILE'],
  ]) test(`HTTP ${status} bounded ${name} is evidence absence, never paid`, async () => {
    const { client, calls } = mock({ tx_status: request => Response.json(envelope(request, name), { status }) });
    const result = await client.observeTransaction(ref);
    assert.equal(result.error.code, code);
    assert.equal(result.error.retry, retry);
    assert.equal(result.observation.data, null);
    assert.equal(result.observation.rpcAvailable, false);
    assert.equal(calls.filter(c => c.method.includes('tx_status')).length, 1);
    assert.doesNotMatch(JSON.stringify(result), /untrusted sensitive detail|FINAL_PAID|verified_final/);
  });
}

for (const status of [408, 422]) {
  for (const [label, mutate] of [
    ['wrong id', e => ({ ...e, id: 'replayed-id' })],
    ['wrong version', e => ({ ...e, jsonrpc: '1.0' })],
    ['result and error', e => ({ ...e, result: { final_execution_status: 'FINAL' } })],
    ['result alone', e => ({ jsonrpc: e.jsonrpc, id: e.id, result: {} })],
    ['invalid error code', e => ({ ...e, error: { ...e.error, code: 'secret' } })],
    ['method fallback', e => ({ ...e, error: { code: -32601, name: 'METHOD_NOT_FOUND' } })],
  ]) test(`HTTP ${status} refuses ${label} without historical inference`, async () => {
    const { client, calls } = mock({ tx_status: req => Response.json(mutate(envelope(req, 'UNKNOWN_BLOCK')), { status }) });
    const result = await client.observeTransaction(ref);
    assert.equal(result.error.code, status === 408 ? 'RPC_TIMEOUT' : 'RPC_HTTP_ERROR');
    assert.equal(result.observation.data, null);
    assert.equal(calls.length, 2);
  });
  test(`HTTP ${status} plain text is transport failure, not pruning`, async () => {
    const { client } = mock({ tx_status: () => new Response('UNKNOWN_BLOCK private prose', { status }) });
    const result = await client.observeTransaction(ref);
    assert.equal(result.error.code, status === 408 ? 'RPC_TIMEOUT' : 'RPC_HTTP_ERROR');
    assert.equal(result.observation.data, null);
  });
}

test('HTTP error bodies keep byte limits and timeout cancellation', async () => {
  const large = mock({ tx_status: () => new Response(' '.repeat(1025), { status: 422 }) }, { maxResponseBytes: 1024 });
  assert.equal((await large.client.observeTransaction(ref)).error.code, 'RPC_RESPONSE_TOO_LARGE');
  let cancelled = false;
  const stalled = mock({ tx_status: () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 408 }) }, { timeoutMs: 100 });
  assert.equal((await stalled.client.observeTransaction(ref)).error.code, 'RPC_TIMEOUT');
  assert.equal(cancelled, true);
});
