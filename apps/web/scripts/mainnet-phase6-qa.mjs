// Real-browser QA of Mainnet phase 6: the app talking to Codex's AUTHENTICATED authority.
// Usage: node apps/web/scripts/mainnet-phase6-qa.mjs <playwright/index.mjs> <out-dir> <next-base> <redis-port>
//
// Needs a mainnet PREVIEW build with NEXT_PUBLIC_TAPLY_MAINNET_AUTHORITY=isolated-http (+ the synthetic Gift/
// escrow/USDC pins used by the other suites). The browser loads the app at the exact origin
// https://mainnet.taplyapp.xyz (Playwright routes it to the local Next server); /api/mainnet/authority/* goes to
// the TEST harness (Codex's createMainnetAuthorityHttp + createAuthenticatedMainnetAuthority +
// createFencedMainnetRedisPersistence on REAL Redis with an IN-MEMORY TEST WITNESS); Mainnet RPC is the
// harness's SYNTHETIC chain. Wallet signing stays gated (MAINNET_PROTOCOL_SIGNING_RELEASED=false), so every
// authority command is refused at the wallet: this suite proves the real browser↔server path up to that gate
// and that the app fails closed. Nothing touches Mainnet; nothing is signed or funded.
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const OUT = process.argv[3];
const NEXT = process.argv[4] ?? 'http://127.0.0.1:3120';
const REDIS_PORT = Number(process.argv[5] ?? 6390);
fs.mkdirSync(OUT, { recursive: true });
const { startAuthorityHarness, syntheticChain } = await import('./mainnet-authority-harness.mts');
const { MainnetGiftProfileSchema, MainnetEscrowProfileSchema } = await import('../../../packages/near-client/dist/index.js');
const { ed25519PublicKeyFromHex } = await import('../../../packages/near-client/dist/wallet-chain.js');

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: ok ? '' : String(detail).slice(0, 300) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' — ' + detail}`); };
const ORIGIN = 'https://mainnet.taplyapp.xyz';
const CH = 'GMjfNNjfTPXSmeRaxgN1oS9srsmBSdS46R6y2kPv6JQf';
const network = { network: 'near-mainnet', rpcUrl: 'https://rpc.mainnet.fastnear.com', rpcProviderId: 'fastnear-mainnet' };
// Exactly the app's signing profiles for this build (policy hash must match on both sides).
const appProfiles = {
  network,
  escrow: MainnetEscrowProfileSchema.parse({ ...network, contract: { accountId: 'payments.fixture.near', expectedCodeHash: CH } }),
  gift: MainnetGiftProfileSchema.parse({ ...network, contract: { accountId: 'gift.fixture.near', expectedCodeHash: CH, minAmountYocto: '10000000000000000000000', maxAmountYocto: '2000000000000000000000000', giftFeeYocto: '10000000000000000000000' } }),
  usdcCodeHash: CH,
};
const chain = syntheticChain();
const good = await startAuthorityHarness({ port: 8790 + Math.floor(Math.random() * 100), redisPort: REDIS_PORT, redisDb: 2, profiles: appProfiles, chain });
const otherPolicy = await startAuthorityHarness({ port: 8900 + Math.floor(Math.random() * 100), redisPort: REDIS_PORT, redisDb: 3, profiles: { ...appProfiles, usdcCodeHash: '9MzUv5RVWHpJdWcrnW9dXk8z4bRDNGKSyGbt4GaVnsS8' }, chain });
const authorityHits = { good: 0, other: 0 };

const browser = await chromium.launch();
const errors = [];
const dialogs = [];
const scripts = new Map();
async function ctx(label, authority /* 'good' | 'other' | 'none' | 'down' */) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await context.route(/https:\/\/(rpc\.mainnet\.fastnear\.com|archival-rpc\.mainnet\.fastnear\.com|rpc\.mainnet\.near\.org)\/?.*/, async (route) => {
    const res = await fetch(`http://127.0.0.1:${good.port}/__rpc`, { method: 'POST', body: route.request().postData() ?? '' });
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: await res.text() });
  });
  await context.route(`${ORIGIN}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname.startsWith('/api/mainnet/authority/') && authority !== 'none') {
      if (authority === 'down') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"AUTHORITY_UNAVAILABLE"}' });
      const h = authority === 'other' ? otherPolicy : good;
      authorityHits[authority]++;
      const res = await fetch(`http://127.0.0.1:${h.port}${url.pathname}`, { method: req.method(), headers: await req.allHeaders(), body: req.postData() ?? undefined });
      const headers = {}; res.headers.forEach((v, k) => { headers[k] = v; });
      return route.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) });
    }
    // Everything else (pages, assets, the app's own APIs) is the local Next server — which has NO authority route.
    const res = await route.fetch({ url: NEXT + url.pathname + url.search });
    return route.fulfill({ response: res });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('dialog', async (dlg) => { dialogs.push(`${label}: ${dlg.type()}: ${dlg.message().slice(0, 120)}`); await dlg.dismiss(); });
  page.on('response', async (r) => { if (r.url().includes('/_next/static/') && r.url().endsWith('.js')) { try { scripts.set(r.url(), await r.text()); } catch {} } });
  return { context, page };
}
const text = async (p, id) => (await p.getByTestId(id).first().textContent({ timeout: 20000 }).catch(() => '')) ?? '';
const waitFor = (p, id, timeout = 30000) => p.waitForSelector(`[data-testid=${id}]`, { timeout }).then(() => true, () => false);

