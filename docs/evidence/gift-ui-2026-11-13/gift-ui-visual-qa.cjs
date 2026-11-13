// Visual QA of Taply Gift screens on a local production build.
// MOCK RPC: every JSON-RPC answer below is synthetic (no chain). Proves layout,
// animation and state rendering only — never on-chain behaviour.
const { chromium } = require('playwright');
const OUT = process.argv[2];
const BASE = 'http://localhost:3100';
const G = '0123456789abcdef0123456789abcdef';
const SECRET = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc';
const PK7 = 'ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c';
const CODE = '7YZtXjTS7qLDzGY5oAL99agv8ZzKbaKpFyP98htUt21u';
const GENESIS = 'FWJ9kR6KFWoyMoNjpLXXGHeuiy7tEY6GmoFeCA5yuc6b';
const HASH = '11111111111111111111111111111113';
const nowNs = () => (BigInt(Date.now()) * 1000000n).toString();
const CONFIG = { contract: 'taply-gift', version: '0.1.0', reviewStatus: 'UNREVIEWED_NOT_FOR_REAL_FUNDS', asset: 'near:native',
  giftFeeYocto: '10000000000000000000000', minAmountYocto: '10000000000000000000000', maxAmountYocto: '100000000000000000000000000',
  minLifetimeS: '600', maxLifetimeS: '2592000', maxMessageBytes: 280, maxDesign: 7, claimDomain: 'taply-gift-claim:v1' };
const base = () => ({ id: G, creator: 'alice-taply.testnet', amountYocto: '1000000000000000000000000', publicKey: PK7,
  message: 'Thanks for building with us this week. First to claim wins 🎁', design: 0,
  createdAtNs: (BigInt(nowNs()) - 600000000000n).toString(), createdHeight: '190000000',
  expiresAtNs: (BigInt(nowNs()) + 86_000_000_000_000n).toString(), status: 'AVAILABLE', beneficiary: null, settledAtNs: null,
  settledHeight: null, payout: null, payoutNonce: null });
