import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stringify } from 'lossless-json';
import { createWalletChain } from '../dist/wallet-chain.js';
import { WalletAttemptJournal } from '../dist/wallet-journal.js';
import { config, status, block, account, rpcError, HASH, HASH2 } from './helpers.mjs';

const publicKey = 'ed25519:' + HASH;
function chain(overrides = {}) {
  const calls = [];
  const fetcher = async (_url, init) => {
    const req = JSON.parse(init.body); calls.push(req);
    let result;
    if (req.method === 'status') result = overrides.status ?? status;
    else if (req.method === 'block') result = block;
    else if (req.method === 'gas_price') result = { gas_price: '100000000' };
    else if (req.method === 'EXPERIMENTAL_protocol_config') result = { runtime_config: { storage_amount_per_byte: '10000000000000000000' } };
    else if (req.params.request_type === 'view_access_key') result = { nonce: 123, permission: overrides.permission ?? 'FullAccess', block_hash: HASH, block_height: 123 };
    else if (overrides.missing) return Response.json({ jsonrpc: '2.0', id: req.id, error: rpcError('UNKNOWN_ACCOUNT').rpcError });
    else result = { ...account, block_hash: overrides.blockHash ?? HASH };
    return new Response(stringify({ jsonrpc: '2.0', id: req.id, result }));
  };
  return { api: createWalletChain(config, fetcher), calls };
}
test('wallet snapshot checks Testnet, full access, final anchored balances, storage and gas', async () => {
  const { api, calls } = chain();
  const result = await api.snapshot('sender.testnet', publicKey);
  assert.equal(result.amountYocto, account.amount);
  assert.equal(result.storageUsageBytes, '182');
  assert.equal(result.nonce, '123');
  assert.equal(result.storageByteCostYocto, '10000000000000000000');
  assert.equal(calls[1].params.finality, 'final');
  assert.equal(calls.some(c => c.method.includes('send')), false);
});
test('missing wallet account is LOCAL_ONLY, not a fabricated zero balance', async () => {
  const { api } = chain({ missing: true });
  assert.equal(await api.snapshot('sender.testnet', publicKey), null);
});
test('wrong chain, unanchored state and function-call access key fail closed', async () => {
  for (const overrides of [{ status: { ...status, chain_id: 'mainnet' } }, { blockHash: HASH2 }, { permission: { FunctionCall: {} } }]) {
    const { api } = chain(overrides);
    await assert.rejects(api.snapshot('sender.testnet', publicKey));
  }
});
test('journal blocks unknown spends across reloads and refuses resetting or replacing their hash', () => {
  const values = new Map(); const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const journal = new WalletAttemptJournal(storage); const review = crypto.randomUUID();
  journal.begin('sender.testnet', review);
  assert.throws(() => new WalletAttemptJournal(storage).assertClear(), { code: 'OUTCOME_UNRESOLVED' });
  journal.update(review, 'SUBMITTED', HASH); journal.update(review, 'UNKNOWN');
  assert.throws(() => journal.update(review, 'NOT_SENT'), { code: 'OUTCOME_UNRESOLVED' });
  assert.throws(() => journal.update(review, 'FINAL_SUCCEEDED', HASH2), { code: 'OUTCOME_UNRESOLVED' });
  journal.update(review, 'FINAL_FAILED'); journal.assertClear();
});
test('unusable journal fails closed before a spend can be reserved', () => {
  const journal = new WalletAttemptJournal({ getItem: () => '{', setItem: () => {} });
  assert.throws(() => journal.assertClear(), { code: 'STORAGE_UNAVAILABLE' });
});
