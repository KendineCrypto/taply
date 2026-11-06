import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, cpSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = new URL('../', import.meta.url);
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'taply-g1-freeze-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const file of ['src', '.cargo', 'Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'abi.json', 'g1-source-freeze.json']) cpSync(new URL(file, root), join(dir, file), { recursive: true });
  mkdirSync(join(dir, 'scripts'));
  cpSync(new URL('scripts/check-isolation.mjs', root), join(dir, 'scripts/check-isolation.mjs'));
  return dir;
}
function check(dir, overrides = {}) {
  const env = { ...process.env };
  for (const key of ['RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER', 'CARGO_TARGET_DIR']) delete env[key];
  return spawnSync(process.execPath, [join(dir, 'scripts/check-isolation.mjs')], { env: { ...env, ...overrides }, encoding: 'utf8' });
}
test('G1 freeze passes independently of candidate edits', t => {
  const dir = fixture(t);
  assert.equal(check(dir).status, 0);
  mkdirSync(join(dir, 'candidate'));
  writeFileSync(join(dir, 'candidate/lib.rs'), 'unrelated candidate change');
  assert.equal(check(dir).status, 0);
});
test('G1 freeze rejects source drift, build injection and extra modules', t => {
  for (const file of ['src/lib.rs', 'Cargo.toml', 'Cargo.lock', '.cargo/config.toml', 'abi.json', 'build.rs', 'src/merchant.rs']) {
    const dir = fixture(t);
    writeFileSync(join(dir, file), 'unexpected mutation');
    assert.notEqual(check(dir).status, 0, file);
  }
});
test('G1 freeze rejects target and compiler overrides', t => {
  const dir = fixture(t);
  for (const key of ['RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER', 'CARGO_TARGET_DIR']) assert.notEqual(check(dir, { [key]: 'candidate' }).status, 0, key);
});

test('build routing and fault restoration use separate outputs (stub Cargo, not WASM proof)', t => {
  const dir = mkdtempSync(join(tmpdir(), 'taply-routing-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const g1 = join(dir, 'contracts/payments'), g2 = join(dir, 'contracts/payments-merchant');
  cpSync(new URL('scripts/', root), join(g1, 'scripts'), { recursive: true });
  cpSync(new URL('../payments-merchant/scripts/', root), join(g2, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'bin/cargo'), '#!/usr/bin/env bash\nmkdir -p target/wasm32-unknown-unknown/release\nprintf "%s" "$*" > target/wasm32-unknown-unknown/release/taply_payments.wasm\n', { mode: 0o755 });
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  const run = (script, override = '') => spawnSync(bash, ['-c', 'export PATH="$PWD/bin:$PATH"; ' + override + 'bash ' + script], { cwd: dir, encoding: 'utf8' });
  assert.equal(run('contracts/payments/scripts/build.sh').status, 0);
  const read = p => readFileSync(p, 'utf8');
  const artifact = join(g1, 'artifacts/payments.wasm');
  const original = read(artifact);
  assert.doesNotMatch(original, /features/);
  assert.match(read(join(g1, 'artifacts/payments.callback-fault.wasm')), /sandbox-fail-callback/);
  assert.equal(read(join(g1, 'target/wasm32-unknown-unknown/release/taply_payments.wasm')), original);
  assert.equal(run('contracts/payments/scripts/build-merchant.sh').status, 0);
  assert.equal(read(artifact), original);
  assert.match(read(join(g2, 'artifacts/merchant-v1/payments.wasm')), /merchant-bound-v1/);
  assert.doesNotMatch(read(join(g2, 'target/wasm32-unknown-unknown/release/taply_payments.wasm')), /sandbox-fail-callback/);
  for (const script of ['contracts/payments/scripts/build.sh', 'contracts/payments/scripts/build-merchant.sh']) assert.notEqual(run(script, 'export CARGO_TARGET_DIR=other; ').status, 0);
});
