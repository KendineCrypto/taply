// Synthetic Node/V8 benchmark only: no camera, browser compositor, mobile CPU
// or thermal throttling. Run with pinned Node 24:
// node --experimental-transform-types apps/web/scripts/phase6b-qr-benchmark.mjs
import jsQR from 'jsqr';
import { encodeQr } from '../src/lib/qr/encode.ts';

const edge = 640;
const link = `https://pilot.taply.app/pay/${'a'.repeat(64)}`;
const qr = encodeQr(link, 'M');
const scale = Math.floor(edge / (qr.size + 8));
const offset = Math.floor((edge - qr.size * scale) / 2);
let random = 0x12345678;
function pixels(kind) {
  const data = new Uint8ClampedArray(edge * edge * 4);
  for (let y = 0; y < edge; y++) for (let x = 0; x < edge; x++) {
    const mx = Math.floor((x - offset) / scale);
    const my = Math.floor((y - offset) / scale);
    random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
    const dark = mx >= 0 && my >= 0 && mx < qr.size && my < qr.size && qr.modules[my][mx];
    const value = kind === 'noise' ? random & 255 : kind === 'qr' && dark ? 11 : 244;
    const index = (y * edge + x) * 4;
    data[index] = value; data[index + 1] = value; data[index + 2] = value; data[index + 3] = 255;
  }
  return data;
}
const cases = [];
for (const kind of ['blank', 'noise', 'qr']) {
  const data = pixels(kind);
  const times = [];
  for (let pass = 0; pass < 37; pass++) {
    const start = performance.now();
    const result = jsQR(data, edge, edge, { inversionAttempts: pass % 4 === 3 ? 'attemptBoth' : 'dontInvert' });
    if (kind === 'qr' && pass % 4 !== 3 && result?.data !== link) throw new Error('synthetic QR did not decode');
    if (pass >= 5) times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  cases.push({ kind, samples: times.length, medianMs: +times[16].toFixed(2), p95Ms: +times[30].toFixed(2), maxMs: +times[31].toFixed(2) });
}
console.log(JSON.stringify({ scope: 'Synthetic Node/V8; not physical mobile browser evidence', node: process.version, edge, cases }, null, 2));
