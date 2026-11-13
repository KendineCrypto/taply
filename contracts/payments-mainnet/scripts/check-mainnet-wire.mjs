import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { MainnetRequestSchema, calculateMainnetTermsHash, buildInstantRecipientMessage } from '../../../packages/shared/dist/index.js';
const dir = new URL('../artifacts/mainnet-wire/', import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith('.json'));
assert.ok(files.length > 0, 'Sandbox records required');
const states = new Set();
for (const file of files) {
  const r = MainnetRequestSchema.parse(JSON.parse(readFileSync(new URL(file, dir), 'utf8')));
  assert.equal(r.termsHash, calculateMainnetTermsHash(r.terms));
  assert.deepEqual(JSON.parse(buildInstantRecipientMessage(r.terms.id, r.termsHash)), {
    id: r.terms.id, expectedTermsHash: r.termsHash, action: 'pay_instant',
  });
  states.add(r.status);
}
for (const status of ['OPEN', 'PAYOUT_IN_FLIGHT', 'PAYOUT_FAILED_RECOVERABLE', 'FINAL_PAID']) {
  assert.ok(states.has(status), `Missing actual sandbox state: ${status}`);
}
console.log(`Validated ${files.length} actual sandbox records with mainnet shared exports; ${[...states].sort().join(', ')}`);
