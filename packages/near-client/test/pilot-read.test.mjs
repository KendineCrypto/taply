import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { calculateRequestId, calculateTermsHash } from '../../shared/dist/index.js';
import { TESTNET_GENESIS_HASH } from '../dist/index.js';
import { evidenceRpc, collectSnapshot } from '../scripts/pilot-read.mjs';

const contract = 'pilot.testnet';
const hash = '11111111111111111111111111111111';
const codeHash = 'BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B';
function fixture(overrides = {}) {
  const request = JSON.parse(readFileSync(new URL('./fixtures/request-open.json', import.meta.url), 'utf8'));
  request.terms.contractId = contract;
  request.terms.creatorAccountId = request.recipientAccountId = 'recipient.testnet';
  const { contractId, creationNonce, creatorAccountId, network } = request.terms;
  request.terms.id = calculateRequestId({ contractId, creationNonce, creatorAccountId, network });
  request.termsHash = calculateTermsHash(request.terms);
  const calls = [];
  const fetcher = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    let result;
    if (body.method === 'status') result = overrides.status ?? {
      chain_id: 'testnet', genesis_hash: TESTNET_GENESIS_HASH, sync_info: { syncing: false },
    };
    else if (body.method === 'block') result = { header: { hash, height: 1, timestamp_nanosec: '1793535606670615924' } };
    else if (body.method === 'EXPERIMENTAL_tx_status') result = overrides.tx ?? {
      final_execution_status: 'FINAL', transaction: { hash, signer_id: 'payer.testnet', receiver_id: contract }, status: { SuccessValue: 'dHJ1ZQ==' },
    };
    else if (body.params.request_type === 'call_function') {
      const view = body.params.method_name === 'get_request' ? request : null;
      result = { block_hash: hash, result: [...Buffer.from(JSON.stringify(view))] };
    } else result = { block_hash: overrides.blockHash ?? hash, code_hash: overrides.codeHash ?? codeHash, amount: '100000000000000000000000', keys: [] };
    return Response.json({ jsonrpc: '2.0', id: body.id, result });
  };
  return { rpc: evidenceRpc('https://rpc.testnet.near.org', fetcher), calls, args: { contract, request: request.terms.id } };
}

test('snapshot records anchored raw reads and never labels them a VerifiedReceipt', async () => {
  const { rpc, calls, args } = fixture();
  const result = await collectSnapshot(rpc, args);
  assert.equal(result.kind, 'READ_ONLY_SNAPSHOT_NOT_A_VERIFIED_RECEIPT');
  assert.equal(result.requestStatus, 'OPEN');
  assert.equal(rpc.records.length, calls.length);
  assert.deepEqual([...new Set(calls.map(c => c.method))].sort(), ['block', 'query', 'status']);
});

test('snapshot reads FINAL tx before state and refuses wrong references', async () => {
  const { rpc, calls, args } = fixture();
  await collectSnapshot(rpc, { ...args, tx: hash, signer: 'payer.testnet' });
  assert.equal(calls[1].method, 'EXPERIMENTAL_tx_status');
  assert.equal(calls[1].params.wait_until, 'FINAL');
  assert.equal(calls[2].method, 'block');
  const wrong = fixture({ tx: { final_execution_status: 'INCLUDED' } });
  await assert.rejects(collectSnapshot(wrong.rpc, { ...wrong.args, tx: hash, signer: 'payer.testnet' }), /not FINAL/);
});

for (const [overrides, message] of [
  [{ status: { chain_id: 'mainnet' } }, /not a synced NEAR Testnet/],
  [{ codeHash: hash }, /approved pin/],
  [{ blockHash: codeHash }, /Unanchored/],
]) test(`snapshot fails closed: ${message}`, async () => {
  const { rpc, args } = fixture(overrides);
  await assert.rejects(collectSnapshot(rpc, args), message);
});

test('evidence transport refuses signing and mutable view calls without fetching', async () => {
  const { rpc, calls } = fixture();
  for (const method of ['send_tx', 'broadcast_tx_commit']) await assert.rejects(rpc.call(method, {}), /Non-read/);
  await assert.rejects(rpc.call('query', { request_type: 'call_function', method_name: 'pay_instant_native' }), /Non-read/);
  assert.equal(calls.length, 0);
});

test('snapshot invalid arguments and missing signer cause no network calls', async () => {
  const { rpc, calls, args } = fixture();
  await assert.rejects(collectSnapshot(rpc, { ...args, tx: hash }), /--tx and --signer/);
  await assert.rejects(collectSnapshot(rpc, { ...args, contract: 'pilot.near' }), /.testnet/);
  assert.equal(calls.length, 0);
});
