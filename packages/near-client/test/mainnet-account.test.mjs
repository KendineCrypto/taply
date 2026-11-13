import test from 'node:test';
import assert from 'node:assert/strict';
import { createMainnetAccountReader, createMainnetReader, MAINNET_GENESIS_HASH } from '../dist/index.js';
const hash = '11111111111111111111111111111112';
const profile = { network: 'near-mainnet', rpcUrl: 'https://rpc.mainnet.fastnear.com', rpcProviderId: 'fixture' };
function mock(change = {}) {
  const calls = [];
  return { calls, fetch: async (_, init) => {
    const r = JSON.parse(init.body); calls.push(r);
    let result;
    if (r.method === 'status') result = { chain_id: change.chain ?? 'mainnet', sync_info: { syncing: false } };
    else if (r.method === 'block') {
      if (r.params.block_id !== undefined) assert.equal(r.params.block_id, 9820210);
      result = { header: { hash: r.params.block_id === 9820210 ? change.genesis ?? MAINNET_GENESIS_HASH : hash, timestamp_nanosec: '1000000000' } };
    }
    else if (r.params.request_type === 'view_account') result = { amount: '1234567890123456789012345', locked: '0', storage_usage: 1000, code_hash: hash, block_hash: change.block ?? hash, block_height: 100 };
    else result = { result: [...new TextEncoder().encode(JSON.stringify(change.usdc ?? '1234567'))], logs: [], block_hash: change.block ?? hash, block_height: 100 };
    return Response.json({ jsonrpc: '2.0', id: r.id, result });
  } };
}
test('account reads verify genesis and bind both assets to the same final block without a Taply deployment', async () => {
  const m = mock(); const value = await createMainnetAccountReader(profile, m.fetch).readBalances('alice.near');
  assert.equal(value.native, '1234567890123456789012345'); assert.equal(value.usdc, '1234567');
  assert.equal(value.finality, 'final'); assert.equal(value.accountId, 'alice.near');
  const queries = m.calls.filter(c => c.method === 'query'); assert.equal(queries.length, 2);
  assert.ok(queries.every(c => c.params.block_id === hash));
});
test('wrong network/genesis and malformed token result never become zero balances', async () => {
  for (const change of [{ chain: 'testnet' }, { genesis: hash }, { usdc: '-1' }, { usdc: 123 }, { block: MAINNET_GENESIS_HASH }]) {
    const m = mock(change); await assert.rejects(createMainnetAccountReader(profile, m.fetch).readBalances('alice.near'));
  }
});
test('contract reader decodes lossless RPC bytes and refuses an unanchored result', async () => {
  const p = { ...profile, contract: { accountId: 'devkendinecrypto.near', expectedCodeHash: hash } };
  const good = mock(); const value = await createMainnetReader(p, good.fetch).readUsdcBalance('alice.near');
  assert.equal(value.data, '1234567'); assert.equal(value.blockHash, hash);
  const wrong = mock({ block: MAINNET_GENESIS_HASH });
  await assert.rejects(createMainnetReader(p, wrong.fetch).readUsdcBalance('alice.near'), e => e.code === 'EVIDENCE_MISMATCH');
});
test('Testnet account and RPC configuration are refused before network calls', async () => {
  const m = mock(); await assert.rejects(createMainnetAccountReader(profile, m.fetch).readBalances('alice.testnet'));
  assert.equal(m.calls.length, 0); assert.throws(() => createMainnetAccountReader({ ...profile, rpcUrl: 'https://rpc.testnet.near.org' }, m.fetch));
});