async function createWallet(page) {
  await page.goto(`${ORIGIN}/m/wallet/create`);
  await page.locator('#mw-pass').fill('correct horse 42');
  await page.locator('#mw-pass2').fill('correct horse 42');
  await page.getByTestId('wallet-create').click();
  await page.waitForSelector('[data-testid=phrase-words]', { timeout: 30000 });
  const words = await page.locator('[data-testid=phrase-words] li').evaluateAll((els) => els.map((e) => e.textContent.replace(/^\d+\.\s*/, '').trim()));
  for (const input of await page.locator('[data-testid^=verify-]').all()) {
    const i = Number((await input.getAttribute('data-testid')).split('-')[1]);
    await input.fill(words[i]);
  }
  await page.getByTestId('backup-done').click();
  const rec = JSON.parse(await page.evaluate(() => localStorage.getItem('taply.mainnet-vault.v1')));
  const publicKey = ed25519PublicKeyFromHex(rec.publicKeyHex);
  await good.provision(rec.accountId, publicKey);   // test setup: provision the account's authority record + witness head
  await otherPolicy.provision(rec.accountId, publicKey);
  return { accountId: rec.accountId, publicKey };
}
async function sendReview(page) {
  await page.goto(`${ORIGIN}/m/send`);
  await page.locator('#mw-to').fill('bob.near');
  await page.locator('#mw-amount').fill('1');
  await page.getByTestId('send-review').click();
  await page.waitForFunction(() => document.querySelector('[data-testid=op-review]') || document.querySelector('[data-testid=op-error]'), null, { timeout: 30000 }).catch(() => {});
}

// ---------- 1. Real browser ↔ Codex authority: challenge issued, validated, refused at the wallet gate ----------
const a = await ctx('owner', 'good');
const me = await createWallet(a.page);
check('Taply Wallet created at the exact Mainnet origin and provisioned in the TEST authority', /^[0-9a-f]{64}$/.test(me.accountId));
await sendReview(a.page);
check('authority answered with a challenge that the app validated; the wallet refused at the closed gate → exact review only, labelled',
  (await a.page.getByTestId('op-review').getAttribute('data-authority').catch(() => null)) === 'http-gated' && /stays disabled until the release review/.test(await text(a.page, 'op-authority')), await text(a.page, 'op-authority'));
check('the browser reached Codex\'s HTTP authority (challenge requests observed)', authorityHits.good >= 1, String(authorityHits.good));
const cookies = await a.context.cookies(ORIGIN);
const dev = cookies.find((c) => c.name === '__Host-taply-mainnet-device');
check('server-issued device credential: __Host- cookie, HttpOnly, Secure, SameSite=Strict, not readable by page script',
  dev && dev.httpOnly && dev.secure && dev.sameSite === 'Strict' && !(await a.page.evaluate(() => document.cookie)).includes('taply-mainnet-device'), JSON.stringify(dev));
check('confirm stays disabled', await a.page.getByTestId('op-confirm').isDisabled());
await a.page.screenshot({ path: `${OUT}/p6-01-authority-gated.png`, fullPage: true });
check('payment record: reading it needs wallet authorization → gated, sending stays disabled', await waitFor(a.page, 'ledger-http') && (await a.page.locator('[data-testid=ledger-http] [data-state]').getAttribute('data-state')) === 'gated');
const payload = JSON.parse((await (await fetch(`http://127.0.0.1:${good.port}/__harness/redis`, { method: 'POST', body: JSON.stringify({ args: ['GET', `taply:mainnet:authority:v1:${me.accountId}`] }) })).json()).result).payload;
const state = JSON.parse(payload);
check('server state: challenges recorded, none executed, no ledger written, no device enrolled (no authenticated command happened)',
  state.challenges.length >= 1 && state.challenges.every((c) => c.used === false) && state.ledger === null && state.ownerDeviceId === null, JSON.stringify({ n: state.challenges.length, ledger: state.ledger, owner: state.ownerDeviceId }));
const ttl = (await (await fetch(`http://127.0.0.1:${good.port}/__harness/redis`, { method: 'POST', body: JSON.stringify({ args: ['PTTL', `taply:mainnet:authority:v1:${me.accountId}`] }) })).json()).result;
check('authority record in Redis has no TTL', ttl === -1, String(ttl));

