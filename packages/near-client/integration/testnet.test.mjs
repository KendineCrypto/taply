import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNearTestnetClient } from '../dist/index.js';

// Opt-in, public read-only integration. No fixture fallback or skipped failures.
const near = createNearTestnetClient({
  network: 'near-testnet', rpcUrl: 'https://rpc.testnet.near.org', rpcProviderId: 'near-public-testnet', contract: null,
});

test('LIVE TESTNET: finalized root account and native balance', async t => {
  const result = await near.readAccount('testnet');
  assert.equal(result.error, null, JSON.stringify(result.error));
  assert.equal(result.observation.source, 'rpc');
  assert.equal(result.observation.assurance, 'verified_final');
  assert.equal(result.observation.rpcAvailable, true);
  assert.equal(result.observation.data.accountId, 'testnet');
  assert.match(result.observation.data.amountYoctoNear, /^(0|[1-9][0-9]*)$/);
  t.diagnostic(JSON.stringify(result.observation));
});

const transactionHash = process.env.TAPLY_TESTNET_TRANSACTION_HASH;
const signerAccountId = process.env.TAPLY_TESTNET_SIGNER_ACCOUNT_ID;
const receiptId = process.env.TAPLY_TESTNET_RECEIPT_ID;
if (transactionHash || signerAccountId || receiptId) {
  if (!transactionHash || !signerAccountId || !receiptId)
    throw new Error('Supply all three TAPLY_TESTNET_TRANSACTION_HASH / SIGNER_ACCOUNT_ID / RECEIPT_ID values');
  test('LIVE TESTNET: existing transaction and all finalized outcomes', async t => {
    const result = await near.observeTransaction({ transactionHash, signerAccountId });
    assert.equal(result.error, null, JSON.stringify(result.error));
    assert.equal(result.observation.source, 'rpc');
    assert.equal(result.observation.assurance, 'verified_final');
    assert.equal(result.observation.data.executionFinality, 'FINAL');
    assert.equal(result.observation.data.outcomeGraphComplete, true);
    assert.equal(result.observation.data.transactionHash, transactionHash);
    assert.equal(Object.hasOwn(result.observation.data, 'paymentState'), false);
    t.diagnostic(JSON.stringify({ transactionHash, checkedAt: result.observation.checkedAt,
      observedBlock: result.observation.observedBlock, outcomes: result.observation.data.receiptOutcomes.length,
      blocks: result.observation.data.blocks }));
  });
  test('LIVE TESTNET: transaction-bound finalized receipt outcome', async t => {
    const result = await near.observeReceipt({ transactionHash, signerAccountId, receiptId });
    assert.equal(result.error, null, JSON.stringify(result.error));
    assert.equal(result.observation.assurance, 'verified_final');
    assert.equal(result.observation.data.outcome.id, receiptId);
    assert.notEqual(result.observation.data.block, null);
    t.diagnostic(JSON.stringify({ transactionHash, receiptId, executor: result.observation.data.outcome.executorAccountId,
      block: result.observation.data.block, checkedAt: result.observation.checkedAt }));
  });
}
