// Local production UX QA. All external requests are blocked. Demo screenshots are synthetic.
// Usage: node apps/web/scripts/phase7i-qa.mjs <playwright/index.mjs>
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const base = 'http://127.0.0.1:3219';
const out = 'apps/web/docs/screenshots/phase7i';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [], errors = [];
let fixtureScreens = 0;
const routes = {
 home: '/', wallet: '/wallet', activity: '/activity', merchant: '/merchant',
 sale: '/merchant/register', checkout: '/checkout/shop.testnet', request: '/request/new',
 'invalid-payment': '/pay/invalid',
 ...Object.fromEntries(['receive', 'send', 'create', 'share', 'review', 'progress', 'receipt'].map(s => ['demo-'+s, '/demo?step='+s])),
};
for (const locale of ['en', 'tr']) for (const width of [360, 390, 1280]) {
 const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
 await context.addCookies([{ name: 'taply_locale', value: locale, url: base }]);
 await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
 const page = await context.newPage();
 page.on('pageerror', e => errors.push(e.message));
 for (const [name, route] of Object.entries(routes)) {
  await page.goto(base+route); await page.waitForTimeout(200);
  const audit = await page.evaluate(() => {
   const visible = el => el.checkVisibility({ checkVisibilityCSS: true }) && !el.closest('.sr-only') && !el.classList.contains('sr-only');
   const controls = [...document.querySelectorAll('main button, main a, main summary, main input')].filter(visible);
   return {
    overflow: document.documentElement.scrollWidth-innerWidth,
    words: (document.querySelector('main')?.innerText || '').trim().split(/\s+/).length,
    small: controls.filter(e => e.getBoundingClientRect().height < 44 && e.getBoundingClientRect().height > 0 && e.type !== 'checkbox').map(e => ({ text: (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0,50), height: e.getBoundingClientRect().height })),
    unnamed: controls.filter(e => !(e.getAttribute('aria-label') || e.textContent?.trim() || e.getAttribute('title') || e.labels?.length)).map(e=>e.tagName),
   };
  });
  results.push({locale,width,name,...audit});
  if ((width===390 && locale==='en') || (width===360 && locale==='tr') || (width===1280 && name==='checkout')) await page.screenshot({path:`${out}/${locale}-${name}-${width}.png`,fullPage:true});
  if(name==='checkout') {
   const summary=page.locator('summary').first();await summary.focus(); await page.keyboard.press('Enter');
   if(!await page.locator('details').first().getAttribute('open').then(x=>x!==null)) throw Error('Keyboard disclosure failed');
  }
 }
 await context.close();
}
// Optional isolated SSR fixtures generated from SharedSession, labelled synthetic.
const fixturePath = 'apps/web/.next/phase7i-fixtures.json';
if (existsSync(fixturePath)) {
 const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8'));
 for (const width of [360, 390, 1280]) {
  const page = await browser.newPage({viewport:{width,height:844},reducedMotion:'reduce'});
  await page.goto(base+'/demo');
  const styles = await page.locator('link[rel="stylesheet"]').evaluateAll(els=>els.map(el=>el.href));
  for (const fixture of fixtures) {
   await page.setContent(`<html lang="${fixture.locale}"><head>${styles.map(h=>`<link rel="stylesheet" href="${h}">`).join('')}</head><body><main style="max-width:480px;margin:auto;padding:16px"><p style="padding:12px;color:#eebd80">DEMO · Synthetic UI fixture · No chain evidence</p>${fixture.html}</main></body></html>`);
   await page.evaluate(() => window.scrollTo(0, 0));
   await page.waitForTimeout(150);
   const overflow = await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
   if(overflow>0) throw Error(`Fixture overflow: ${fixture.stage} ${width}`);
   fixtureScreens++;
   await page.screenshot({path:`${out}/${fixture.locale}-fixture-${fixture.stage}-${width}.png`,fullPage:true});
   await page.locator('summary').focus(); await page.keyboard.press('Enter');
   if(await page.locator('details').getAttribute('open')===null) throw Error('Fixture keyboard disclosure failed');
  }
  await page.close();
 }
}
await browser.close();
writeFileSync(`${out}/qa.json`, JSON.stringify({mode:'offline production UI; DEMO is synthetic; no signing or chain proof',results,fixtureScreens,errors},null,2));
console.log(JSON.stringify({screens:results.length,fixtureScreens,overflow:results.filter(r=>r.overflow>0),small:results.filter(r=>r.small.length),unnamed:results.filter(r=>r.unnamed.length),errors},null,2));
