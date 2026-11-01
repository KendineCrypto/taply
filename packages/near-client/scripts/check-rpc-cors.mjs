// Chromium CORS diagnostics. Public Testnet reads only; no wallet interaction.
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { PROVIDERS } from './reproduce-instant-proof.mjs';
import { TESTNET_GENESIS_HASH } from '../dist/index.js';

if (!process.env.TAPLY_PLAYWRIGHT_MODULE || !process.argv[2]) throw Error('Set TAPLY_PLAYWRIGHT_MODULE and supply an output JSON path');
const { chromium, devices } = await import(pathToFileURL(process.env.TAPLY_PLAYWRIGHT_MODULE).href);
const server = createServer((_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.end('<!doctype html><title>Read-only RPC diagnostic</title>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const results = [];
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const [name, device] of [['desktop', {}], ['mobile-emulation', devices['Pixel 7']]]) {
    const context = await browser.newContext(device);
    const page = await context.newPage();
    await page.route('**/*', route => {
      const request = route.request();
      if (request.url().startsWith(origin)) return route.continue();
      if (!PROVIDERS.some(provider => new URL(request.url()).origin === provider.rpcUrl)) return route.abort();
      const method = request.postDataJSON()?.method;
      return ['status', 'block', 'query', 'EXPERIMENTAL_tx_status'].includes(method) ? route.continue() : route.abort();
    });
    await page.goto(origin);
    for (const provider of PROVIDERS) {
      const result = await page.evaluate(async ({ provider, genesis }) => {
        const calls = [];
        async function call(method, params) {
          const id = String(calls.length); const start = performance.now();
          const response = await fetch(provider.rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
          const envelope = await response.json();
          calls.push({ method, httpStatus: response.status, elapsedMs: Math.round(performance.now() - start) });
          if (!response.ok || envelope.error || envelope.id !== id) throw Error(envelope.error?.cause?.name ?? 'RPC_UNAVAILABLE');
          return envelope.result;
        }
        try {
          const status = await call('status', []);
          if (status.chain_id !== 'testnet' || status.genesis_hash !== genesis || status.sync_info.syncing) throw Error('NETWORK_MISMATCH');
          const block = await call('block', { finality: 'final' });
          const account = await call('query', { request_type: 'view_account', account_id: 'taply-pay-pilot-1.testnet', block_id: block.header.hash });
          if (account.block_hash !== block.header.hash || account.block_height !== block.header.height || account.code_hash !== 'BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B') throw Error('EVIDENCE_MISMATCH');
          const tx = await call('EXPERIMENTAL_tx_status', { tx_hash: 'CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su', sender_account_id: 'taply-pilot-funder-1101.testnet', wait_until: 'FINAL' });
          if (tx.final_execution_status !== 'FINAL' || !Array.isArray(tx.receipts)) throw Error('HISTORY_UNAVAILABLE');
          return { kind: 'passed', blockHash: block.header.hash, calls };
        } catch (error) { return { kind: 'unavailable', error: error.name + ': ' + error.message, calls }; }
      }, { provider, genesis: TESTNET_GENESIS_HASH });
      results.push({ ...provider, device: name, engine: browser.version(), ...result });
      console.log(`${name} ${provider.providerId}: ${result.kind}`);
    }
    await context.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
await writeFile(process.argv[2], JSON.stringify({ kind: 'LOCAL_ORIGIN_CHROMIUM_CORS_NOT_PHYSICAL_DEVICE_ACCEPTANCE', checkedAt: new Date().toISOString(), results }, null, 2));
if (results.some(result => result.kind !== 'passed')) process.exitCode = 1;
