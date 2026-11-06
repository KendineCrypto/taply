import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { ContractRequestSchema, calculateTermsHash, parseStrictJson } from '../../../packages/shared/dist/index.js';

const dir = new URL('../artifacts/requests/', import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith('.json'));
assert.ok(files.length > 0, 'Run sandbox tests first');
const states = new Set();
for (const file of files) {
  const request = ContractRequestSchema.parse(parseStrictJson(readFileSync(new URL(file, dir))));
  assert.equal(request.termsHash, calculateTermsHash(request.terms));
  states.add(request.status);
}
for (const state of ['OPEN', 'FINAL_PAID', 'PAYOUT_IN_FLIGHT', 'PAYOUT_FAILED_RECOVERABLE', 'CANCELLED_UNFUNDED']) {
  assert.ok(states.has(state), `Missing sandbox state: ${state}`);
}
console.log(`Validated ${files.length} sandbox request records against the unchanged shared schema; states: ${[...states].sort().join(', ')}`);
