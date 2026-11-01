import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(resolve('apps/web/package.json'));
const viteRequire = createRequire(realpathSync(require.resolve('vitest/package.json')));
const { build, preview } = await import(pathToFileURL(viteRequire.resolve('vite')).href);
if (!process.env.TAPLY_PLAYWRIGHT_MODULE) throw Error('Set TAPLY_PLAYWRIGHT_MODULE to the isolated pinned Playwright index.mjs');
const { chromium, firefox, webkit, devices } = await import(pathToFileURL(resolve(process.env.TAPLY_PLAYWRIGHT_MODULE)).href);
const root = resolve('packages/near-client/browser-tests');
const outDir = resolve('contracts/payments/artifacts/browser-offline-bundle');
await build({ configFile: false, root, build: { outDir, emptyOutDir: false } });
const server = await preview({ configFile: false, root, build: { outDir },
  preview: { host: '127.0.0.1', port: 4181, strictPort: true } });
const results = [];
try {
  for (const [name, type, device] of [
    ['chromium-desktop', chromium, null], ['firefox-desktop', firefox, null], ['webkit-desktop', webkit, null],
    ['chromium-mobile-emulation', chromium, devices['Pixel 7']], ['webkit-mobile-emulation', webkit, devices['iPhone 13']],
  ]) {
    const browser = await type.launch({ headless: true });
    try {
      const context = await browser.newContext(device ?? {});
      const page = await context.newPage();
      // Only local test-module resources are allowed. No RPC/third-party requests.
      await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
      await page.goto('http://127.0.0.1:4181/index.html');
      await page.waitForFunction(() => window.__taplyWalletCheck !== undefined);
      const result = await page.evaluate(() => window.__taplyWalletCheck);
      results.push({ name, engineVersion: browser.version(), ...result });
      console.log(`${name}: ${result.failure ? 'FAIL ' + result.failure : 'PASS'} (${browser.version()})`);
      await context.close();
    } finally { await browser.close(); }
  }
} finally {
  await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
  await mkdir('contracts/payments/artifacts', { recursive: true });
  await writeFile('contracts/payments/artifacts/wallet-browser-results.json', JSON.stringify(results, null, 2));
}
if (results.length !== 5 || results.some(r => r.failure || !r.secureContext)) process.exitCode = 1;
