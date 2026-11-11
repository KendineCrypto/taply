// Real NEAR Testnet, real browser: create a Taply Wallet (username + 12 words),
// then pay two NEAR requests from it — one in NEAR, one with test USDC converted
// to NEAR — confirming every transaction in Taply's own confirmation dialog.
// The merchant is a disposable automation account (Node, near-api-js).
// Usage: node taply-wallet-pay-e2e.mjs <baseUrl> <outDir> <playwright module> <near-client testnet-e2e lib.mjs>
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const [base, out, pw, libPath] = process.argv.slice(2);
const { chromium, devices } = await import(pw);
const DEVICE = process.env.TAPLY_DEVICE ?? 'Pixel 7';
const lib = await import(libPath);
const CONTRACT = 'taply-pay-pilot-1.testnet';
const PASS = 'disposable-e2e';
const username = `taply-pay-${randomBytes(3).toString('hex')}`;
const accountId = `${username}.testnet`;
const NEAR = 10n ** 24n;

await lib.assertTestnet();
const merchantId = await lib.createFaucetAccount('taply-merchant');
const merchant = lib.loadAccount(merchantId);
async function createRequest(amount, memo) {
  const block = await lib.finalBlock();
  const { terms } = lib.buildTerms({ contractId: CONTRACT, creator: merchantId, amount, nowNs: block.timestampNs, memo });
  const quote = await lib.view(CONTRACT, 'quote_create_request', { terms });
  const r = await lib.call(merchant, CONTRACT, 'create_request', { terms, quoteVersion: quote.quoteVersion }, { deposit: BigInt(quote.depositYocto), gas: BigInt(quote.gas) });
  if (r.failure) throw new Error(r.failure);
  return terms.id;
}
const status = async (id) => (await lib.view(CONTRACT, 'get_request', { id })).status;
const waitStatus = async (id, want, tries = 60) => { for (let i = 0; i < tries; i++) { const s = await status(id); if (s === want) return s; await lib.sleep(2000); } return status(id); };
const balance = async (id) => BigInt((await lib.viewAccount(id)).amount);

const browser = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } } : {});
const page = await browser.newPage({ ...devices[DEVICE] });
page.on('pageerror', (e) => console.log('pageerror', e.message));
const confirms = [];
async function approveDialog(label) {
  const dialog = page.getByRole('dialog', { name: 'Confirm transaction' });
  await dialog.waitFor({ timeout: 90_000 });
  confirms.push({ label, text: (await dialog.innerText()).replace(/\s+/g, ' ').slice(0, 400) });
  await page.screenshot({ path: `${out}/confirm-${confirms.length}-${label}.png`, fullPage: true });
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 30_000 });
}

// 1) Create the wallet.
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

// 2) Pay 0.2 NEAR in NEAR.
const nearRequest = await createRequest(2n * NEAR / 10n, 'Taply Wallet pays in NEAR');
const m0 = await balance(merchantId);
await page.goto(`${base}/pay/${nearRequest}`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Connect wallet' }).click();
const unlock = page.getByRole('dialog', { name: 'Unlock Taply Wallet to pay' });
await unlock.getByLabel('Password').fill(PASS);
await unlock.getByRole('button', { name: /^Unlock$/ }).click();
await page.getByLabel('I checked the recipient account and the amount.').check({ timeout: 60_000 });
await page.screenshot({ path: `${out}/pay-near-review.png`, fullPage: true });
await page.getByRole('button', { name: 'Approve in wallet' }).click();
await approveDialog('pay-near');
const nearFinal = await waitStatus(nearRequest, 'FINAL_PAID');
const m1 = await balance(merchantId);
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/pay-near-after.png`, fullPage: true });

// 3) Pay 0.25 NEAR with test USDC.
const usdcRequest = await createRequest(25n * NEAR / 100n, 'Taply Wallet pays with test USDC');
const m1b = await balance(merchantId); // after the merchant paid for creating this request
await page.goto(`${base}/pay/${usdcRequest}`, { waitUntil: 'networkidle' });
const connect = page.getByRole('button', { name: 'Connect wallet' });
if (await connect.isVisible().catch(() => false)) {
  await connect.click();
  const u = page.getByRole('dialog', { name: 'Unlock Taply Wallet to pay' });
  if (await u.isVisible().catch(() => false)) { await u.getByLabel('Password').fill(PASS); await u.getByRole('button', { name: /^Unlock$/ }).click(); }
}
await page.getByRole('button', { name: 'USDC', exact: true }).click({ timeout: 60_000 });
await page.getByRole('button', { name: 'Enable test USDC' }).click({ timeout: 60_000 });
await approveDialog('register-usdc');
await page.getByRole('button', { name: /Get test USDC/ }).click({ timeout: 120_000 });
await approveDialog('buy-usdc');
await page.getByRole('button', { name: /Step 1 of 2 · Convert/ }).click({ timeout: 120_000 });
await approveDialog('convert-usdc');
await page.getByText(/Converted\. You now hold the NEAR/).waitFor({ timeout: 120_000 });
await page.screenshot({ path: `${out}/pay-usdc-converted.png`, fullPage: true });
await page.getByLabel('I checked the recipient account and the amount.').check();
await page.getByRole('button', { name: 'Approve in wallet' }).click();
await approveDialog('pay-after-convert');
const usdcFinal = await waitStatus(usdcRequest, 'FINAL_PAID');
const m2 = await balance(merchantId);
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/pay-usdc-after.png`, fullPage: true });
await browser.close();

const result = {
  kind: 'TAPLY_WALLET_BROWSER_SIGNING_TESTNET_PROOF', network: 'near-testnet', base, device: `${DEVICE} (Chromium device emulation: Android Chrome user agent, viewport and touch; not a physical phone)`,
  userAgent: devices[DEVICE].userAgent,
  note: 'Real Chromium + Taply Wallet (in-app key, owner decision 2026-11-09, no independent security review). Merchant is a disposable automation account. Test USDC has no real value.',
  payerAccountId: accountId, merchantAccountId: merchantId,
  nearPayment: { requestId: nearRequest, amountYocto: (2n * NEAR / 10n).toString(), finalStatus: nearFinal, merchantDeltaYocto: (m1 - m0).toString(),
    payout: (await lib.view(CONTRACT, 'get_request', { id: nearRequest })).latestOperation },
  usdcPayment: { requestId: usdcRequest, amountYocto: (25n * NEAR / 100n).toString(), finalStatus: usdcFinal, merchantDeltaYocto: (m2 - m1b).toString(),
    payout: (await lib.view(CONTRACT, 'get_request', { id: usdcRequest })).latestOperation },
  confirmations: confirms,
};
writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 1));
if (nearFinal !== 'FINAL_PAID' || usdcFinal !== 'FINAL_PAID') process.exit(1);
