// Synthetic fixed-latency transport, no HTTP, keys or blockchain operations.
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import { baseEncode } from 'near-api-js';
import { createWalletChain } from '../dist/wallet-chain.js';
import { readTransaction } from '../dist/transactions.js';
import { createRpc, parseConfig, TESTNET_GENESIS_HASH } from '../dist/rpc.js';
import { stringify } from 'lossless-json';

const baseline = process.argv[2] ?? 'f69a8e5';
const latencyMs = 20;
async function original(file) {
  const source = execFileSync('git', ['-c', `safe.directory=${process.cwd().replaceAll('\\', '/')}`, 'show', `${baseline}:packages/near-client/src/${file}.ts`], { encoding: 'utf8' });
  const js = stripTypeScriptTypes(source, { mode: 'transform' }).replace(/from "(\.[^"]+)"/g, (_, specifier) => `from "${new URL(specifier, new URL('../dist/', import.meta.url)).href}"`)
    .replace(/from "(@taply\/shared|zod)"/g, (_, specifier) => `from "${import.meta.resolve(specifier)}"`);
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const hash = n => baseEncode(Uint8Array.from({ length: 32 }, (_, i) => i === 31 ? n : 0));
const config = { network: 'near-testnet', rpcUrl: 'https://synthetic.invalid', rpcProviderId: 'synthetic', contract: null };
const account = { amount: '10000000000000000000000000', locked: '0', storage_usage: 182, code_hash: hash(1), block_hash: hash(1), block_height: 100 };
const block = (n, height) => ({ header: { hash: hash(n), height, timestamp_nanosec: String(height) } });
const outcome = (id, n, children = [], root = false) => ({ id, block_hash: hash(n), outcome: {
  executor_id: root ? 'sender.testnet' : 'receiver.testnet', receipt_ids: children,
  status: root ? { SuccessReceiptId: children[0] } : { SuccessValue: '' }, logs: [], gas_burnt: 1, tokens_burnt: '0',
} });
const receiptIds = Array.from({ length: 7 }, (_, i) => hash(i + 40));
function transport() {
  let calls = 0;
  const fetcher = async (_url, init) => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, latencyMs));
    const request = JSON.parse(init.body); const { method, params } = request;
    let result;
    if (method === 'status') result = { chain_id: 'testnet', genesis_hash: TESTNET_GENESIS_HASH, version: { version: 'synthetic' }, sync_info: { syncing: false } };
    else if (method === 'block') result = params.finality ? block(1, 100) : block(Array.from({ length: 8 }, (_, i) => i + 2).find(n => hash(n) === params.block_id), 50 + Array.from({ length: 8 }, (_, i) => hash(i + 2)).indexOf(params.block_id));
    else if (method === 'gas_price') result = { gas_price: '100000000' };
    else if (method === 'EXPERIMENTAL_protocol_config') result = { runtime_config: { storage_amount_per_byte: '10000000000000000000' } };
    else if (method === 'tx_status') result = { final_execution_status: 'FINAL', status: { SuccessValue: '' }, transaction: { hash: hash(20), signer_id: 'sender.testnet', receiver_id: 'receiver.testnet' },
      transaction_outcome: outcome(hash(20), 2, receiptIds, true), receipts_outcome: receiptIds.map((id, i) => outcome(id, i + 3)) };
    else if (method === 'query') result = params.request_type === 'view_account' ? account : { nonce: 1, permission: 'FullAccess', block_hash: hash(1), block_height: 100 };
    else throw Error('Unexpected synthetic method');
    return new Response(stringify({ jsonrpc: '2.0', id: request.id, result }));
  };
  return { fetcher, count: () => calls };
}
async function measure(task) {
  const samples = [];
  for (let i = 0; i < 5; i++) { const start = performance.now(); await task(); samples.push(Math.round(performance.now() - start)); }
  return samples.sort((a, b) => a - b)[2];
}
const oldChain = (await original('wallet-chain')).createWalletChain;
const oldTransaction = (await original('transactions')).readTransaction;
const result = { kind: 'SYNTHETIC_LATENCY_NOT_LIVE_SPEED', baseline, latencyMs, samplesPerCase: 5, measurements: {} };
for (const [name, before, after] of [['walletSnapshot', oldChain, createWalletChain], ['eightReceiptBlocks', oldTransaction, readTransaction]]) {
  const measurements = {};
  for (const [label, implementation] of [['before', before], ['after', after]]) {
    const t = transport();
    const task = name === 'walletSnapshot' ? () => implementation(config, t.fetcher).snapshot('sender.testnet', 'ed25519:' + hash(1))
      : () => implementation(createRpc(parseConfig(config), t.fetcher), { transactionHash: hash(20), signerAccountId: 'sender.testnet' });
    measurements[`${label}MedianMs`] = await measure(task);
    measurements[`${label}CallsPerSample`] = t.count() / 5;
  }
  result.measurements[name] = measurements;
}
console.log(JSON.stringify(result, null, 2));
