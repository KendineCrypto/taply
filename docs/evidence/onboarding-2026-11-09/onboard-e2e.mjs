// Real NEAR Testnet onboarding through the local production build.
// Usage: node onboard-e2e.mjs <baseUrl> <outDir>
import { chromium } from 'playwright';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const [base = 'http://localhost:3100', out = '.'] = process.argv.slice(2);
const username = `taply-onb-${randomBytes(3).toString('hex')}`;
const accountId = `${username}.testnet`;
const PASS = 'synthetic disposable onboarding passphrase 2026';
const rpc = async (method, params) => {
  const r = await fetch('https://rpc.testnet.near.org', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return r.json();
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const faucetCalls = [];
page.on('request', (req) => { if (req.url().includes('helper.testnet.near.org')) faucetCalls.push({ url: req.url(), body: req.postData() }); });
page.on('pageerror', (e) => console.log('pageerror', e.message));

await page.goto(base + '/');
await page.waitForLoadState('networkidle');
await page.getByRole('heading', { name: 'Welcome to Taply' }).waitFor({ timeout: 30_000 });
await page.screenshot({ path: `${out}/01-first-launch.png`, fullPage: true });
await page.getByRole('link', { name: /Choose a username/ }).click();
await page.waitForURL('**/wallet/create');
await page.waitForLoadState('networkidle');
const cont = page.getByRole('button', { name: /Continue/ });
for (let i = 0; i < 20 && await cont.isDisabled(); i++) {
  for (const box of await page.getByRole('checkbox').all()) { if (!(await box.isChecked())) await box.click(); }
  await page.waitForTimeout(300);
}
await page.getByRole('button', { name: /Continue/ }).click();
await page.getByRole('textbox', { name: 'Username' }).fill(username);
await page.getByRole('button', { name: /Continue/ }).click();
await page.getByText('Step 3 of 4').waitFor({ timeout: 30_000 });
await page.screenshot({ path: `${out}/02-passphrase.png`, fullPage: true });
await page.getByLabel('Passphrase', { exact: true }).fill(PASS);
await page.getByLabel('Repeat passphrase').fill(PASS);
await page.getByRole('button', { name: /Create wallet/ }).click();
await page.getByText(`${accountId} is live on NEAR Testnet`).waitFor({ timeout: 120_000 });
await page.screenshot({ path: `${out}/03-live.png`, fullPage: true });

const vault = JSON.parse(await page.evaluate(() => localStorage.getItem('taply.testnet-vault.v1')));
// Independent check: the account exists and lists the vault key with FullAccess at a final block.
const hex = vault.publicKeyHex;
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
let n = BigInt('0x' + hex); let enc = '';
while (n > 0n) { enc = alphabet[Number(n % 58n)] + enc; n /= 58n; }
const publicKey = `ed25519:${enc}`;
const account = await rpc('query', { request_type: 'view_account', account_id: accountId, finality: 'final' });
const keys = await rpc('query', { request_type: 'view_access_key_list', account_id: accountId, finality: 'final' });
const match = keys.result?.keys?.find((k) => k.public_key === publicKey);

const dl = page.waitForEvent('download');
await page.getByRole('button', { name: 'Download encrypted backup' }).click();
const file = await dl;
await page.getByLabel(/I saved the encrypted backup/).check();
await page.getByRole('button', { name: 'Finish' }).click();
await page.waitForURL(base + '/');
await page.getByText(accountId).first().waitFor({ timeout: 30_000 });
await page.getByText('Active on NEAR Testnet').first().waitFor({ timeout: 30_000 });
await page.screenshot({ path: `${out}/04-home-taply.png`, fullPage: true });

const result = {
  accountId, vaultAccountId: vault.accountId, publicKey,
  backupFile: file.suggestedFilename(),
  faucetCalls: faucetCalls.length,
  faucetBody: faucetCalls[0]?.body,
  chain: { amountYocto: account.result?.amount, blockHeight: account.result?.block_height, keyPermission: match?.access_key?.permission ?? null },
  vaultHasPrivate: Object.keys(vault).some((k) => /private|secret|seed/i.test(k)),
};
writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
if (match?.access_key?.permission !== 'FullAccess' || vault.accountId !== accountId) process.exit(1);
