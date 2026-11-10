// Merchant QR stays the same + the in-app scanner opens a live-session QR.
// Real browsers, real NEAR Testnet, real Redis (via the REST shim).
//  1) merchant creates a request; the QR content is sampled every 250 ms for 15 s
//     and must never change once drawn (it used to flip /pay/<id> -> /s/<room> after ~1 s)
//  2) the QR image is fed to a second browser as its camera; Taply's own scanner
//     must open /s/<room> (it used to say "not a Taply payment request")
//  3) the customer pays; the chain says FINAL_PAID
// Usage: node qr-stable-e2e.mjs <baseUrl> <outDir> <playwright module> <near-client testnet-e2e lib.mjs>
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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

async function newWallet(prefix, b = browser) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera'] });
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


// 1) Merchant creates the request, then the QR is watched.
const merchant = await newWallet('taply-qr-shop');
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
const samples = [];
const t0 = Date.now();
while (Date.now() - t0 < 15_000) {
  const label = await merchant.page.locator('svg[data-qr-version]').first().getAttribute('aria-label', { timeout: 200 }).catch(() => null);
  const value = label === null ? null : label.slice(label.indexOf(': ') + 2);
  if (samples.length === 0 || samples.at(-1).value !== value) { samples.push({ atMs: Date.now() - t0, value }); step(`QR at +${Date.now() - t0} ms: ${value ?? '(not drawn yet)'}`); }
  await merchant.page.waitForTimeout(250);
}
const drawn = samples.filter((s) => s.value !== null).map((s) => s.value);
const qrValue = drawn[0];
const qrNeverChanged = drawn.length === 1;
await merchant.page.screenshot({ path: `${out}/1-merchant-qr.png`, fullPage: true });

// 2) Feed the QR to a second browser's camera and scan it with Taply's scanner.
// Centre the QR so the fixed bottom bar does not cover it in the capture.
await merchant.page.locator('svg[data-qr-version]').first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
await merchant.page.locator('svg[data-qr-version]').first().screenshot({ path: `${out}/qr.png` });
execFileSync('python3', ['-I', '-c', `
from PIL import Image
qr = Image.open(${JSON.stringify(out + '/qr.png')}).convert('RGB')
frame = Image.new('RGB', (640, 480), (244, 243, 232)); frame.paste(qr, ((640 - qr.width) // 2, (480 - qr.height) // 2))
import io
buf = io.BytesIO(); frame.save(buf, 'JPEG', quality=92); data = buf.getvalue()
open(${JSON.stringify(out + '/camera.mjpeg')}, 'wb').write(data * 30)
`]);
const camBrowser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${out}/camera.mjpeg`] });
const customer = await newWallet('taply-qr-buyer', camBrowser);
step(`customer wallet ${customer.accountId}`);
await customer.page.goto(base + '/scan', { waitUntil: 'networkidle' });
await customer.page.getByRole('button', { name: /Scan QR/ }).first().click();
await customer.page.waitForURL(/\/s\/[A-Za-z0-9_-]{22}/, { timeout: 60_000 });
const scannedTo = customer.page.url();
step(`scanner opened ${new URL(scannedTo).pathname}`);
await customer.page.getByTestId('live-card').waitFor({ timeout: 45_000 });
for (let i = 0; i < 60 && !/Reviewing the payment/.test(await merchant.page.getByTestId('live-card').innerText()); i++) await merchant.page.waitForTimeout(500);
const merchantSawJoined = /Reviewing the payment/.test(await merchant.page.getByTestId('live-card').innerText());
step(`merchant sees customer reviewing: ${merchantSawJoined}`);
await customer.page.screenshot({ path: `${out}/2-customer-after-scan.png`, fullPage: true });

// 3) Customer pays; the chain decides.
await unlockIfAsked(customer.page);
await customer.page.getByLabel('I checked the recipient account and the amount.').check({ timeout: 60_000 });
await customer.page.getByRole('button', { name: 'Approve in wallet' }).click();
await confirm(customer.page);
let chain = null;
for (let i = 0; i < 60; i++) { chain = await lib.view(CONTRACT, 'get_request', { id: requestId }); if (chain.status === 'FINAL_PAID') break; await lib.sleep(2000); }
step(`chain: ${chain.status}`);
await merchant.page.getByText('Payment recorded').first().waitFor({ timeout: 60_000 });
await merchant.page.screenshot({ path: `${out}/3-merchant-paid.png`, fullPage: true });
await browser.close(); await camBrowser.close();

const result = {
  kind: 'TAPLY_MERCHANT_QR_STABLE_AND_SCANNABLE_PROOF', base, requestId,
  merchantAccountId: merchant.accountId, customerAccountId: customer.accountId,
  qrSamples: samples, qrNeverChanged, qrIsLiveLink: /\/s\/[A-Za-z0-9_-]{22}#j=/.test(qrValue ?? ''),
  scannerOpened: new URL(scannedTo).pathname, merchantSawJoined,
  chainStatus: chain.status, payout: chain.latestOperation, steps: log,
};
writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, steps: undefined }, null, 1));
if (!qrNeverChanged || !result.qrIsLiveLink || !merchantSawJoined || chain.status !== 'FINAL_PAID') process.exit(1);
