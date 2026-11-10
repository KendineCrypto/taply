// Live Handshake, real browsers + real NEAR Testnet (+ the configured room store).
// Merchant and customer are separate browser contexts (two phones):
//  1) merchant creates a request in the app; the QR carries /s/<room>#j=<token>
//  2) customer joins; merchant sees "joined · reviewing"; both see the same sale code
//  3) customer leaves → merchant sees "disconnected"; customer returns → "reconnected"
//  4) a third phone with the same QR is refused (already joined)
//  5) customer pays; both phones read "Payment recorded" from the chain
// Usage: node handshake-e2e.mjs <baseUrl> <outDir> <playwright module> <near-client testnet-e2e lib.mjs>
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const [base, out, pw, libPath] = process.argv.slice(2);
const { chromium } = await import(pw);
const lib = await import(libPath);
const CONTRACT = 'taply-pay-pilot-1.testnet';
const PASS = 'disposable-e2e';
await lib.assertTestnet();
const browser = await chromium.launch();
const log = [];
const step = (s) => { log.push({ atMs: Date.now(), step: s }); console.log('·', s); };

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
  return { ctx, page, accountId: `${username}.testnet` };
}
async function unlockIfAsked(page) {
  const connect = page.getByRole('button', { name: 'Connect wallet' }).first();
  if (await connect.isVisible().catch(() => false)) {
    await connect.click();
    const unlock = page.getByRole('dialog', { name: 'Unlock Taply Wallet to pay' });
    if (await unlock.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await unlock.getByLabel('Password').fill(PASS);
      await unlock.getByRole('button', { name: /^Unlock$/ }).click();
      await unlock.waitFor({ state: 'detached', timeout: 60_000 });
    }
  }
}
async function confirm(page) {
  const dialog = page.getByRole('dialog', { name: 'Confirm transaction' });
  await dialog.waitFor({ timeout: 90_000 });
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 60_000 });
}
const card = (page) => page.getByTestId('live-card');
const cardText = async (page) => (await card(page).innerText().catch(() => '')).replace(/\s+/g, ' ');
async function waitCard(page, re, label, timeout = 45_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { const t = await cardText(page); if (re.test(t)) { step(`${label}: "${t.match(re)[0]}"`); return t; } await page.waitForTimeout(500); }
  throw new Error(`${label}: timed out; card = ${await cardText(page)}`);
}

// 1) Merchant creates the request in the app.
const merchant = await newWallet('taply-shop');
step(`merchant wallet ${merchant.accountId}`);
await merchant.page.goto(base + '/request/new', { waitUntil: 'networkidle' });
await unlockIfAsked(merchant.page);
await merchant.page.locator('input[inputmode="decimal"]').first().fill('0.05');
await merchant.page.getByRole('button', { name: 'Continue' }).click();
await merchant.page.getByRole('button', { name: 'Create request in wallet' }).click({ timeout: 60_000 });
await confirm(merchant.page);
await merchant.page.waitForURL(/\/pay\/[0-9a-f]{64}/, { timeout: 120_000 });
const requestId = new URL(merchant.page.url()).pathname.split('/pay/')[1];
step(`request created ${requestId}`);
await waitCard(merchant.page, /Waiting for the customer to scan/, 'merchant sees');
const livePath = await merchant.page.locator('[data-live-path]').getAttribute('data-live-path');
const roomId = livePath.split('/s/')[1].split('#')[0];
await merchant.page.screenshot({ path: `${out}/1-merchant-waiting.png`, fullPage: true });

// 2) Customer joins from the QR link.
const customer = await newWallet('taply-buyer');
step(`customer wallet ${customer.accountId}`);
await customer.page.goto(base + livePath, { waitUntil: 'networkidle' });
await waitCard(customer.page, /Merchant\s*Online/, 'customer sees');
const customerUrlAfterJoin = customer.page.url();
const merchantJoined = await waitCard(merchant.page, /Customer\s*Reviewing the payment/, 'merchant sees');
const codeMerchant = (await cardText(merchant.page)).match(/sale code: ([A-Z0-9 ]+)/)?.[1]?.trim();
const codeCustomer = (await cardText(customer.page)).match(/sale code: ([A-Z0-9 ]+)/)?.[1]?.trim();
await merchant.page.screenshot({ path: `${out}/2-merchant-customer-joined.png`, fullPage: true });
await customer.page.screenshot({ path: `${out}/2-customer-joined.png`, fullPage: true });

// 3) Customer leaves → disconnected; returns → reconnected.
await customer.page.goto('about:blank');
step('customer left the page');
await waitCard(merchant.page, /Disconnected · last seen \d+ s ago/, 'merchant sees', 30_000);
await merchant.page.screenshot({ path: `${out}/3-merchant-customer-disconnected.png`, fullPage: true });
await customer.page.goto(`${base}/s/${roomId}`, { waitUntil: 'networkidle' });
await waitCard(merchant.page, /Customer reconnected/, 'merchant sees');

// 4) A third phone with the same QR is refused.
const intruder = await browser.newContext({ viewport: { width: 390, height: 844 } });
const ip = await intruder.newPage();
await ip.goto(base + livePath, { waitUntil: 'networkidle' });
await ip.getByTestId('live-failure').waitFor({ timeout: 30_000 });
const intruderCode = await ip.getByTestId('live-failure').getAttribute('data-code');
step(`third phone refused: ${intruderCode}`);
await ip.screenshot({ path: `${out}/4-third-phone-refused.png`, fullPage: true });
await intruder.close();

// 5) Customer pays in the live session; both phones read the chain.
await unlockIfAsked(customer.page);
await customer.page.getByLabel('I checked the recipient account and the amount.').check({ timeout: 60_000 });
await customer.page.getByRole('button', { name: 'Approve in wallet' }).click();
await confirm(customer.page);
step('customer confirmed the payment');
let chain = null;
for (let i = 0; i < 60; i++) { chain = await lib.view(CONTRACT, 'get_request', { id: requestId }); if (chain.status === 'FINAL_PAID') break; await lib.sleep(2000); }
step(`chain: ${chain.status}`);
await merchant.page.getByText('Payment recorded').first().waitFor({ timeout: 60_000 });
await customer.page.getByText('Payment recorded').first().waitFor({ timeout: 60_000 });
step('both phones show "Payment recorded" (from the chain)');
await merchant.page.screenshot({ path: `${out}/5-merchant-paid.png`, fullPage: true });
await customer.page.screenshot({ path: `${out}/5-customer-paid.png`, fullPage: true });
await browser.close();

const result = {
  kind: 'TAPLY_LIVE_HANDSHAKE_TWO_BROWSER_TESTNET_PROOF', base, requestId, roomId,
  merchantAccountId: merchant.accountId, customerAccountId: customer.accountId,
  sameSaleCode: codeMerchant !== undefined && codeMerchant === codeCustomer, saleCode: codeMerchant,
  joinSecretRemovedFromUrl: !customerUrlAfterJoin.includes('#j='),
  merchantSawJoined: /Reviewing the payment/.test(merchantJoined),
  thirdPhone: intruderCode,
  chainStatus: chain.status, payout: chain.latestOperation,
  steps: log,
};
writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 1));
if (chain.status !== 'FINAL_PAID' || intruderCode !== 'ALREADY_JOINED' || !result.sameSaleCode || !result.joinSecretRemovedFromUrl) process.exit(1);
