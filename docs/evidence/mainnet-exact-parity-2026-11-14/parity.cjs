// usage: node parity.cjs <name> <base> <prefix> <outdir>
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const [name, base, prefix, out] = process.argv.slice(2);
const viewports = [['390', { width: 390, height: 844 }], ['375', { width: 375, height: 812 }], ['desktop', { width: 1280, height: 900 }]];
(async () => {
  const browser = await chromium.launch();
  for (const [vp, size] of viewports) {
    const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: vp === 'desktop' ? 1 : 2, locale: 'en-US' });
    const page = await ctx.newPage();
    const shot = async (label) => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${vp}-${label}-${name}.png` }); };
    const go = async (path) => { await page.goto(base + prefix + path, { waitUntil: 'networkidle', timeout: 30000 }); };
    try {
      await go(prefix ? '' : '/'); await shot('01-first-launch');
      await page.getByRole('button', { name: /^Tap$/ }).first().click(); await page.waitForTimeout(1500); await shot('02-tap-sheet'); await page.keyboard.press('Escape');
      await go('/send'); await shot('03-send');
      await go('/receive'); await shot('04-receive');
      await go('/scan'); await shot('05-scan');
      await page.getByRole('button', { name: /Scan QR|QR/i }).first().click().catch(() => {}); await page.waitForTimeout(1200); await shot('06-scanner');
      await go('/request/new'); await shot('07-request-new');
      await go('/gift/new'); await shot('08-gift');
      await go('/activity'); await shot('09-activity');
      for (const [label, path] of [['12-merchant','/merchant'],['13-protected','/protected/new'],['14-contacts','/contacts'],['15-split','/split'],['16-recurring','/recurring'],['17-settings','/settings'],['18-wallet','/wallet']]) { await go(path); await shot(label); }
      if (prefix) {
        await go(''); await page.locator('summary', { hasText: /Network details|Ağ ayrıntıları/ }).click();
        for (const [label, fx] of [['10-pay-open', 'usdc-awaiting'], ['11-pay-final-paid', 'usdc-recorded']]) {
          const href = await page.locator('[data-testid=fixture-list] a', { hasText: fx }).getAttribute('href');
          const q = await ctx.newPage(); await q.goto(base + href, { waitUntil: 'networkidle' }); await q.waitForTimeout(1200);
          await q.screenshot({ path: `${out}/${vp}-${label}-${name}.png`, fullPage: true }); await q.close();
        }
      } else {
        await go('/demo'); await shot('10-demo');
      }
    } catch (e) { console.log(name, vp, 'error', e.message.split('\n')[0]); }
    await ctx.close();
  }
  await browser.close();
})();
