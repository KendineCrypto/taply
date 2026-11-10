// Real browser + real NEAR Testnet: Taply Wallet asks for the password ONCE.
// 1) create a wallet, 2) pay request A (unlock dialog once), 3) open request B in a
// fresh page load: already connected, only the confirmation dialog, 4) reload:
// still unlocked, 5) Lock now on /wallet: the next payment asks for the password.
// Usage: node stay-unlocked-e2e.mjs <baseUrl> <outDir> <playwright module> <near-client testnet-e2e lib.mjs>
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const [base, out, pw, libPath] = process.argv.slice(2);
const { chromium } = await import(pw);
const lib = await import(libPath);
const CONTRACT = 'taply-pay-pilot-1.testnet';
const PASS = 'disposable-e2e';
const NEAR = 10n ** 24n;
await lib.assertTestnet();
const merchantId = await lib.createFaucetAccount('taply-merchant');
const merchant = lib.loadAccount(merchantId);
async function createRequest(amount) {
  const block = await lib.finalBlock();
  const { terms } = lib.buildTerms({ contractId: CONTRACT, creator: merchantId, amount, nowNs: block.timestampNs, memo: 'Taply stays unlocked' });
  const quote = await lib.view(CONTRACT, 'quote_create_request', { terms });
  const r = await lib.call(merchant, CONTRACT, 'create_request', { terms, quoteVersion: quote.quoteVersion }, { deposit: BigInt(quote.depositYocto), gas: BigInt(quote.gas) });
  if (r.failure) throw new Error(r.failure);
  return terms.id;
}
const waitPaid = async (id) => { for (let i = 0; i < 60; i++) { const r = await lib.view(CONTRACT, 'get_request', { id }); if (r.status === 'FINAL_PAID') return r; await lib.sleep(2000); } return lib.view(CONTRACT, 'get_request', { id }); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
const username = `taply-open-${randomBytes(3).toString('hex')}`;
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
await page.getByText(`${username}.testnet is live on NEAR Testnet`).waitFor({ timeout: 120_000 });
await page.getByRole('button', { name: 'Finish' }).click();
await page.waitForURL(base + '/');

const unlockDialogs = [];
const confirmDialogs = [];
page.on('framenavigated', () => undefined);
async function pay(id, label) {
  await page.goto(`${base}/pay/${id}`, { waitUntil: 'networkidle' });
  const check = page.getByLabel('I checked the recipient account and the amount.');
  const connect = page.getByRole('button', { name: 'Connect wallet' });
  await Promise.race([check.waitFor({ timeout: 60_000 }), connect.first().waitFor({ timeout: 60_000 })]);
  if (await connect.first().isVisible().catch(() => false)) {
    await connect.first().click();
    const unlock = page.getByRole('dialog', { name: 'Unlock Taply Wallet to pay' });
    await unlock.waitFor({ timeout: 30_000 });
    unlockDialogs.push(label);
    await unlock.getByLabel('Password').fill(PASS);
    await unlock.getByRole('button', { name: /^Unlock$/ }).click();
  }
  await check.check({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Approve in wallet' }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm transaction' });
  try { await dialog.waitFor({ timeout: 90_000 }); } catch (e) {
    await page.screenshot({ path: `${out}/debug-${confirmDialogs.length}.png`, fullPage: true });
    console.log('PAGE:', (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 1200));
    throw e;
  }
  confirmDialogs.push(label);
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  return waitPaid(id);
}

const a = await pay(await createRequest(NEAR / 20n), 'A (first payment)');
const b = await pay(await createRequest(NEAR / 20n), 'B (new page load)');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(4000);
const stillConnectedAfterReload = !(await page.getByRole('button', { name: 'Connect wallet' }).first().isVisible().catch(() => false));
await page.screenshot({ path: `${out}/stay-unlocked-after-reload.png`, fullPage: true });
// Explicit lock ends it.
await page.goto(`${base}/wallet`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /Lock now/ }).click({ timeout: 60_000 });
const c = await pay(await createRequest(NEAR / 20n), 'C (after Lock now)');
await browser.close();

const result = { kind: 'TAPLY_WALLET_STAY_UNLOCKED_BROWSER_TESTNET_PROOF', base, payer: `${username}.testnet`, merchant: merchantId,
  unlockDialogs, confirmDialogs, stillConnectedAfterReload,
  payments: [a, b, c].map((r) => ({ id: r.terms?.id ?? null, status: r.status, payout: r.latestOperation?.amountBaseUnits ?? null, payoutStatus: r.latestOperation?.status ?? null })) };
writeFileSync(`${out}/stay-unlocked-result.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 1));
const ok = unlockDialogs.join() === 'A (first payment),C (after Lock now)' && confirmDialogs.length === 3 && stillConnectedAfterReload && [a, b, c].every((r) => r.status === 'FINAL_PAID');
if (!ok) process.exit(1);
