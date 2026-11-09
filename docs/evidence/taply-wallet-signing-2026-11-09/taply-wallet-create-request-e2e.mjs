// Real NEAR Testnet, real browser: a fresh Taply Wallet CREATES a payment request
// (create_request, confirmed in Taply's dialog); then a second fresh Taply Wallet,
// in another browser context, pays it. Nothing uses automation keys.
// Usage: node taply-wallet-create-request-e2e.mjs <baseUrl> <outDir> <playwright module> <near-client testnet-e2e lib.mjs>
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const [base, out, pw, libPath] = process.argv.slice(2);
const { chromium } = await import(pw);
const lib = await import(libPath);
const CONTRACT = 'taply-pay-pilot-1.testnet';
const PASS = 'disposable-e2e';
await lib.assertTestnet();
const browser = await chromium.launch();

async function newWallet(prefix) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(prefix, 'pageerror', e.message));
  const username = `${prefix}-${randomBytes(3).toString('hex')}`;
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
  return { page, accountId: `${username}.testnet` };
}
async function connect(page) {
  const btn = page.getByRole('button', { name: 'Connect wallet' }).first();
  await btn.click({ timeout: 60_000 });
  const unlock = page.getByRole('dialog', { name: 'Unlock Taply Wallet to pay' });
  await unlock.getByLabel('Password').fill(PASS);
  await unlock.getByRole('button', { name: /^Unlock$/ }).click();
  await unlock.waitFor({ state: 'detached', timeout: 60_000 });
}
async function confirm(page, shot) {
  const dialog = page.getByRole('dialog', { name: 'Confirm transaction' });
  await dialog.waitFor({ timeout: 90_000 });
  const text = (await dialog.innerText()).replace(/\s+/g, ' ');
  await page.screenshot({ path: `${out}/${shot}.png`, fullPage: true });
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 60_000 });
  return text.slice(0, 300);
}

// Merchant wallet creates the request in the app.
const merchant = await newWallet('taply-shop');
await merchant.page.goto(base + '/request/new', { waitUntil: 'networkidle' });
await connect(merchant.page);
await merchant.page.locator('input[inputmode="decimal"]').first().fill('0.05');
await merchant.page.getByRole('button', { name: 'Continue' }).click();
await merchant.page.getByRole('button', { name: 'Create request in wallet' }).click({ timeout: 60_000 });
const createDialog = await confirm(merchant.page, 'create-confirm');
// After a confirmed creation the app opens the merchant view of the new request.
await merchant.page.waitForURL(/\/pay\/[0-9a-f]{64}/, { timeout: 120_000 });
const requestId = new URL(merchant.page.url()).pathname.split('/pay/')[1];
await merchant.page.getByText('Ready for customer', { exact: false }).first().waitFor({ timeout: 60_000 }).catch(() => {});
await merchant.page.screenshot({ path: `${out}/create-done.png`, fullPage: true });
let created = null;
for (let i = 0; i < 30 && created === null; i++) { try { created = await lib.view(CONTRACT, 'get_request', { id: requestId }); } catch { await lib.sleep(2000); } }

// Customer wallet pays it in another browser context.
const customer = await newWallet('taply-buyer');
const before = BigInt((await lib.viewAccount(merchant.accountId)).amount);
await customer.page.goto(`${base}/pay/${requestId}`, { waitUntil: 'networkidle' });
await connect(customer.page);
await customer.page.getByLabel('I checked the recipient account and the amount.').check({ timeout: 60_000 });
await customer.page.getByRole('button', { name: 'Approve in wallet' }).click();
const payDialog = await confirm(customer.page, 'pay-confirm');
let final = null;
for (let i = 0; i < 60; i++) { final = await lib.view(CONTRACT, 'get_request', { id: requestId }); if (final.status === 'FINAL_PAID') break; await lib.sleep(2000); }
const after = BigInt((await lib.viewAccount(merchant.accountId)).amount);
await customer.page.waitForTimeout(3000);
await customer.page.screenshot({ path: `${out}/pay-done.png`, fullPage: true });
await browser.close();

const result = { kind: 'TAPLY_WALLET_CREATES_AND_PAYS_REQUEST_BROWSER_TESTNET_PROOF', network: 'near-testnet', base,
  merchantAccountId: merchant.accountId, customerAccountId: customer.accountId, requestId,
  createdStatus: created?.status ?? null, createdRecipient: created?.recipientAccountId ?? null, createdAmount: created?.terms?.amountBaseUnits ?? null,
  finalStatus: final?.status, payout: final?.latestOperation ?? null, merchantDeltaYocto: (after - before).toString(),
  dialogs: { create: createDialog, pay: payDialog } };
writeFileSync(`${out}/create-request-result.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 1));
if (final?.status !== 'FINAL_PAID') process.exit(1);
