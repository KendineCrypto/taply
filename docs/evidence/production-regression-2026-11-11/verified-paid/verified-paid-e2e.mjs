// Production: pay a NEAR request with Taply Wallet, then open its receipt on the
// SAME phone and wait for "Verified Paid" (the receipt verifier checks the funding,
// transfer and callback receipts). Then: reload keeps the outcome, the paid request
// offers no second payment, and a direct second pay_instant_native is refused on chain.
// Usage: node verified-paid-e2e.mjs <baseUrl> <outDir> <playwright module> <near-client testnet-e2e lib.mjs>
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const [base, out, pw, libPath] = process.argv.slice(2);
const { chromium } = await import(pw);
const lib = await import(libPath);
const CONTRACT = 'taply-pay-pilot-1.testnet';
const PASS = 'disposable-e2e';
const username = `taply-verify-${randomBytes(3).toString('hex')}`;
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

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
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

// 2) Pay 0.05 NEAR.
const requestId = await createRequest(5n * NEAR / 100n, 'Taply production Verified Paid check');
const m0 = await balance(merchantId);
await page.goto(`${base}/pay/${requestId}`, { waitUntil: 'networkidle' });
const connect = page.getByRole('button', { name: 'Connect wallet' });
if (await connect.isVisible().catch(() => false)) {
  await connect.click();
  const u = page.getByRole('dialog', { name: 'Unlock Taply Wallet to pay' });
  if (await u.isVisible({ timeout: 5_000 }).catch(() => false)) { await u.getByLabel('Password').fill(PASS); await u.getByRole('button', { name: /^Unlock$/ }).click(); }
}
await page.getByLabel('I checked the recipient account and the amount.').check({ timeout: 60_000 });
await page.getByRole('button', { name: 'Approve in wallet' }).click();
await approveDialog('pay');
const finalStatus = await waitStatus(requestId, 'FINAL_PAID');
const m1 = await balance(merchantId);
await page.getByText('Payment recorded').first().waitFor({ timeout: 60_000 });

// 3) Verify the receipt on the same phone.
// Newer builds open the receipt by themselves after paying; older ones offer a button.
let openedBy = 'app';
if (!/\/receipt\//.test(page.url())) {
  const verify = page.getByRole('link', { name: /Check receipt|Verify receipt/ }).or(page.getByRole('button', { name: /Check receipt|Verify receipt/ })).first();
  const appeared = await page.waitForURL(/\/receipt\//, { timeout: 15_000 }).then(() => true, () => false);
  if (!appeared) {
    try {
      await verify.click({ timeout: 60_000 });
      openedBy = 'button';
    } catch (e) {
      await page.screenshot({ path: `${out}/no-receipt-button.png`, fullPage: true });
      writeFileSync(`${out}/no-receipt-button.txt`, `${page.url()}\n${(await page.locator('main').innerText().catch(() => ''))}`);
      throw e;
    }
  }
}
await page.waitForURL(/\/receipt\//, { timeout: 60_000 });
const receiptUrl = page.url();
let verified = false;
for (let i = 0; i < 90 && !verified; i++) {
  verified = await page.getByText('Verified Paid', { exact: true }).first().isVisible().catch(() => false);
  if (!verified) await page.waitForTimeout(2000);
}
const archived = await page.getByText(/Archived record/).first().isVisible().catch(() => false);
await page.screenshot({ path: `${out}/receipt.png`, fullPage: true });

// 4) Reload: the outcome stays, and no second payment is offered.
await page.goto(`${base}/pay/${requestId}`, { waitUntil: 'networkidle' });
await page.getByText('Payment recorded').first().waitFor({ timeout: 60_000 });
await page.waitForTimeout(3000);
const approveOffered = await page.getByRole('button', { name: 'Approve in wallet' }).isVisible().catch(() => false);
await page.screenshot({ path: `${out}/after-reload.png`, fullPage: true });
await browser.close();

// 5) A second payment straight to the contract (no UI) is refused and moves nothing.
const second = await lib.call(merchant, CONTRACT, 'pay_instant_native',
  { id: requestId, expectedTermsHash: (await lib.view(CONTRACT, 'get_request', { id: requestId })).termsHash },
  { deposit: 5n * NEAR / 100n, gas: 50n * 10n ** 12n });
const statusAfter = await status(requestId);

const result = {
  kind: 'TAPLY_PRODUCTION_VERIFIED_PAID_CHECK', network: 'near-testnet', base, atUtc: new Date().toISOString(),
  payerAccountId: accountId, merchantAccountId: merchantId, requestId, finalStatus,
  merchantDeltaYocto: (m1 - m0).toString(), receiptPath: new URL(receiptUrl).pathname, receiptOpenedBy: openedBy, receiptHasFundingTx: new URL(receiptUrl).searchParams.has('ftx'),
  verifiedPaidShown: verified, archivedRecordShown: archived, approveOfferedAfterReload: approveOffered,
  secondPayRefused: second.failure !== null && second.failure !== undefined, secondPayTx: second.hash, secondPayFailure: second.failure ?? null, statusAfterSecondPay: statusAfter,
  confirmations: confirms,
};
writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, confirmations: confirms.length }, null, 1));
if (finalStatus !== 'FINAL_PAID' || !verified || approveOffered || !result.secondPayRefused) process.exit(1);
