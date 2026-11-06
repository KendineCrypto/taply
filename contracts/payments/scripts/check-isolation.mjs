import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const freeze = JSON.parse(readFileSync(new URL('g1-source-freeze.json', root)));
for (const [file, expected] of Object.entries(freeze.files)) {
  const bytes = readFileSync(new URL(file, root), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, 'Frozen G1 input changed: ' + file);
}
assert.deepEqual(readdirSync(new URL('src/', root)).sort(), ['lib.rs', 'model.rs', 'tests.rs']);
assert.ok(!existsSync(new URL('build.rs', root)), 'G1 must not gain a build script');
for (const key of ['RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER', 'CARGO_TARGET_DIR']) {
  assert.ok(!process.env[key], 'Unexpected build override: ' + key);
}
console.log('Frozen G1 source, manifest, lock, config and ABI match diagnostic inputs');
