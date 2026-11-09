// Real NEAR Testnet: create a username.testnet Taply Wallet with a 12-word Secret
// Recovery Phrase (no backup file), then import the same phrase in a fresh browser.
// Usage: node phrase-e2e.mjs <baseUrl> <outDir> [playwright module path]
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const [base = 'http://localhost:3100', out = '.', pw = 'playwright'] = process.argv.slice(2);
const { chromium } = await import(pw);
const username = `taply-srp-${randomBytes(3).toString('hex')}`;
const accountId = `${username}.testnet`;
const PASS = 'disposable-e2e';
const rpc = async (method, params) => (await (await fetch('https://rpc.testnet.near.org', { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json());
const b58 = (hex) => { const a = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; let n = BigInt('0x' + hex), s = '';
  while (n > 0n) { s = a[Number(n % 58n)] + s; n /= 58n; } return 'ed25519:' + s; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
const page = await ctx.newPage();
const downloads = [];
page.on('download', (d) => downloads.push(d.suggestedFilename()));
page.on('pageerror', (e) => console.log('pageerror', e.message));

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
await page.getByText('Step 3 of 4').waitFor({ timeout: 30_000 });
await page.getByLabel('Password', { exact: true }).fill(PASS);
await page.getByLabel('Confirm password').fill(PASS);
await page.screenshot({ path: `${out}/11-password.png`, fullPage: true });
await page.getByRole('button', { name: /Create wallet/ }).click();
await page.getByRole('heading', { name: 'Your Secret Recovery Phrase' }).waitFor({ timeout: 60_000 });
await page.screenshot({ path: `${out}/12-phrase-hidden.png`, fullPage: true });
await page.getByRole('button', { name: 'Tap to reveal' }).click();
const words = (await page.getByRole('list', { name: 'Your Secret Recovery Phrase' }).getByRole('listitem').allInnerTexts())
  .map((t) => t.replace(/^\s*\d+\s*/, '').trim());
await page.getByRole('button', { name: 'Copy' }).click();
const copied = await page.evaluate(() => navigator.clipboard.readText());
// Screenshot with the words blurred again (never commit a revealed phrase image, even a disposable one).
await page.getByRole('button', { name: 'Hide' }).click();
await page.getByLabel('I saved my Secret Recovery Phrase').check();
await page.getByRole('button', { name: /Continue/ }).click();
await page.getByText(`${accountId} is live on NEAR Testnet`).waitFor({ timeout: 120_000 });
await page.screenshot({ path: `${out}/13-live.png`, fullPage: true });
const vault = JSON.parse(await page.evaluate(() => localStorage.getItem('taply.testnet-vault.v1')));
await page.getByRole('button', { name: 'Finish' }).click();
await page.waitForURL(base + '/');
await page.getByText('Active on NEAR Testnet').first().waitFor({ timeout: 30_000 });

const publicKey = b58(vault.publicKeyHex);
const keys = await rpc('query', { request_type: 'view_access_key_list', account_id: accountId, finality: 'final' });
const onChain = keys.result?.keys?.find((k) => k.public_key === publicKey)?.access_key?.permission ?? null;

// Fresh browser: import the same phrase.
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const p2 = await ctx2.newPage();
await p2.goto(base + '/wallet/restore', { waitUntil: 'networkidle' });
await p2.getByLabel('Recovery phrase').fill(words.join(' '));
await p2.getByLabel('Your account (username.testnet)').fill(username);
await p2.getByLabel('Create a password for this device').fill('second-device');
await p2.getByLabel('Confirm password').fill('second-device');
await p2.getByRole('button', { name: /Import wallet/ }).click();
await p2.waitForURL(base + '/', { timeout: 60_000 });
await p2.getByText('Active on NEAR Testnet').first().waitFor({ timeout: 30_000 });
await p2.screenshot({ path: `${out}/14-imported-home.png`, fullPage: true });
const vault2 = JSON.parse(await p2.evaluate(() => localStorage.getItem('taply.testnet-vault.v1')));

const result = { accountId, vaultVersion: vault.version, words: words.length, copiedMatches: copied === words.join(' '),
  publicKey, onChainPermission: onChain, importedSameKey: vault2.publicKeyHex === vault.publicKeyHex && vault2.accountId === accountId,
  backupDownloads: downloads.length, phraseInStorage: JSON.stringify(vault).includes(words[0] + ' ') };
writeFileSync(`${out}/phrase-result.json`, JSON.stringify(result, null, 2));
// The disposable phrase is written to stdout only for the cross-check below; it is never committed.
console.log(JSON.stringify({ ...result, phrase: words.join(' ') }));
await browser.close();
if (onChain !== 'FullAccess' || !result.importedSameKey || result.backupDownloads !== 0) process.exit(1);
