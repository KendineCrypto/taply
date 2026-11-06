import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

test('preflight fixture uses decoded native file paths, including Windows drives and spaces', () => {
  assert.equal(fileURLToPath('file:///C:/Taply%20QA/%C3%B6/payments.wasm', { windows: true }), 'C:\\Taply QA\\ö\\payments.wasm');
  const script = new URL('./preflight.test.mjs', import.meta.url);
  assert.equal(readFileSync(fileURLToPath(script), 'utf8'), readFileSync(script, 'utf8'));
  assert.equal(pathToFileURL(fileURLToPath(script)).href, script.href);
  assert.match(readFileSync(script, 'utf8'), /fileURLToPath\(new URL\(/);
  assert.doesNotMatch(readFileSync(script, 'utf8'), /\.pathname/);
});
