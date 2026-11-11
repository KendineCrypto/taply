// Real NEAR Testnet, real browser, two people: a freelancer (recipient) and a
// client (payer), each with their own Taply Wallet in a separate browser context.
//   A. Refund:  create (5 min window) -> lock -> LOCKED - NOT PAID -> payer cancels -> CANCELLED_REFUNDED
//   B. Release: create (60 s window)  -> lock -> wait for the on-chain cutoff -> recipient releases -> FINAL_PAID
// Every transaction is confirmed in Taply Wallet's own dialog. Chain state is read
// separately from Node at a final block.
// Usage: node protected-e2e.mjs <baseUrl> <outDir> <playwright module> [proxy]
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const [base, out, pw, proxy] = process.argv.slice(2);
const { chromium, devices } = await import(pw);
// Optional device emulation, e.g. TAPLY_DEVICE='Pixel 7' (Android Chrome emulation, not a physical phone).
const DEVICE = process.env.TAPLY_DEVICE ?? null;
if (DEVICE !== null && !devices[DEVICE]) throw new Error(`unknown device ${DEVICE}`);
mkdirSync(out, { recursive: true });
const CONTRACT = process.env.TAPLY_PROTECTED_CONTRACT ?? 'taply-e2e-ce38a238.testnet';
const RPC = process.env.TAPLY_E2E_RPC ?? 'https://test.rpc.fastnear.com';
const PASS = 'disposable-e2e';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(method, params) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const body = await res.json();
      if (body.error || body.result?.error) throw new Error(JSON.stringify(body.error ?? body.result.error));
      if (params.request_type === 'call_function' && !Array.isArray(body.result?.result)) throw new Error('no result');
      return body.result;
    } catch (e) {
      if (i >= 8) throw e;
      await sleep(2000);
    }
  }
}
const view = async (method, args) => JSON.parse(Buffer.from((await rpc('query', { request_type: 'call_function', finality: 'final', account_id: CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') })).result).toString());
const balance = async (id) => BigInt((await rpc('query', { request_type: 'view_account', finality: 'final', account_id: id })).amount);
const request = (id) => view('get_request', { id });
async function waitStatus(id, want, tries = 90) {
  let s;
  for (let i = 0; i < tries; i++) { s = (await request(id)).status; if (s === want) return s; await sleep(2000); }
  return s;
}

const browser = await chromium.launch(proxy ? { proxy: { server: proxy, bypass: 'localhost,127.0.0.1' } } : {});
const log = [];
async function person(role) {
  const context = await browser.newContext(DEVICE !== null ? { ...devices[DEVICE] } : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('pageerror', (e) => log.push({ role, pageerror: e.message }));
  page.on('console', (m) => { if (m.type() === 'error') log.push({ role, console: m.text().slice(0, 300) }); });
  page.on('requestfailed', (r) => log.push({ role, failed: r.url().slice(0, 120), why: r.failure()?.errorText }));
  const username = `taply-${role}-${randomBytes(3).toString('hex')}`;
  const accountId = `${username}.testnet`;
  let shots = 0;
  const shot = (name) => page.screenshot({ path: `${out}/${role}-${String(++shots).padStart(2, '0')}-${name}.png`, fullPage: true });
  const confirms = [];
  async function approve(label) {
    const dialog = page.getByRole('dialog', { name: 'Confirm transaction' });
    await dialog.waitFor({ timeout: 90_000 });
    confirms.push({ label, text: (await dialog.innerText()).replace(/\s+/g, ' ').slice(0, 500) });
    await shot(`confirm-${label}`);
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await dialog.waitFor({ state: 'detached', timeout: 30_000 });
  }
  async function ensureConnected() {
    const connect = page.getByRole('button', { name: 'Connect wallet' });
    // An unlocked Taply Wallet connects by itself once the chain read confirms the account.
    for (let i = 0; i < 20 && (await connect.isVisible().catch(() => false)); i++) await page.waitForTimeout(500);
    if (await connect.isVisible().catch(() => false)) {
      await connect.click();
      const pass = page.getByRole('dialog').getByLabel('Password');
      if (await pass.isVisible({ timeout: 5000 }).catch(() => false)) {
        await pass.fill(PASS);
        await page.getByRole('dialog').getByRole('button', { name: /^Unlock$/ }).click();
      }
    }
  }
  // Create the wallet through the normal onboarding.
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: /Choose a username/ }).click();
  await page.waitForURL('**/wallet/create'); await page.waitForLoadState('networkidle');
  const cont = page.getByRole('button', { name: /Continue/ });
  for (let i = 0; i < 20 && await cont.isDisabled(); i++) {
    for (const box of await page.getByRole('checkbox').all()) if (!(await box.isChecked())) await box.click();
    await page.waitForTimeout(300);
  }
  await cont.click();
  await page.getByRole('textbox', { name: 'Username' }).fill(username);
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByLabel('Password', { exact: true }).fill(PASS);
  await page.getByLabel('Confirm password').fill(PASS);
  await page.getByRole('button', { name: /Create wallet/ }).click();
  await page.getByRole('heading', { name: 'Your Secret Recovery Phrase' }).waitFor({ timeout: 60_000 });
  await page.getByLabel('I saved my Secret Recovery Phrase').check();
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByText(`${accountId} is live on NEAR Testnet`).waitFor({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.waitForURL(base + '/');
  return { role, page, accountId, shot, approve, ensureConnected, confirms };
}

const freelancer = await person('freelancer');
process.on('uncaughtException', async (e) => { console.log('FAIL', e.message); try { await freelancer.shot('FAIL'); await client?.shot('FAIL'); console.log(JSON.stringify(log)); } finally { process.exit(2); } });
var client = await person('client');
console.log('wallets', freelancer.accountId, client.accountId);

const shares = [];
async function createRequest(amount, windowLabel, name) {
  const { page } = freelancer;
  await page.goto(`${base}/protected/new`, { waitUntil: 'networkidle' });
  await freelancer.ensureConnected();
  await page.getByLabel('Amount (NEAR)').fill(amount);
  await page.getByLabel('Payer can cancel for').selectOption({ label: windowLabel });
  await freelancer.shot(`${name}-create-form`);
  await page.getByRole('button', { name: 'Create Protected request in wallet' }).click({ timeout: 60_000 });
  await freelancer.approve(`${name}-create`);
  await page.getByRole('link', { name: 'Open request' }).click({ timeout: 90_000 });
  await page.waitForURL(/\/protected\/[0-9a-f]{64}/);
  const id = page.url().split('/protected/')[1].split(/[?#]/)[0];
  if ((await waitStatus(id, 'OPEN')) !== 'OPEN') throw new Error('request never became OPEN');
  // On a public HTTPS origin the recipient gets one QR and a share link for the payer.
  const share = page.locator('div').filter({ has: page.getByRole('heading', { name: 'Send this to the payer' }) }).last();
  const shareVisible = base.startsWith('https://') ? await share.waitFor({ timeout: 45_000 }).then(() => true, () => false) : false;
  shares.push({ name, shareVisible, qrLabel: shareVisible ? await page.getByRole('img', { name: 'QR code for this Protected request' }).count().then((n) => (n > 0 ? 'QR code for this Protected request' : null)) : null });
  if (shareVisible) await freelancer.shot(`${name}-share`);
  return id;
}
async function lock(id, name) {
  const { page } = client;
  await page.goto(`${base}/protected/${id}`, { waitUntil: 'networkidle' });
  await client.ensureConnected();
  await page.getByLabel(/I understand: locked, not paid/).check({ timeout: 60_000 });
  await client.shot(`${name}-consent`);
  await page.getByRole('button', { name: 'Lock payment in wallet' }).click();
  await client.approve(`${name}-lock`);
  const status = await waitStatus(id, 'LOCKED');
  await page.getByText('LOCKED - NOT PAID').first().waitFor({ timeout: 60_000 });
  await client.shot(`${name}-locked`);
  return status;
}

// --- A. Refund ---------------------------------------------------------------
const A = { amount: '0.05' };
A.id = await createRequest(A.amount, '5 minutes', 'refund');
A.payerBefore = await balance(client.accountId);
A.recipientBefore = await balance(freelancer.accountId);
A.lockedStatus = await lock(A.id, 'refund');
A.payerLocked = await balance(client.accountId);
// The freelancer's screen must also say LOCKED - NOT PAID, never paid.
await freelancer.page.goto(`${base}/protected/${A.id}`, { waitUntil: 'networkidle' });
await freelancer.page.getByText('LOCKED - NOT PAID').first().waitFor({ timeout: 60_000 });
A.recipientSeesPaidWhileLocked = await freelancer.page.getByText(/Paid per contract|Verified Paid/).count();
A.recipientCanRelease = await freelancer.page.getByRole('button', { name: 'Release to recipient' }).count();
A.recipientCanCancel = await freelancer.page.getByRole('button', { name: 'Cancel and refund me' }).count();
await freelancer.shot('refund-recipient-locked');
await client.page.getByRole('button', { name: 'Cancel and refund me' }).click();
await client.approve('refund-cancel');
A.finalStatus = await waitStatus(A.id, 'CANCELLED_REFUNDED');
await client.page.locator('[data-receipt-status="refunded"]').waitFor({ timeout: 60_000 });
await client.shot('refund-done');
A.payerAfter = await balance(client.accountId);
A.recipientAfter = await balance(freelancer.accountId);
A.chain = await request(A.id);
console.log('A', A.finalStatus);

// --- B. Release --------------------------------------------------------------
const B = { amount: '0.05' };
B.id = await createRequest(B.amount, '60 seconds', 'release');
B.recipientBefore = await balance(freelancer.accountId);
B.payerBefore = await balance(client.accountId);
B.lockedStatus = await lock(B.id, 'release');
await freelancer.page.goto(`${base}/protected/${B.id}`, { waitUntil: 'networkidle' });
await freelancer.ensureConnected();
const release = freelancer.page.getByRole('button', { name: 'Release to recipient' });
B.releaseOfferedBeforeCutoff = await release.count();
await freelancer.shot('release-recipient-waiting');
await release.waitFor({ timeout: 180_000 });
// The payer's cancel button must be gone once a final block is past the cutoff.
await client.page.getByRole('button', { name: 'Release to recipient' }).waitFor({ timeout: 60_000 });
B.payerCancelOfferedAfterCutoff = await client.page.getByRole('button', { name: 'Cancel and refund me' }).count();
await client.shot('release-payer-after-cutoff');
await release.click();
await freelancer.approve('release-release');
B.finalStatus = await waitStatus(B.id, 'FINAL_PAID');
await freelancer.page.locator('[data-receipt-status="released"]').waitFor({ timeout: 60_000 });
await freelancer.shot('release-done');
await client.page.locator('[data-receipt-status="released"]').waitFor({ timeout: 60_000 });
await client.shot('release-payer-done');
B.recipientAfter = await balance(freelancer.accountId);
B.payerAfter = await balance(client.accountId);
B.chain = await request(B.id);
await browser.close();

const str = (o) => JSON.parse(JSON.stringify(o, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
const result = str({
  kind: 'PROTECTED_PAY_BROWSER_TESTNET_RUN', network: 'near-testnet', base, contractId: CONTRACT,
  note: 'Real Chromium, two Taply Wallets (disposable faucet accounts), unreviewed Testnet escrow candidate. Test NEAR only.',
  freelancer: freelancer.accountId, client: client.accountId, device: DEVICE ?? 'Chromium 390x844', shares,
  refund: { ...A, payerNetYocto: A.payerAfter - A.payerBefore, recipientNetYocto: A.recipientAfter - A.recipientBefore },
  release: { ...B, recipientNetYocto: B.recipientAfter - B.recipientBefore, payerNetYocto: B.payerAfter - B.payerBefore },
  confirmations: { freelancer: freelancer.confirms, client: client.confirms },
  pageLog: log,
});
writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 1));
if (A.finalStatus !== 'CANCELLED_REFUNDED' || B.finalStatus !== 'FINAL_PAID') process.exit(1);