const SCEN = {
  available: () => base(),
  claimed: () => ({ ...base(), status: 'CLAIMED', beneficiary: 'bob-claims.testnet', settledAtNs: nowNs(), settledHeight: '190000123', payout: 'CONFIRMED', payoutNonce: 1 }),
  expired: () => ({ ...base(), status: 'EXPIRED', expiresAtNs: (BigInt(nowNs()) - 1000000000n).toString() }),
};
let scenario = 'available';
let fail = false;
async function route(page) {
  await page.route(/rpc|fastnear|near\.org/, async (r) => {
    const req = r.request();
    if (req.method() !== 'POST') return r.continue();
    let body; try { body = JSON.parse(req.postData() || '{}'); } catch { return r.continue(); }
    if (fail) return r.fulfill({ status: 503, body: 'busy' });
    const p = body.params || {};
    let result;
    if (body.method === 'status') result = { chain_id: 'testnet', genesis_hash: GENESIS, version: { version: 'mock' }, sync_info: { syncing: false, latest_block_height: 190000200 } };
    else if (body.method === 'block') result = { header: { hash: HASH, height: 190000200, timestamp_nanosec: nowNs() } };
    else if (body.method === 'query' && p.request_type === 'view_account') result = { amount: '5000000000000000000000000', locked: '0', storage_usage: 300000, code_hash: CODE, block_hash: HASH, block_height: 190000200 };
    else if (body.method === 'query' && p.request_type === 'call_function') {
      const v = p.method_name === 'get_config' ? CONFIG : p.method_name === 'get_gift' ? SCEN[scenario]() : null;
      result = { result: [...Buffer.from(JSON.stringify(v))], logs: [], block_hash: HASH, block_height: 190000200 };
    } else return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'mock: unsupported' } }) });
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result }) });
  });
}
(async () => {
  const browser = await chromium.launch();
  const report = { mock: 'SYNTHETIC RPC — layout/state rendering only, no chain', shots: [], overflow: [], consoleErrors: [] };
  const shot = async (page, name) => { await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); report.shots.push(name); };
  const overflow = async (page, name) => {
    const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    report.overflow.push({ name, px: o });
  };
  for (const width of [360, 390, 430]) {
    const ctx = await browser.newContext({ viewport: { width, height: 860 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${width}: ${m.text()}`); });
    await route(page);
    scenario = 'available'; fail = false;
    await page.goto(`${BASE}/gift/${G}#k=${SECRET}`);
    await page.getByTestId('gift-state').filter({ hasText: 'Available' }).waitFor();
    await shot(page, `open-gift-closed-${width}`); await overflow(page, `open-gift-closed-${width}`);
    await page.getByRole('button', { name: /Unwrap/ }).click();
    await page.waitForTimeout(1600);
    await shot(page, `open-gift-unwrapped-${width}`); await overflow(page, `open-gift-unwrapped-${width}`);
    if (width === 390) {
      scenario = 'claimed';
      await page.goto(`${BASE}/gift/${G}#k=${SECRET}`);
      await page.getByTestId('gift-state').filter({ hasText: 'Already claimed' }).waitFor();
      await shot(page, 'open-gift-already-claimed-390');
      await page.goto(`${BASE}/gift/${G}/receipt`);
      await page.getByText('Gift receipt').first().waitFor();
      await page.waitForTimeout(500);
      await shot(page, 'gift-receipt-390');
      scenario = 'expired';
      await page.goto(`${BASE}/gift/${G}#k=${SECRET}`);
      await page.getByTestId('gift-state').filter({ hasText: 'Expired' }).waitFor();
      await shot(page, 'open-gift-expired-390');
      fail = true;
      await page.goto(`${BASE}/gift/${G}#k=${SECRET}`);
      await page.getByTestId('gift-state').filter({ hasText: 'Verification unavailable' }).waitFor({ timeout: 30000 });
      await shot(page, 'open-gift-rpc-unavailable-390');
      fail = false; scenario = 'available';
      await page.goto(`${BASE}/gift/new`);
      await page.getByRole('button', { name: /Open Gift/ }).waitFor();
      await page.waitForFunction(() => !document.querySelectorAll('button')[0] || [...document.querySelectorAll('button')].some((b) => /Open Gift/.test(b.textContent || '') && !b.disabled), null, { timeout: 15000 });
      await shot(page, 'create-1-type-390');
      await page.getByRole('button', { name: /Open Gift/ }).click();
      await page.getByLabel('Amount').fill('1');
      await shot(page, 'create-2-amount-390');
      await page.getByRole('button', { name: /Continue/ }).click();
      await page.getByLabel('Message (optional)').fill('Happy hackathon! First to claim wins 🎁');
      await page.getByRole('radio', { name: /Midnight/ }).click();
      await page.waitForTimeout(700);
      await shot(page, 'create-3-envelope-390');
      await page.getByRole('button', { name: /Continue/ }).click();
      await page.getByRole('region', { name: 'Review the transaction' }).waitFor();
      await shot(page, 'create-4-review-390');
      await page.goto(`${BASE}/`);
      await page.getByRole('button', { name: 'Tap' }).click();
      await page.getByText('Send a Gift').waitFor();
      await page.waitForTimeout(500);
      await shot(page, 'tap-sheet-send-a-gift-390');
    }
    await ctx.close();
  }
  // Reduced motion: no 3D movement, a cross-fade only.
  const rm = await browser.newContext({ viewport: { width: 390, height: 860 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const p = await rm.newPage(); await route(p); scenario = 'available';
  await p.goto(`${BASE}/gift/${G}#k=${SECRET}`);
  await p.getByTestId('gift-state').filter({ hasText: 'Available' }).waitFor();
  await p.getByRole('button', { name: /Unwrap/ }).click();
  await p.waitForTimeout(400);
  report.reducedMotionFlapTransform = await p.evaluate(() => getComputedStyle(document.querySelector('.gift-env__flap')).transform);
  await shot(p, 'open-gift-unwrapped-reduced-motion-390');
  await browser.close();
  require('fs').writeFileSync(`${OUT}/visual-qa.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
