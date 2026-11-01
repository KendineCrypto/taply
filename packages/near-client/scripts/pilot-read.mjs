#!/usr/bin/env node
// Read-only pilot evidence. No signing, broadcast, key access or transfer retries.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { AccountIdSchema, ContractRequestSchema } from '../../shared/dist/index.js';
import { TESTNET_GENESIS_HASH, parseRpcJsonWithIntegers } from '../dist/index.js';

const CODE_HASH = 'BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B';
const METHODS = new Set(['status', 'block', 'query', 'EXPERIMENTAL_tx_status']);
const VIEWS = new Set(['get_config', 'get_request', 'get_receipt', 'get_accounting']);
const HASH = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function evidenceRpc(url, fetcher = globalThis.fetch) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash)
    throw new Error('Use a public HTTPS Testnet RPC URL without credentials or query parameters');
  let sequence = 0;
  const records = [];
  return {
    records,
    async call(method, params) {
      if (!METHODS.has(method)) throw new Error('Non-read RPC method refused');
      if (method === 'query' && !(params.request_type === 'view_account' ||
        params.request_type === 'view_access_key_list' ||
        (params.request_type === 'call_function' && VIEWS.has(params.method_name))))
        throw new Error('Non-read query refused');
      const request = { jsonrpc: '2.0', id: `pilot-${++sequence}`, method, params };
      const response = await fetcher(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request), cache: 'no-store', credentials: 'omit', redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`RPC HTTP ${response.status}; no transaction was submitted`);
      const raw = await response.text();
      if (Buffer.byteLength(raw) > 4 * 1024 * 1024) throw new Error('RPC response too large');
      records.push({ request, raw });
      const body = parseRpcJsonWithIntegers(raw);
      if (body?.jsonrpc !== '2.0' || body.id !== request.id ||
        Object.hasOwn(body, 'error') === Object.hasOwn(body, 'result')) throw new Error('Malformed RPC envelope');
      if (Object.hasOwn(body, 'error')) throw new Error(`RPC error: ${body.error?.cause?.name ?? body.error?.name ?? 'unknown'}`);
      if (method === 'query' && body.result?.block_hash !== params.block_id) throw new Error('Unanchored query');
      return body.result;
    },
  };
}

export async function collectSnapshot(rpc, { contract, request, tx, signer }) {
  if (!AccountIdSchema.safeParse(contract).success || !contract.endsWith('.testnet')) throw new Error('Named .testnet contract required');
  if (!/^[a-f0-9]{64}$/.test(request)) throw new Error('Canonical request ID required');
  if ((tx === undefined) !== (signer === undefined) ||
    (tx !== undefined && (!HASH.test(tx) || !AccountIdSchema.safeParse(signer).success))) throw new Error('Supply a valid --tx and --signer together');
  const status = await rpc.call('status', []);
  if (status.chain_id !== 'testnet' || status.genesis_hash !== TESTNET_GENESIS_HASH || status.sync_info?.syncing !== false)
    throw new Error('RPC is not a synced NEAR Testnet node');
  let transaction = null;
  if (tx !== undefined) {
    transaction = await rpc.call('EXPERIMENTAL_tx_status', { tx_hash: tx, sender_account_id: signer, wait_until: 'FINAL' });
    if (transaction.final_execution_status !== 'FINAL' || transaction.transaction?.hash !== tx ||
      transaction.transaction?.signer_id !== signer || transaction.transaction?.receiver_id !== contract)
      throw new Error('Transaction is not FINAL or does not match the supplied references');
  }
  // State tip is fetched AFTER the FINAL transaction read.
  const block = await rpc.call('block', { finality: 'final' });
  const blockId = block.header.hash;
  const account = await rpc.call('query', { request_type: 'view_account', account_id: contract, block_id: blockId });
  if (account.code_hash !== CODE_HASH) throw new Error('Contract code differs from the approved pin');
  const views = {};
  for (const method of VIEWS) {
    const args = method === 'get_request' || method === 'get_receipt' ? { id: request } : {};
    const result = await rpc.call('query', {
      request_type: 'call_function', account_id: contract, method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString('base64'), block_id: blockId,
    });
    views[method] = JSON.parse(Buffer.from(result.result).toString('utf8'));
  }
  const intent = ContractRequestSchema.parse(views.get_request);
  if (intent.terms.id !== request || intent.terms.contractId !== contract) throw new Error('Request identity mismatch');
  const keys = await rpc.call('query', { request_type: 'view_access_key_list', account_id: contract, block_id: blockId });
  const recipient = await rpc.call('query', { request_type: 'view_account', account_id: intent.recipientAccountId, block_id: blockId });
  return {
    kind: 'READ_ONLY_SNAPSHOT_NOT_A_VERIFIED_RECEIPT', checkedAt: new Date().toISOString(),
    contract, request, tx: tx ?? null, signer: signer ?? null,
    block: { hash: blockId, height: String(block.header.height), timestampNs: block.header.timestamp_nanosec },
    codeHash: account.code_hash, recipient: intent.recipientAccountId, recipientAmountYocto: recipient.amount,
    requestStatus: intent.status, views, keys,
    transactionStatus: transaction?.status ?? null,
  };
}

async function main(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: Object.fromEntries(
    ['rpc', 'contract', 'request', 'tx', 'signer', 'out'].map((name) => [name, { type: 'string' }]),
  ) });
  if (positionals[0] === 'browser') {
    const html = await readFile(new URL('./rpc-browser-check.html', import.meta.url));
    createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); })
      .listen(4179, '127.0.0.1', () => console.log('Open http://127.0.0.1:4179 — read-only browser CORS checks. Ctrl+C stops the server.'));
    return;
  }
  if (positionals[0] !== 'snapshot' || !values.contract || !values.request || !values.out)
    throw new Error('Usage: pilot-read.mjs browser | snapshot --contract <id.testnet> --request <id> [--tx <hash> --signer <payer>] --out <new-directory> [--rpc <https-url>]');
  const rpc = evidenceRpc(values.rpc ?? 'https://rpc.testnet.near.org');
  const snapshot = await collectSnapshot(rpc, values);
  const out = resolve(values.out);
  // A new directory per observation; never overwrite previous evidence.
  await mkdir(out, { recursive: false });
  for (const [index, record] of rpc.records.entries()) {
    await writeFile(resolve(out, `${index + 1}-${record.request.method}.json`), record.raw, { flag: 'wx' });
  }
  await writeFile(resolve(out, 'requests.json'), JSON.stringify(rpc.records.map((r) => r.request), null, 2), { flag: 'wx' });
  await writeFile(resolve(out, 'snapshot.json'), JSON.stringify({ ...snapshot, rpcUrl: values.rpc ?? 'https://rpc.testnet.near.org' }, null, 2), { flag: 'wx' });
  console.log(`Saved raw RPC evidence to ${out}. This snapshot is not a VerifiedReceipt; verify the receipt graph in Taply.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
