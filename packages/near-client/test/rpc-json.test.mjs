import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRpcJsonWithIntegers } from '../dist/index.js';

test('RPC integer parser preserves exact large tokens without coercing wire types', () => {
  const value = parseRpcJsonWithIntegers('{"height":275747769,"timestamp":1793535606670615924,"timestamp_nanosec":"1793535606670615924","negative":-9007199254740992,"safe":9007199254740991}');
  assert.equal(value.height, 275747769);
  assert.equal(value.timestamp, 1793535606670615924n);
  assert.equal(value.timestamp_nanosec, '1793535606670615924');
  assert.equal(value.negative, -9007199254740992n);
  assert.equal(value.safe, Number.MAX_SAFE_INTEGER);
});

for (const raw of ['{"n":1.5}', '{"n":1e24}', '{"n":1,"n":2}', '{"n":1,"\\u006e":2}', '{/*x*/}', '{"n":1,}']) {
  test(`RPC integer parser rejects malformed or noninteger JSON: ${raw}`, () => {
    assert.throws(() => parseRpcJsonWithIntegers(raw));
  });
}
