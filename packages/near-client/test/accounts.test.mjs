import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { createChainObservationSchema } from '@taply/shared';
import { createNearTestnetClient, NearClientError } from '../dist/index.js';
import { account, block, config, HASH, HASH2, mock, rpcError, status } from './helpers.mjs';

test('final-block anchored account and native balances preserve exact strings; mocks cannot verify', async () => {
  const { client, calls } = mock();
  const read = await client.readAccount('alice.testnet');
  assert.equal(read.error, null);
  assert.deepEqual(read.observation.data, { accountId: 'alice.testnet', amountYoctoNear: account.amount,
    lockedYoctoNear: '0', storageUsageBytes: '182', codeHash: HASH });
  assert.equal(read.observation.source, 'mock');
  assert.equal(read.observation.assurance, 'unverified');
  assert.equal(read.observation.observedBlock, null);
  assert.equal(read.observation.rpcAvailable, false);
  assert.ok(createChainObservationSchema(z.unknown()).safeParse(read.observation).success);
  assert.deepEqual(calls.map(c => [c.method, c.params]), [
    ['status', []], ['block', { finality: 'final' }],
    ['query', { request_type: 'view_account', account_id: 'alice.testnet', block_id: HASH }],
  ]);
  const balance = await client.readNativeBalance('alice.testnet');
  assert.equal(balance.observation.data.assetId, 'near:native');
  assert.equal(balance.observation.data.amountYoctoNear, account.amount);
  assert.equal(Object.hasOwn(balance.observation.data, 'spendable'), false);
  assert.equal(calls.filter(c => c.method === 'status').length, 2);
});

test('network read reports identity and contract configuration stays explicit', async () => {
  const { client, calls } = mock();
  assert.equal((await client.checkNetwork()).observation.data.chainId, 'testnet');
  const count = calls.length;
  assert.equal((await client.checkContract()).error.code, 'CONTRACT_NOT_CONFIGURED');
  assert.equal(calls.length, count);
  const matching = mock({}, { contract: { accountId: 'payments.testnet', expectedCodeHash: HASH } });
  assert.equal((await matching.client.checkContract()).error, null);
  const mismatch = mock({}, { contract: { accountId: 'payments.testnet', expectedCodeHash: HASH2 } });
  const result = await mismatch.client.checkContract();
  assert.equal(result.error.code, 'CONTRACT_CODE_MISMATCH');
  assert.equal(result.observation.data, null);
});

for (const [label, change] of [
  ['mainnet', { chain_id: 'mainnet' }], ['wrong genesis', { genesis_hash: HASH }], ['syncing', { sync_info: { syncing: true } }],
]) test(`rejects ${label} before any account query`, async () => {
  const { client, calls } = mock({ status: () => ({ ...status, ...change }) });
  assert.equal((await client.readAccount('alice.testnet')).error.code, label === 'syncing' ? 'NODE_SYNCING' : 'NETWORK_MISMATCH');
  assert.equal(calls.length, 1);
});

for (const change of [{ block_hash: HASH2 }, { block_height: 124 }]) test(`rejects mismatched account provenance ${JSON.stringify(change)}`, async () => {
  const { client } = mock({ query: () => ({ ...account, ...change }) });
  assert.equal((await client.readAccount('alice.testnet')).error.code, 'EVIDENCE_MISMATCH');
});

test('large RPC integer tokens survive without JavaScript Number conversion', async () => {
  const { client } = mock({
    block: req => new Response(`{"jsonrpc":"2.0","id":"${req.id}","result":{"header":{"hash":"${HASH}","height":9007199254740993,"timestamp_nanosec":"1793520000000000001"}}}`),
    query: req => new Response(`{"jsonrpc":"2.0","id":"${req.id}","result":{"amount":"0","locked":"0","storage_usage":9007199254740993,"code_hash":"${HASH}","block_hash":"${HASH}","block_height":9007199254740993}}`),
  });
  const result = await client.readAccount('alice.testnet');
  assert.equal(result.error, null);
  assert.equal(result.observation.data.storageUsageBytes, '9007199254740993');
});

for (const accountId of ['A.testnet', 'a', 'alice..testnet', '', '<script>']) test(`invalid account ${accountId} does not access RPC`, async () => {
  const { client, calls } = mock();
  assert.equal((await client.readAccount(accountId)).error.code, 'INVALID_ARGUMENT');
  assert.equal(calls.length, 0);
});

for (const change of [
  { network: 'near-mainnet' }, { contract: undefined }, { rpcUrl: 'http://rpc.testnet.near.org' },
  { rpcUrl: 'https://secret@rpc.testnet.near.org' }, { rpcUrl: 'https://rpc.testnet.near.org?key=secret' },
  { rpcUrl: 'https://rpc.testnet.near.org#secret' }, { timeoutMs: 0 }, { maxResponseBytes: 1 },
  { contract: { accountId: 'x.testnet', expectedCodeHash: 'z'.repeat(44) } },
]) test(`invalid config fails synchronously: ${JSON.stringify(change)}`, () => {
  assert.throws(() => createNearTestnetClient({ ...config, ...change }), error => error instanceof NearClientError && error.code === 'INVALID_CONFIG');
});

test('unknown account is explicit; raw upstream errors are not exposed', async () => {
  const { client } = mock({ query: () => rpcError('UNKNOWN_ACCOUNT') });
  const result = await client.readAccount('missing.testnet');
  assert.equal(result.error.code, 'ACCOUNT_NOT_FOUND');
  assert.equal(result.observation.data, null);
  assert.equal(JSON.stringify(result).includes('sensitive'), false);
});

test('network identity is rechecked on subsequent reads; no stale cached success', async () => {
  let number = 0;
  const { client } = mock({ status: () => ++number === 1 ? status : { ...status, chain_id: 'mainnet' } });
  assert.equal((await client.readAccount('alice.testnet')).error, null);
  assert.equal((await client.readAccount('alice.testnet')).error.code, 'NETWORK_MISMATCH');
});

test('malformed block/account fields do not leak through', async () => {
  for (const invalid of [{ amount: 1 }, { amount: '-1' }, { amount: '01' }, { storage_usage: '123' }, { code_hash: 'z'.repeat(44) }]) {
    const { client } = mock({ query: () => ({ ...account, ...invalid }) });
    assert.equal((await client.readAccount('alice.testnet')).error.code, 'RPC_MALFORMED_RESPONSE');
  }
  const { client } = mock({ block: () => ({ header: { ...block.header, timestamp_nanosec: 1793520000000000000 } }) });
  assert.equal((await client.readAccount('alice.testnet')).error.code, 'RPC_MALFORMED_RESPONSE');
});
