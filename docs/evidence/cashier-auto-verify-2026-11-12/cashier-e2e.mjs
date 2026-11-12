// The cashier's phone after a sale is paid: does it reach Verified Paid without a tap?
// Merchant: a real Taply Wallet in the app creates a 0.01 NEAR request at /request/new.
// Customer: a disposable faucet account pays it from a script (pay_instant_native).
// Expect: the merchant's pay screen opens /receipt/<id> by itself (no ?ftx= hint,
// so the receipt has to find the funding transaction on chain) and shows Verified Paid.
// Usage: node cashier-e2e.mjs <baseUrl> <outDir> <playwright module> <near-client testnet-e2e lib.mjs>
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const [base, out, pw, libPath] = process.argv.slice(2);
const { chromium } = await import(pw);
const lib = await import(libPath);
const CONTRACT = 'taply-pay-pilot-1.testnet';
const PASS = 'disposable-e2e';
const log = [];
const step = (s) => { log.push({ atUtc: new Date().toISOString(), step: s }); console.log('·', s); };

await lib.assertTestnet();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
const username = `taply-till-${randomBytes(3).toString('hex')}`;
const merchantId = `${username}.testnet`;

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
await page.getByText(`${merchantId} is live on NEAR Testnet`).waitFor({ timeout: 120_000 });
await page.getByRole('button', { name: 'Finish' }).click();
await page.waitForURL(base + '/');
step(`merchant wallet ${merchantId}`);

await page.goto(base + '/request/new', { waitUntil: 'networkidle' });
const connect = page.getByRole('button', { name: 'Connect wallet' }).first();
if (await connect.isVisible().catch(() => false)) {
  await connect.click();
  const unlock = page.getByRole('dialog', { name: /Unlock Taply Wallet/ });
  if (await unlock.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await unlock.getByLabel('Password').fill(PASS);
    await unlock.getByRole('button', { name: /^Unlock$/ }).click();
  }
}
await page.locator('input[inputmode="decimal"]').first().fill('0.01');
await page.getByRole('button', { name: 'Continue' }).click();
await page.getByRole('button', { name: 'Create request in wallet' }).click({ timeout: 60_000 });
const dialog = page.getByRole('dialog', { name: 'Confirm transaction' });
await dialog.waitFor({ timeout: 90_000 });
await dialog.getByRole('button', { name: 'Confirm' }).click();
await page.waitForURL(/\/pay\/[0-9a-f]{64}/, { timeout: 120_000 });
const requestId = new URL(page.url()).pathname.split('/pay/')[1];
step(`request created in the app ${requestId}`);
await page.screenshot({ path: `${out}/1-cashier-waiting.png` });

const payerId = await lib.createFaucetAccount('taply-shopper');
const req = await lib.view(CONTRACT, 'get_request', { id: requestId });
const paid = await lib.call(lib.loadAccount(payerId), CONTRACT, 'pay_instant_native', { id: requestId, expectedTermsHash: req.termsHash },
  { deposit: BigInt(req.terms.amountBaseUnits), gas: 50n * lib.TGAS });
if (paid.failure) throw new Error(`pay failed ${paid.failure}`);
step(`customer ${payerId} paid, tx ${paid.hash}`);

const t0 = Date.now();
const opened = await page.waitForURL(/\/receipt\//, { timeout: 90_000 }).then(() => true, () => false);
const receiptUrl = page.url();
step(opened ? `cashier screen opened ${new URL(receiptUrl).pathname}${new URL(receiptUrl).search} by itself after ${Math.round((Date.now() - t0) / 1000)} s` : 'cashier screen did NOT open the receipt');
let verified = false;
for (let i = 0; i < 60 && opened && !verified; i++) {
  verified = await page.getByText('Verified Paid', { exact: true }).first().isVisible().catch(() => false);
  if (!verified) await page.waitForTimeout(2000);
}
step(verified ? `Verified Paid after ${Math.round((Date.now() - t0) / 1000)} s` : 'no Verified Paid');
await page.screenshot({ path: `${out}/2-cashier-receipt.png` });
const chain = await lib.view(CONTRACT, 'get_request', { id: requestId });
await browser.close();

const result = { kind: 'TAPLY_CASHIER_AUTO_VERIFY', network: 'near-testnet', base, contractId: CONTRACT, merchantAccountId: merchantId,
  payerAccountId: payerId, requestId, fundingTx: paid.hash, receiptOpenedByItself: opened, receiptUrlHasHint: new URL(receiptUrl).search.includes('ftx'),
  verifiedPaidShown: verified, chainStatus: chain.status, payout: chain.latestOperation, pageErrors, log };
writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 1));
if (!opened || !verified || chain.status !== 'FINAL_PAID') process.exit(1);
