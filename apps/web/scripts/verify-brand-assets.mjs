#!/usr/bin/env node
/**
 * Brand asset drift guard.
 *
 * CLAUDE.md / BRAND_GUIDELINES.md: the approved `t` geometry is a single master
 * SVG path. apps/web serves *copies* of brand/assets, so this script proves the
 * copies are byte-identical to the approved originals and that the inline React
 * components reuse the exact same path `d` string (never a redrawn one).
 *
 * Exits non-zero on any drift. Wired into `pnpm check`.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(webRoot, '..', '..');
const approvedDir = join(repoRoot, 'brand', 'assets');
const servedDir = join(webRoot, 'public', 'brand');

const ASSETS = [
  'favicon.svg',
  'icon-dark.svg',
  'icon-light.svg',
  'icon-transparent.svg',
  'wordmark-dark.svg',
  'wordmark-light.svg',
  'wordmark-transparent.svg',
];

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const failures = [];

for (const name of ASSETS) {
  const approved = readFileSync(join(approvedDir, name));
  const served = readFileSync(join(servedDir, name));
  if (sha(approved) !== sha(served)) {
    failures.push(`${name}: served copy differs from brand/assets original`);
  }
}

// The master `t` path must appear verbatim in the inline components.
const masterPath = (() => {
  const svg = readFileSync(join(approvedDir, 'icon-transparent.svg'), 'utf8');
  const m = svg.match(/<path d="([^"]+)"/);
  if (!m?.[1]) throw new Error('Could not extract master path from icon-transparent.svg');
  return m[1];
})();

const inlineSources = ['src/components/brand/brand-geometry.ts'];
for (const rel of inlineSources) {
  const src = readFileSync(join(webRoot, rel), 'utf8');
  if (!src.includes(masterPath)) {
    failures.push(`${rel}: does not contain the verbatim approved master \`t\` path`);
  }
}

if (failures.length > 0) {
  console.error('BRAND ASSET DRIFT DETECTED:');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`brand assets OK (${ASSETS.length} files byte-identical; master path verbatim)`);
