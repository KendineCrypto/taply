import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stringify } from 'lossless-json';
import { createWalletChain } from '../dist/wallet-chain.js';
import { createReviewedWalletBackend } from '../dist/wallet-backend.js';
import { signerFixture } from './wallet-signer-fixture.mjs';
import { config, status, block, account, HASH, HASH2, mock } from './helpers.mjs';
import { recordingFetch, loadIndependentVerifier } from '../scripts/reproduce-instant-proof.mjs';
import { readFile } from 'node:fs/promises';

test('independent wallet reads overlap, use one final block, and retain every validation', async () => {
  for (const bad of [null, 'key', 'protocol', 'gas']) {
    const pending = []; const calls = [];
    const fetcher = async (_url, init) => {
      const req = JSON.parse(init.body); calls.push(req);
      let result;
      if (req.method === 'status') result = status;
      else if (req.method === 'block') result = block;
      else if (req.params.request_type === 'view_account') result = account;
      else {
        // No read finishes until all three independent reads have started.
        await new Promise(resolve => { pending.push(resolve); if (pending.length === 3) pending.forEach(done => done()); });
        if (req.method === 'gas_price') { assert.deepEqual(req.params, [HASH]); result = { gas_price: bad === 'gas' ? '0.1' : '100000000' }; }
        else {
          assert.equal(req.params.block_id, HASH);
          result = req.method === 'EXPERIMENTAL_protocol_config'
            ? { runtime_config: { storage_amount_per_byte: bad === 'protocol' ? '-1' : '10000000000000000000' } }
            : { nonce: 123, permission: 'FullAccess', block_hash: bad === 'key' ? HASH2 : HASH, block_height: 123 };
        }
      }
      return new Response(stringify({ jsonrpc: '2.0', id: req.id, result }));
    };
    const snapshot = createWalletChain(config, fetcher).snapshot('sender.testnet', 'ed25519:' + HASH);
    if (bad) await assert.rejects(snapshot, { code: 'INVALID_SNAPSHOT' });
    else assert.equal((await snapshot).nonce, '123');
    assert.equal(calls.length, 6);
  }
});

test('receipt block fetches overlap, remain bounded, and reject conflicting provenance', async () => {
  const hash = n => '1'.repeat(31) + '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'[n];
  for (const conflict of [false, true]) {
    const receiptIds = Array.from({ length: 7 }, (_, i) => hash(i + 10));
    const blockHashes = Array.from({ length: 8 }, (_, i) => hash(i));
    const outcome = (id, block_hash, children = [], root = false) => ({ id, block_hash, outcome: { executor_id: root ? 'sender.testnet' : 'recipient.testnet',
      receipt_ids: children, status: root ? { SuccessReceiptId: receiptIds[0] } : { SuccessValue: '' }, logs: [], gas_burnt: 1, tokens_burnt: '0' } });
    let active = 0; let maximum = 0;
    const { client, calls } = mock({
      tx_status: () => ({ final_execution_status: 'FINAL', status: { SuccessValue: '' }, transaction: { hash: HASH, signer_id: 'sender.testnet', receiver_id: 'recipient.testnet' },
        transaction_outcome: outcome(HASH, blockHashes[0], receiptIds, true), receipts_outcome: receiptIds.map((id, i) => outcome(id, blockHashes[i + 1])) }),
      block: async req => {
        if (req.params.finality) return { header: { hash: hash(29), height: 200, timestamp_nanosec: '200' } };
        active++; maximum = Math.max(maximum, active);
        await new Promise(resolve => setTimeout(resolve, 5)); active--;
        const index = blockHashes.indexOf(req.params.block_id);
        return { header: { hash: req.params.block_id, height: conflict ? 201 : 100 + index, timestamp_nanosec: String(100 + index) } };
      },
    });
    const read = await client.observeTransaction({ transactionHash: HASH, signerAccountId: 'sender.testnet' });
    assert.equal(maximum, 4);
    assert.equal(calls.filter(call => call.method === 'block').length, 9);
    if (conflict) { assert.equal(read.error.code, 'EVIDENCE_MISMATCH'); assert.equal(read.observation.data, null); }
    else { assert.equal(read.error, null); assert.equal(read.observation.data.blocks.length, 8); }
  }
});

