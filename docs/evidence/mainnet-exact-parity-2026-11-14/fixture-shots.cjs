// Connected-state parity screenshots. SYNTHETIC RPC (labelled fixture data, nothing on chain), an
// injected read-only wallet whose signing always throws, and a LOCKED fixture vault record whose
// public key has no private key at all. Nothing is created, signed or sent.
// usage: node connected.cjs <name testnet|mainnet> <base> <prefix ''|/m> <outdir> [states,comma]
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const [name, base, prefix, out, fragDir] = process.argv.slice(2);
const fs = require('fs');
const net = name.startsWith('mainnet') ? 'mainnet' : 'testnet';
const ACCOUNT = net === 'mainnet' ? 'alice.near' : 'alice.testnet';
const TAPLY = net === 'mainnet' ? 'fixture-wallet.near' : 'fixture-wallet.testnet';
const HASH = '9vYr1bZp3c5o7P1QkNq3Y2mZ8r4tF6uW1xA5bC7dE9fG';
const GENESIS = net === 'mainnet' ? 'EPnLgE7iEq9s7yTkos96M3cWymH5avBAPm3qx3NXqR8H' : 'FWJ9kR6KFWoyMoNjpLXXGHeuiy7tEY6GmoFeCA5yuc6b';
const NOW_NS = String(BigInt(Date.now()) * 1000000n);
const bytes = (v) => Array.from(Buffer.from(JSON.stringify(v)));
function rpcResult(r) {
  const p = r.params ?? {};
  if (r.method === 'status') return { chain_id: net, genesis_hash: GENESIS, version: { version: '2.4.0' }, sync_info: { syncing: false, latest_block_height: 200000000, latest_block_hash: HASH, latest_block_time: new Date().toISOString() } };
  if (r.method === 'block') {
    if (p.block_id === 9820210) return { header: { hash: GENESIS, height: 9820210, timestamp_nanosec: '1595350551591948000' } };
    return { header: { hash: typeof p.block_id === 'string' ? p.block_id : HASH, height: 200000000, timestamp_nanosec: NOW_NS, prev_hash: HASH } };
  }
  if (r.method === 'gas_price') return { gas_price: '100000000' };
  if (r.method === 'EXPERIMENTAL_protocol_config') return { runtime_config: { storage_amount_per_byte: '10000000000000000000' } };
  if (p.request_type === 'view_access_key') return { nonce: 7, permission: 'FullAccess', block_hash: HASH, block_height: 200000000 };
  if (p.request_type === 'view_account') return { amount: '12345600000000000000000000', locked: '0', storage_usage: 500, code_hash: '11111111111111111111111111111111', block_hash: HASH, block_height: 200000000 };
  if (p.request_type === 'call_function') return { result: bytes(p.method_name === 'ft_balance_of' ? '42500000' : null), logs: [], block_hash: HASH, block_height: 200000000 };
  return null;
}
const inject = ({ account, net }) => {
  localStorage.setItem('selected-wallet', 'taply-qa-readonly');
  const never = async () => { throw new Error('QA harness never signs'); };
  const wallet = {
    manifest: { id: 'taply-qa-readonly', name: 'QA wallet (read-only)', features: { testnet: true, mainnet: true, signInWithoutAddKey: true, signAndSendTransaction: true } },
    signIn: async () => [{ accountId: account, publicKey: 'ed25519:8hSHprDq2StXwMtNd43wDTXQYsjXcD4MJTXQYsjXcc' }],
    signOut: async () => undefined,
    getAccounts: async () => [{ accountId: account, publicKey: 'ed25519:8hSHprDq2StXwMtNd43wDTXQYsjXcD4MJTXQYsjXcc' }],
    signAndSendTransaction: never, signAndSendTransactions: never, signMessage: never,
  };
  window.addEventListener('near-selector-ready', () => window.dispatchEvent(new CustomEvent('near-wallet-injected', { detail: wallet })));
};
// LOCKED fixture vault: public metadata only; the "ciphertext" is zeros and no private key exists for this public key.
const seedVault = ({ net, account }) => {
  const key = net === 'mainnet' ? 'taply.mainnet-vault.v1' : 'taply.testnet-vault.v1';
  localStorage.setItem(key, JSON.stringify({ version: 2, network: `near-${net}`, algorithm: 'Ed25519', publicKeyHex: 'f'.repeat(63) + 'e', accountId: account,
    kdf: 'PBKDF2-SHA256', iterations: 600000, cipher: 'AES-256-GCM', salt: '0'.repeat(32), iv: '0'.repeat(24), secret: "BIP39-12/SLIP10-m/44'/397'/0'", ciphertext: '0'.repeat(64) }));
  if (net === 'testnet') localStorage.setItem('taply.wallet-mode.v1', 'taply');
};

// Each fixture: [label, route]; the page shell (header, nav, CSS, fonts) comes from the running app,
// the <main> content is the fragment rendered by src/__visual__/parity-fixtures.test.tsx.
const FIX = [['31-wallet-unlocked', '/wallet'], ['32-send-review', '/send'], ['33-contacts-filled', '/contacts'], ['34-activity-filled', '/activity'],
  ['35-request-form', '/request/new'], ['36-gift-2-amount', '/gift/new'], ['37-gift-3-envelope', '/gift/new'], ['38-gift-4-review', '/gift/new']];
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'en-US' });
  await ctx.addCookies([{ name: 'taply_locale', value: 'en', url: base }]);
  await ctx.addInitScript(inject, { account: ACCOUNT, net });
  await ctx.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === base) return route.continue();
    if (/(near\.org|fastnear\.com)$/.test(url.host)) {
      const r = JSON.parse(route.request().postData() ?? '{}');
      const result = rpcResult(r);
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(result === null ? { jsonrpc: '2.0', id: r.id, error: { code: -32601, name: 'METHOD_NOT_FOUND', message: 'synthetic' } } : { jsonrpc: '2.0', id: r.id, result }) });
    }
    if (url.host === 'raw.githubusercontent.com') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ wallets: [], version: '1.0.0' }) });
    return route.abort();
  });
  const page = await ctx.newPage();
  for (const [label, path] of FIX) {
    const file = `${fragDir}/${label}-${net}.html`;
    if (!fs.existsSync(file)) { console.log('missing', file); continue; }
    const html = fs.readFileSync(file, 'utf8');
    await page.goto(base + prefix + path, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.evaluate((h) => { const m = document.querySelector('main#main > div'); if (m) { m.className = ''; m.innerHTML = h; } }, html);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${label}-${name}.png`, fullPage: true });
  }
  await browser.close();
})();
