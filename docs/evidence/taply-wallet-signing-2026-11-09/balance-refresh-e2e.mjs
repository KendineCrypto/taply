// Real browser + Testnet: after paying from Taply Wallet, the home balance updates
// WITHOUT a page reload (client-side navigation back to home).
// Usage: node balance-refresh-e2e.mjs <baseUrl> <outDir> <playwright module> <near-client testnet-e2e lib.mjs>
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const [base, out, pw, libPath] = process.argv.slice(2);
const { chromium } = await import(pw);
const lib = await import(libPath);
const CONTRACT = 'taply-pay-pilot-1.testnet';
const PASS = 'disposable-e2e';
await lib.assertTestnet();
const merchantId = await lib.createFaucetAccount('taply-merchant');
const merchant = lib.loadAccount(merchantId);
const block = await lib.finalBlock();
const { terms } = lib.buildTerms({ contractId: CONTRACT, creator: merchantId, amount: 10n ** 24n, nowNs: block.timestampNs, memo: 'balance refresh check' });
const quote = await lib.view(CONTRACT, 'quote_create_request', { terms });
const created = await lib.call(merchant, CONTRACT, 'create_request', { terms, quoteVersion: quote.quoteVersion }, { deposit: BigInt(quote.depositYocto), gas: BigInt(quote.gas) });
if (created.failure) throw new Error(created.failure);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const username = `taply-bal-${randomBytes(3).toString('hex')}`;
await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.getByRole('link', { name: /Choose a username/ }).click();
await page.waitForURL('**/wallet/create'); await page.waitForLoadState('networkidle');
const cont = page.getByRole('button', { name: /Continue/ });
for (let i = 0; i < 20 && await cont.isDisabled(); i++) { for (const b of await page.getByRole('checkbox').all()) if (!(await b.isChecked())) await b.click(); await page.waitForTimeout(300); }
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
const balanceText = async () => (await page.locator('#taply-identity-title').locator('xpath=ancestor::section').innerText()).replace(/\s+/g, ' ').match(/Testnet balance\s*([0-9.,]+)\s*NEAR/)?.[1] ?? null;
await page.getByText('Active on NEAR Testnet').first().waitFor({ timeout: 60_000 });
const before = await balanceText();

// Pay 1 NEAR, then go home with the bottom navigation (no reload).
await page.goto(`${base}/pay/${terms.id}`, { waitUntil: 'networkidle' });
const connect = page.getByRole('button', { name: 'Connect wallet' }).first();
if (await connect.isVisible().catch(() => false)) {
  await connect.click();
  const u = page.getByRole('dialog', { name: 'Unlock Taply Wallet to pay' });
  await u.getByLabel('Password').fill(PASS); await u.getByRole('button', { name: /^Unlock$/ }).click();
}
await page.getByLabel('I checked the recipient account and the amount.').check({ timeout: 60_000 });
await page.getByRole('button', { name: 'Approve in wallet' }).click();
const dialog = page.getByRole('dialog', { name: 'Confirm transaction' });
await dialog.waitFor({ timeout: 90_000 });
await dialog.getByRole('button', { name: 'Confirm' }).click();
await page.getByText('Payment recorded').first().waitFor({ timeout: 120_000 });
await page.getByRole('link', { name: 'Wallet' }).first().click();
await page.waitForURL(base + '/');
let after = before;
for (let i = 0; i < 20 && after === before; i++) { await page.waitForTimeout(500); after = await balanceText(); }
await page.screenshot({ path: `${out}/balance-after-payment.png`, fullPage: true });
const chain = (Number(BigInt((await lib.viewAccount(`${username}.testnet`)).amount) / 10n ** 20n) / 10_000).toFixed(4);
await browser.close();
const result = { kind: 'TAPLY_WALLET_BALANCE_REFRESH_BROWSER_PROOF', base, payer: `${username}.testnet`, requestId: terms.id, homeBefore: before, homeAfter: after, chainNow: chain, updatedWithoutReload: before !== after };
writeFileSync(`${out}/balance-refresh-result.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 1));
if (!result.updatedWithoutReload) process.exit(1);
