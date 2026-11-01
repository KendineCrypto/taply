// Synthetic desktop Chromium only; this does not establish iOS/Android support.
// Install playwright@1.64.1 outside the workspace, then pass its index.mjs path:
// node --experimental-transform-types apps/web/scripts/phase6b-browser-smoke.mjs <playwright/index.mjs>
// Serve a production Webpack build on http://127.0.0.1:3206 first. No signing.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { encodeQr } from '../src/lib/qr/encode.ts';

const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const base = 'http://127.0.0.1:3206';
const id = 'a'.repeat(64);
const browser = await chromium.launch({ executablePath: process.env.TAPLY_REVIEW_CHROMIUM ?? chromium.executablePath(), headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', locale: 'en-US' });
context.setDefaultTimeout(15_000);
context.setDefaultNavigationTimeout(15_000);
const posts = [];
const blocked = [];
await context.route('**/*', (route) => {
  const req = route.request();
  if (req.method() !== 'GET') posts.push(req.url());
  if (new URL(req.url()).origin !== base) { blocked.push(req.url()); return route.abort(); }
  return route.continue();
});
await context.addInitScript(() => {
  window.BarcodeDetector = undefined; // Exercise the bundled iOS-style path.
  window.review = { streams: [], workers: 0, terminated: 0, posted: 0,
    frame: { modules: [], inverted: false, noise: false }, deny: false };
  const OriginalWorker = window.Worker;
  window.Worker = class extends OriginalWorker {
    stopped = false;
    constructor(...args) { super(...args); window.review.workers++; }
    postMessage(...args) { window.review.posted++; super.postMessage(...args); }
    terminate() { if (!this.stopped) { this.stopped = true; window.review.terminated++; } super.terminate(); }
  };
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    if (window.review.deny) throw new DOMException('synthetic denial', 'NotAllowedError');
    let stream;
    if (window.review.frame === null) stream = await original(constraints);
    else {
      const { modules, inverted, noise } = window.review.frame;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 640;
      const ctx = canvas.getContext('2d');
      if (noise) {
        const image = ctx.createImageData(640, 640);
        let seed = 0x12345678;
        for (let i = 0; i < image.data.length; i += 4) {
          seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
          image.data[i] = image.data[i + 1] = image.data[i + 2] = seed & 255; image.data[i + 3] = 255;
        }
        ctx.putImageData(image, 0, 0);
      } else {
        const scale = Math.floor(640 / (modules.length + 8));
        const offset = Math.floor((640 - modules.length * scale) / 2);
        ctx.fillStyle = inverted ? '#0b120e' : '#f4f3e8'; ctx.fillRect(0, 0, 640, 640);
        ctx.fillStyle = inverted ? '#f4f3e8' : '#0b120e';
        modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) ctx.fillRect(offset + x * scale, offset + y * scale, scale, scale); }));
      }
      stream = canvas.captureStream(10);
    }
    window.review.streams.push(stream);
    return stream;
  };
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const opened = () => page.locator('dialog.taply-scanner[open]').waitFor();
const allStopped = () => page.waitForFunction(() => window.review.streams.every((s) => s.getTracks().every((t) => t.readyState === 'ended')));
const frame = async (text, inverted = false, noise = false) => page.evaluate((value) => { window.review.frame = value; },
  { modules: text ? encodeQr(text, 'M').modules : [], inverted, noise });
const results = [];
try {
  await page.goto(`${base}/scan`);
  assert.equal(await page.evaluate(() => window.review.streams.length), 0);
  await page.getByRole('button', { name: /^Scan QR/ }).click();
  await opened();
  await page.waitForFunction(() => window.review.posted > 0);
  assert.equal(await page.locator('dialog.taply-scanner').getAttribute('data-motion'), 'reduced');
  assert.equal(await page.locator('.scan-beam').evaluate((beam) => getComputedStyle(beam).animationName), 'none');
  assert.equal(await page.evaluate(() => document.querySelector('dialog.taply-scanner').contains(document.activeElement)), true);
  await page.getByRole('button', { name: 'Close scanner', exact: true }).click();
  await allStopped();
  assert.equal(await page.evaluate(() => window.review.workers === window.review.terminated), true);
  results.push('Explicit camera entry, reduced motion, synthetic canvas camera track stop, worker termination');

  await frame(`${base}/pay/${id}`, true);
  let navigations = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame() && f.url() === `${base}/pay/${id}`) navigations++; });
  await page.getByRole('button', { name: /^Scan QR/ }).click();
  await page.waitForURL(`${base}/pay/${id}`);
  await allStopped();
  assert.equal(navigations, 1);
  assert.equal(await page.evaluate(() => window.review.workers === window.review.terminated), true);
  results.push('Real emitted worker decodes inverted QR; one local navigation; camera/worker stop on success');

  await page.goto(`${base}/scan`);
  await frame(`https://untrusted.invalid/pay/${id}`);
  await page.getByRole('button', { name: /^Scan QR/ }).click();
  await page.waitForFunction(() => document.querySelector('.scan-status')?.textContent.includes('not to this Taply app'));
  assert.equal(page.url(), `${base}/scan`);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await allStopped();
  await page.getByRole('button', { name: 'Resume camera', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.review.workers === window.review.terminated), true);
  await page.getByRole('button', { name: 'Close scanner', exact: true }).click();
  results.push('Untrusted host rejected; synthetic pagehide synchronously releases camera/worker and requires resume');

  await frame(null, false, true);
  const postedBeforeNoise = await page.evaluate(() => window.review.posted);
  await page.getByRole('button', { name: /^Scan QR/ }).click();
  await page.waitForFunction((before) => window.review.posted > before, postedBeforeNoise);
  const responsiveness = await page.evaluate(async () => {
    let ticks = 0;
    const start = performance.now();
    const timer = setInterval(() => ticks++, 10);
    await new Promise((resolve) => setTimeout(resolve, 250));
    clearInterval(timer);
    return { ticks, elapsedMs: +(performance.now() - start).toFixed(1) };
  });
  assert.ok(responsiveness.ticks >= 5, 'main thread must remain responsive while decoding noise');
  await page.getByRole('button', { name: 'Close scanner', exact: true }).click();
  await allStopped();
  results.push({ noiseResponsiveness: responsiveness });

  assert.deepEqual(posts, [], 'no image uploads or transaction/RPC POSTs allowed in this smoke');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ scope: 'Synthetic desktop Chromium; not physical mobile compatibility', browser: browser.version(), results, nonGetRequests: posts.length, blockedExternalRequests: blocked.length, pageErrors: errors }, null, 2));
} catch (error) {
  console.error(JSON.stringify(await page.evaluate(() => ({
    phase: document.querySelector('[data-phase]')?.getAttribute('data-phase'),
    status: document.querySelector('.scan-status')?.textContent,
    streams: window.review.streams.length, workers: window.review.workers,
    terminated: window.review.terminated, posted: window.review.posted,
    video: [...document.querySelectorAll('video')].map((v) => ({ readyState: v.readyState, paused: v.paused })),
  }))));
  console.error(JSON.stringify({ errors }));
  throw error;
} finally {
  await browser.close();
}
