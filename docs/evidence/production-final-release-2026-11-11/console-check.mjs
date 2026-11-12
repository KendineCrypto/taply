const { chromium } = await import(process.argv[2]);
const base = 'https://taplyapp.xyz';
const paths = ['/', '/wallet', '/wallet/create', '/wallet/restore', '/request/new', '/scan', '/protected/new', '/merchant', '/activity', '/contacts',
  '/pay/bdd31b860f90e5b1d3dab5dec2bb0ab9b97526daf933d0a0baacae192874b1c2', '/receipt/bdd31b860f90e5b1d3dab5dec2bb0ab9b97526daf933d0a0baacae192874b1c2', '/protected/' + (process.env.PROTECTED_ID ?? ''), '/this-page-does-not-exist'];
const browser = await chromium.launch();
const out = [];
for (const width of [390, 1280]) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 } });
  for (const p of paths) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
    const r = await page.goto(base + p, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => ({ status: () => 'ERR ' + e.message }));
    await page.waitForTimeout(2500);
    out.push({ width, path: p, status: r.status(), errors: errs });
    await page.close();
  }
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
