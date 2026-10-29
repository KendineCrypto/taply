import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mock, rpcError } from './helpers.mjs';

for (const [name, body] of [
  ['invalid JSON', '{'], ['duplicate key', '{"jsonrpc":"2.0","jsonrpc":"2.0"}'],
  ['escaped duplicate', '{"id":"a","\\u0069d":"b"}'],
  ['comment', '{/* comment */}'], ['trailing comma', '{"id":"a",}'],
  ['unpaired surrogate', '{"id":"\\ud800"}'], ['wrong id', '{"jsonrpc":"2.0","id":"wrong","result":{}}'],
  ['no result', '{"jsonrpc":"2.0","id":"taply-read-1"}'],
  ['result and error', '{"jsonrpc":"2.0","id":"taply-read-1","result":{},"error":{}}'],
  ['wrong version', '{"jsonrpc":"1.0","id":"taply-read-1","result":{}}'],
  ['deep JSON', '['.repeat(49) + '0' + ']'.repeat(49)],
  ['UTF8 BOM', '\ufeff{}'],
]) test(`malformed RPC: ${name}`, async () => {
  const { client } = mock({ status: () => new Response(body) });
  assert.equal((await client.checkNetwork()).error.code, 'RPC_MALFORMED_RESPONSE');
});

test('invalid UTF8 is rejected', async () => {
  const { client } = mock({ status: () => new Response(new Uint8Array([0xc3, 0x28])) });
  assert.equal((await client.checkNetwork()).error.code, 'RPC_MALFORMED_RESPONSE');
});

for (const headers of [{}, { 'content-length': '1025' }]) test(`bounded streaming response ${JSON.stringify(headers)}`, async () => {
  const { client } = mock({ status: () => new Response(' '.repeat(1025), { headers }) }, { maxResponseBytes: 1024 });
  assert.equal((await client.checkNetwork()).error.code, 'RPC_RESPONSE_TOO_LARGE');
});

test('fetch rejection is an unavailable read, never an empty balance', async () => {
  const { client } = mock({ status: () => { throw new Error('private endpoint secret'); } });
  const result = await client.readNativeBalance('alice.testnet');
  assert.equal(result.error.code, 'RPC_UNAVAILABLE');
  assert.equal(result.observation.data, null);
  assert.equal(result.observation.rpcAvailable, false);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('timeout aborts and remains unknown; no retry loop', async () => {
  let signal;
  const { client, calls } = mock({ status: (_request, init) => { signal = init.signal; return new Promise(() => {}); } }, { timeoutMs: 100 });
  const result = await client.checkNetwork();
  assert.equal(result.error.code, 'RPC_TIMEOUT');
  assert.equal(result.error.retry, 'WAIT_AND_RECONCILE');
  assert.equal(signal.aborted, true);
  assert.equal(calls.length, 1);
});

test('timeout includes a stalled response body', async () => {
  let cancelled = false;
  const { client } = mock({ status: () => new Response(new ReadableStream({ start() {}, cancel() { cancelled = true; } })) }, { timeoutMs: 100 });
  assert.equal((await client.checkNetwork()).error.code, 'RPC_TIMEOUT');
  assert.equal(cancelled, true);
});

for (const [status, code] of [[429, 'RPC_RATE_LIMITED'], [503, 'RPC_HTTP_ERROR'], [401, 'RPC_HTTP_ERROR']]) test(`HTTP ${status}`, async () => {
  const { client, calls } = mock({ status: () => new Response('sensitive body', { status }) });
  const result = await client.checkNetwork();
  assert.equal(result.error.code, code);
  assert.equal(result.observation.data, null);
  assert.equal(calls.length, 1);
});

for (const [name, code] of [['TIMEOUT_ERROR', 'RPC_TIMEOUT'], ['DOES_NOT_TRACK_SHARD', 'SHARD_UNAVAILABLE'], ['SOMETHING_NEW', 'RPC_ERROR'], ['__proto__', 'RPC_ERROR'], ['toString', 'RPC_ERROR'], ['constructor', 'RPC_ERROR']]) test(`structured RPC error ${name}`, async () => {
  const { client } = mock({ status: () => rpcError(name) });
  assert.equal((await client.checkNetwork()).error.code, code);
});

test('spoofed lossless number cannot pass schema checks', async () => {
  const { client } = mock({ status: () => ({ rpcError: { code: { isLosslessNumber: true, value: '-32601' } } }) });
  assert.equal((await client.checkNetwork()).error.code, 'RPC_MALFORMED_RESPONSE');
});