test('review rejects a conflicting finalized hash or regressing timestamp before signing', async () => {
  for (const change of [{ blockHash: HASH2 }, { blockTimestampNs: String(BigInt(Date.now()) * 1000000n - 1000000000n) }]) {
    const f = await signerFixture();
    let count = 0;
    const chain = { ...f.chain, snapshot: async (...args) => { const snapshot = await f.chain.snapshot(...args); return ++count === 1 ? snapshot : { ...snapshot, ...change }; } };
    const backend = createReviewedWalletBackend({ config: f.config, vault: f.vault, storage: f.storage, policy: f.policy, chain, reader: f.reader,
      fetcher: f.fetcher, crypto: f.guardedCrypto, now: () => f.state.now });
    const review = await backend.prepareTransfer('receiver.testnet', '0.1');
    await assert.rejects(backend.submit(review.id, async () => true), { code: 'REVIEW_EXPIRED' });
    assert.equal(f.state.sends, 0); assert.equal(f.state.signs, 0); f.vault.lock();
  }
});

test('separate backends sharing a serialized browser lock cannot double-send an unknown spend', async () => {
  const f = await signerFixture(); f.state.mode = 'http503';
  let tail = Promise.resolve();
  f.policy.withExclusiveLock = task => { const current = tail.then(task); tail = current.catch(() => {}); return current; };
  const first = f.makeBackend(); const second = f.makeBackend();
  const a = await first.prepareTransfer('receiver.testnet', '0.1'); const b = await second.prepareTransfer('receiver.testnet', '0.1');
  let confirmations = 0;
  const results = await Promise.allSettled([first.submit(a.id, async () => { confirmations++; return true; }), second.submit(b.id, async () => { confirmations++; return true; })]);
  assert.equal(results[0].value.kind, 'unknown'); assert.equal(results[1].reason.code, 'OUTCOME_UNRESOLVED');
  assert.equal(confirmations, 1); assert.equal(f.state.sends, 1); assert.equal(f.journal.read().phase, 'UNKNOWN'); f.vault.lock();
});

test('proof runner uses existing independent verifier and refuses a broadcast method', async () => {
  const records = []; let calls = 0;
  const fetcher = recordingFetch(records, async () => { calls++; return Response.json({}); });
  await assert.rejects(fetcher(config.rpcUrl, { body: JSON.stringify({ method: 'send_tx' }) }), /Read-only/);
  assert.equal(calls, 0); assert.equal(records.length, 0);
  const { verifyInstantReceipt, sourceSha256 } = await loadIndependentVerifier();
  assert.match(sourceSha256.verifier, /^[a-f0-9]{64}$/);
  const result = await verifyInstantReceipt({ rpc: { call() { throw Error('must not read invalid input'); } }, contractId: '', approvedCodeHash: '', requestId: '', fundingTransaction: { hash: '', signerAccountId: '' }, retryTransactions: [] });
  assert.equal(result.kind, 'not_verified'); assert.equal(result.reason, 'INPUT_INVALID');
});

test('both saved public-provider proofs replay independently; pruned history cannot verify', async () => {
  const { createFetchVerifierRpc, verifyInstantReceipt } = await loadIndependentVerifier();
  for (const providerId of ['near-public-testnet', 'fastnear-testnet']) {
    const saved = JSON.parse(await readFile(new URL(`../evidence/phase5b-2026-11-01/${providerId}.json`, import.meta.url), 'utf8'));
    for (const pruned of [false, true]) {
      let index = 0;
      const rpc = createFetchVerifierRpc({ providerId, rpcUrl: saved.rpcUrl, fetcher: async (url, init) => {
        assert.equal(url, saved.rpcUrl);
        const request = JSON.parse(init.body); const record = saved.records[index++];
        assert.deepEqual(request, record.request);
        if (pruned && request.method === 'block' && request.params.block_id) return Response.json({ jsonrpc: '2.0', id: request.id, error: { code: -32000, cause: { name: 'UNKNOWN_BLOCK' } } });
        return new Response(record.raw, { status: record.httpStatus });
      } });
      const receipt = saved.result.receipt;
      const result = await verifyInstantReceipt({ rpc, contractId: receipt.contractId, approvedCodeHash: receipt.contractCodeHash, requestId: receipt.requestId,
        fundingTransaction: receipt.fundingTransaction, retryTransactions: [], now: () => new Date(receipt.verification.checkedAt) });
      if (pruned) { assert.equal(result.kind, 'not_verified'); assert.equal(result.reason, 'HISTORY_UNAVAILABLE'); }
      else { assert.deepEqual(result, saved.result); assert.equal(index, saved.records.length); }
    }
  }
});
