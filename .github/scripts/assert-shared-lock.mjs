// Fails unless every direct dependency installed for @taply/shared has exactly the
// version recorded for packages/shared in the committed pnpm-lock.yaml.
// Usage: node assert-shared-lock.mjs <committed pnpm-lock.yaml> <pnpm list --json output>
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const [lockPath, listPath] = process.argv.slice(2);
const lines = readFileSync(lockPath, 'utf8').split(/\r?\n/);

// Minimal reader for the lockfile v9 importer block (no YAML dependency needed):
//   importers:
//     packages/shared:
//       dependencies:
//         zod:
//           specifier: 4.6.7
//           version: 4.6.7
const expected = {};
let inImporters = false, inShared = false, name = null;
for (const line of lines) {
  if (/^importers:\s*$/.test(line)) { inImporters = true; continue; }
  if (inImporters && /^\S/.test(line)) break;
  if (!inImporters) continue;
  const importer = line.match(/^  (\S.*):\s*$/);
  if (importer) { inShared = importer[1] === 'packages/shared'; continue; }
  if (!inShared) continue;
  const dep = line.match(/^      ('?)(.+)\1:\s*$/);
  if (dep) { name = dep[2]; continue; }
  const version = line.match(/^        version: (\S+)\s*$/);
  if (version && name) expected[name] = version[1];
}
assert.ok(Object.keys(expected).length > 0, 'packages/shared importer not found in committed lockfile');

const [project] = JSON.parse(readFileSync(listPath, 'utf8'));
const installed = {};
for (const group of ['dependencies', 'devDependencies']) {
  for (const [dep, info] of Object.entries(project[group] ?? {})) installed[dep] = info.version;
}
assert.deepEqual(installed, expected, '@taply/shared install differs from committed lockfile');
console.log(`@taply/shared matches committed lockfile: ${Object.entries(expected).map(([n, v]) => `${n}@${v}`).join(', ')}`);
