// Public Testnet reads only. Uses the existing verifier without editing frontend.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { parseRpcJsonWithIntegers } from '../dist/index.js';

export const PROVIDERS = Object.freeze([
  { rpcUrl: 'https://rpc.testnet.near.org', providerId: 'near-public-testnet' },
  { rpcUrl: 'https://test.rpc.fastnear.com', providerId: 'fastnear-testnet' },
]);
const sourceRoot = new URL('../../../apps/web/src/lib/verify/', import.meta.url);
const sha256 = text => createHash('sha256').update(text).digest('hex');
const serialize = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2);

export async function loadIndependentVerifier() {
  const rpcSource = await readFile(new URL('rpc.ts', sourceRoot), 'utf8');
  const verifierSource = await readFile(new URL('instant-receipt.ts', sourceRoot), 'utf8');
  const compile = (source, aliases) => {
    let js = stripTypeScriptTypes(source, { mode: 'transform' });
    for (const [specifier, url] of Object.entries(aliases)) js = js.replaceAll(`from '${specifier}'`, `from '${url}'`).replaceAll(`from "${specifier}"`, `from '${url}'`);
    return `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
  };
  const aliases = Object.fromEntries(['zod', '@taply/near-client', '@taply/shared'].map(name => [name, import.meta.resolve(name)]));
  const rpcModule = compile(rpcSource, aliases);
  const verifierModule = compile(verifierSource, { ...aliases, '@/lib/protocol': aliases['@taply/shared'], './rpc': rpcModule });
  return {
    ...await import(rpcModule), ...await import(verifierModule),
    sourceSha256: { rpc: sha256(rpcSource), verifier: sha256(verifierSource) },
  };
}

export function recordingFetch(records, fetcher = globalThis.fetch) {
  return async (url, init) => {
    const request = JSON.parse(init.body);
    if (!['status', 'block', 'query', 'EXPERIMENTAL_tx_status'].includes(request.method)) throw new Error('Read-only methods required');
    const record = { request, startedAt: new Date().toISOString() };
    records.push(record);
    const start = performance.now();
    try {
      const response = await fetcher(url, init);
      record.httpStatus = response.status;
      record.corsAllowOrigin = response.headers.get('access-control-allow-origin');
      // Read under the verifier's AbortSignal; never retry or switch providers.
      record.raw = await response.text();
      return new Response(record.raw, { status: response.status, headers: response.headers });
    } catch (error) { record.error = error?.name ?? 'Error'; throw error; }
    finally { record.elapsedMs = Math.round(performance.now() - start); }
  };
}

async function main(out) {
  if (!out) throw new Error('Usage: node packages/near-client/scripts/reproduce-instant-proof.mjs <new-output-directory>');
  const output = resolve(out);
  await mkdir(output, { recursive: false });
  const saved = JSON.parse(await readFile(new URL('../../../docs/evidence/instant-pay-2026-11-01-receipt.json', import.meta.url), 'utf8'));
  const { createFetchVerifierRpc, verifyInstantReceipt, sourceSha256 } = await loadIndependentVerifier();
  const reports = [];
  for (const provider of PROVIDERS) {
    const records = [];
    const fetcher = recordingFetch(records);
    const rpc = createFetchVerifierRpc({ ...provider, fetcher });
    const result = await verifyInstantReceipt({ rpc, contractId: saved.contractId, approvedCodeHash: saved.contractCodeHash,
      requestId: saved.requestId, fundingTransaction: saved.fundingTransaction, retryTransactions: [] });
    // Separate current-state diagnostic even if historical verification failed.
    // It cannot promote a failed proof to verified.
    const currentRecords = [];
    const diagnostic = createFetchVerifierRpc({ ...provider, fetcher: recordingFetch(currentRecords) });
    let current;
    try {
      const status = await diagnostic.call('status', []);
      const { TESTNET_GENESIS_HASH } = await import('../dist/index.js');
      if (status.chain_id !== 'testnet' || status.genesis_hash !== TESTNET_GENESIS_HASH || status.sync_info.syncing) throw new Error('NETWORK_MISMATCH');
      const block = await diagnostic.call('block', { finality: 'final' });
      const params = { account_id: saved.contractId, block_id: block.header.hash };
      const account = await diagnostic.call('query', { ...params, request_type: 'view_account' });
      const request = await diagnostic.call('query', { ...params, request_type: 'call_function', method_name: 'get_request', args_base64: Buffer.from(JSON.stringify({ id: saved.requestId })).toString('base64') });
      if ([account, request].some(value => value.block_hash !== block.header.hash || BigInt(value.block_height) !== BigInt(block.header.height))) throw new Error('EVIDENCE_MISMATCH');
      const decoded = JSON.parse(Buffer.from(request.result).toString('utf8'));
      current = { blockHash: block.header.hash, height: String(block.header.height), codeHash: account.code_hash,
        requestStatus: decoded.status, amountBaseUnits: decoded.terms.amountBaseUnits, evidenceKind: 'CURRENT_STATE_NOT_PAYOUT_PROOF' };
    } catch (error) { current = { error: error.code ?? error.message }; }
    const report = { ...provider, checkedAt: new Date().toISOString(), sourceSha256, result, current,
      calls: records.length, elapsedMs: records.reduce((sum, item) => sum + item.elapsedMs, 0) };
    await writeFile(resolve(output, `${provider.providerId}.json`), serialize({ ...report, records, currentRecords }), { flag: 'wx' });
    reports.push(report);
    console.log(`${provider.providerId}: ${result.kind}${result.reason ? ` (${result.reason})` : ''}; ${records.length} reads`);
  }
  const summary = { checkedAt: new Date().toISOString(), requestId: saved.requestId, fundingTransaction: saved.fundingTransaction,
    crossProviderVerified: reports.every(report => report.result.kind === 'verified'), reports };
  await writeFile(resolve(output, 'summary.json'), serialize(summary), { flag: 'wx' });
  // Ensure preserved bytes remain parseable without rounding legacy timestamps.
  for (const provider of PROVIDERS) {
    const report = JSON.parse(await readFile(resolve(output, `${provider.providerId}.json`), 'utf8'));
    for (const record of [...report.records, ...report.currentRecords]) if (record.httpStatus === 200) parseRpcJsonWithIntegers(record.raw);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
}