// ---------- 2. Policy pinned locally: a server with another policy is refused before any wallet prompt ----------
const b = await ctx('policy', 'other');
await b.page.goto(`${ORIGIN}/m`);
await b.page.evaluate((v) => localStorage.setItem('taply.mainnet-vault.v1', v), JSON.stringify(JSON.parse(await a.page.evaluate(() => localStorage.getItem('taply.mainnet-vault.v1')))));
await sendReview(b.page);
check('authority with a different policy hash → refused (AUTHORITY_POLICY_MISMATCH), no review', (await b.page.locator('[data-testid=op-error] [data-code]').getAttribute('data-code').catch(() => null)) === 'AUTHORITY_POLICY_MISMATCH');
await b.page.screenshot({ path: `${OUT}/p6-02-policy-mismatch.png`, fullPage: true });

// ---------- 3. Authority unavailable / not mounted → fail closed ----------
const c = await ctx('down', 'down');
await c.page.goto(`${ORIGIN}/m`);
await c.page.evaluate((v) => localStorage.setItem('taply.mainnet-vault.v1', v), await a.page.evaluate(() => localStorage.getItem('taply.mainnet-vault.v1')));
await sendReview(c.page);
check('authority answering 503 → review only, "not reachable", nothing reservable', (await c.page.getByTestId('op-review').getAttribute('data-authority').catch(() => null)) === 'http-unavailable');
const d = await ctx('none', 'none');
await d.page.goto(`${ORIGIN}/m`);
const direct = await d.page.evaluate(async () => (await fetch('/api/mainnet/authority/challenge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status);
check('the app server itself has NO authority endpoint (production behaviour): 404', direct === 404, String(direct));
await d.page.evaluate((v) => localStorage.setItem('taply.mainnet-vault.v1', v), await a.page.evaluate(() => localStorage.getItem('taply.mainnet-vault.v1')));
await sendReview(d.page);
check('without the harness the app fails closed: review only, labelled unavailable', (await d.page.getByTestId('op-review').getAttribute('data-authority').catch(() => null)) === 'http-unavailable');
const redisRoute = await d.page.evaluate(async () => { const r = await fetch('/__harness/redis', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ args: ['KEYS', '*'] }) }); return { status: r.status, type: r.headers.get('content-type') ?? '', body: (await r.text()).slice(0, 200) }; });
check('no Redis or CAS surface on the app origin (no Redis answer comes back)', !/"result"/.test(redisRoute.body) && !/application\/json/.test(redisRoute.type), JSON.stringify(redisRoute));

// ---------- 4. Merchant binding: sale frozen through bindCommerce → gated at the wallet, shown honestly ----------
await a.page.goto(`${ORIGIN}/m/merchant/register`);
await a.page.locator('#amount').fill('3');
await a.page.getByRole('button', { name: /^Review/ }).click();
await waitFor(a.page, 'sale-link');
check('sale still bound locally with Codex bindMainnetCommerceTerms (deterministic id, commitment in memo)', /#c=/.test(await text(a.page, 'sale-link')));
const freeze = await a.page.waitForSelector('[data-testid=sale-freeze]', { timeout: 20000 }).then(() => a.page.getByTestId('sale-freeze').getAttribute('data-status'), () => null);
check('authority freeze (bindCommerce) attempted; not frozen because the store wallet is not the authority account → shown as not frozen', freeze === 'unavailable' || freeze === 'gated', String(freeze));
await a.page.screenshot({ path: `${OUT}/p6-03-merchant.png`, fullPage: true });

// ---------- 5. Leak scan + errors ----------
const found = [];
for (const [url, body] of scripts) for (const leak of ['taply-e2e-ce38a238', 'taply.testnet-vault.v1', 'taply.mainnet.sim-authority', 'rpc.testnet.near.org']) if (body.includes(leak)) found.push(`${leak} in ${url.split('/').pop()}`);
check(`leak scan over ${scripts.size} scripts (incl. no simulated authority in this build)`, found.length === 0, found.join('; '));
check('no uncaught page errors', errors.length === 0, errors.join(' | '));
check('no wallet-authorization prompt was ever shown (the gate refuses before any confirmation)', dialogs.length === 0, dialogs.join(' | '));

await browser.close();
good.close(); otherPolicy.close();
fs.writeFileSync(`${OUT}/phase6-results.json`, JSON.stringify({ origin: ORIGIN, authority: 'Codex createMainnetAuthorityHttp + createAuthenticatedMainnetAuthority + fenced Redis persistence; REAL Redis; IN-MEMORY TEST WITNESS (not production)', rpc: 'SYNTHETIC chain', signing: 'gated (closed) — authority commands refused at the wallet', results, errors }, null, 2));
console.log(`\n${results.filter((x) => x.ok).length}/${results.length} passed`);
process.exit(results.every((x) => x.ok) ? 0 : 1);
