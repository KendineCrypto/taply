import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measure } from './measure.mjs';

const emptyWasm = Buffer.from('0061736d01000000', 'hex');
test('measurement rejects malformed WASM', () => {
  assert.throws(() => measure(Buffer.from('not WASM'), Buffer.from('{"methods":[]}')), WebAssembly.CompileError);
});
test('extra ABI requirements cannot pass an empty module; outputs never become approved', () => {
  const result = measure(emptyWasm, Buffer.from('{"methods":[{"name":"pay_instant_native"}]}'));
  assert.equal(result.abiFunctionMatch, false);
  assert.equal(result.approval, 'UNAPPROVED');
});
test('malformed ABI cannot silently pass', () => {
  assert.throws(() => measure(emptyWasm, Buffer.from('{}')));
});
