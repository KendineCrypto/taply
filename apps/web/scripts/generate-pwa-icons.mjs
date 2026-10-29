#!/usr/bin/env node
/**
 * PWA icon generation.
 *
 * Protocol Freeze v1 §9: "PWA 192/512/maskable icons may be rendered from same
 * approved vectors." Nothing here redraws the mark — sharp rasterizes the
 * approved SVG. The maskable variant only adds safe-zone padding (>= one dot
 * diameter per BRAND_GUIDELINES clearspace rule) on the approved Night ground.
 *
 * Re-run with `pnpm gen:icons`; output is committed so builds need no raster step.
 */
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(webRoot, 'public', 'brand', 'icon-dark.svg');
const outDir = join(webRoot, 'public', 'icons');
const NIGHT = '#0B120E';

// icon viewBox is 240x240 with a dot of r=17 -> diameter 34 -> 14.17% clearspace.
const DOT_DIAMETER_RATIO = 34 / 240;

const svg = readFileSync(source);

async function square(size, file) {
  await sharp(svg, { density: 384 }).resize(size, size, { fit: 'contain' }).png().toFile(join(outDir, file));
  return `${file} ${size}x${size}`;
}

async function maskable(size, file) {
  const pad = Math.round(size * DOT_DIAMETER_RATIO);
  const inner = size - pad * 2;
  const art = await sharp(svg, { density: 384 }).resize(inner, inner, { fit: 'contain' }).png().toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: NIGHT },
  })
    .composite([{ input: art, top: pad, left: pad }])
    .png()
    .toFile(join(outDir, file));
  return `${file} ${size}x${size} (safe-zone pad ${pad}px)`;
}

const written = [
  await square(192, 'icon-192.png'),
  await square(512, 'icon-512.png'),
  await square(180, 'apple-touch-icon.png'),
  await maskable(512, 'icon-maskable-512.png'),
];
for (const line of written) console.log('generated ' + line);
