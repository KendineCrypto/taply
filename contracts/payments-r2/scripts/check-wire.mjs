// Cross-language check (R-2 candidate): every request state the Rust tests produced
// must parse with the UNCHANGED frozen shared schema (packages/shared).
// Run after `cargo test --lib` and `pnpm --filter @taply/shared build`.
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { ContractRequestSchema, calculateTermsHash, parseStrictJson } from '../../../packages/shared/dist/index.js';

// Default: unit-test snapshots. `sandbox` argument: records read from a real local node.
const mode = process.argv[2] ?? 'unit';
const sandbox = mode === 'sandbox' || mode === 'sandbox-token';
const dirs = { unit: 'requests', sandbox: 'sandbox-requests', token: 'requests-token', 'sandbox-token': 'sandbox-token' };
const dir = new URL(`../artifacts/${dirs[mode]}/`, import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
assert.ok(files.length > 0, 'Run cargo test --lib first');
const states = new Set();
for (const file of files) {
  const parsed = ContractRequestSchema.safeParse(parseStrictJson(readFileSync(new URL(file, dir))));
  assert.ok(parsed.success, `${file}: ${JSON.stringify(parsed.error?.issues)}`);
  assert.equal(parsed.data.termsHash, calculateTermsHash(parsed.data.terms));
  states.add(parsed.data.status);
}
// R-2 candidate: settlement commits in one receipt, so no *_IN_FLIGHT or
// *_FAILED_RECOVERABLE request status exists any more (delivery is reported by
// get_delivery). Every produced view must still parse with the UNCHANGED schema.
const required = mode === 'token' ? ['OPEN', 'FINAL_PAID', 'LOCKED', 'CANCELLED_REFUNDED']
  : mode === 'sandbox-token' ? ['FINAL_PAID', 'CANCELLED_REFUNDED']
  : sandbox ? ['LOCKED', 'CANCELLED_REFUNDED', 'FINAL_PAID']
  : ['OPEN', 'LOCKED', 'CANCELLED_REFUNDED', 'FINAL_PAID'];
const forbidden = ['PAYOUT_IN_FLIGHT', 'REFUND_IN_FLIGHT', 'RELEASE_IN_FLIGHT',
  'PAYOUT_FAILED_RECOVERABLE', 'REFUND_FAILED_RECOVERABLE', 'RELEASE_FAILED_RECOVERABLE'];
for (const state of required) {
  assert.ok(states.has(state), `Missing state: ${state}`);
}
for (const state of forbidden) {
  assert.ok(!states.has(state), `Candidate must never produce ${state}`);
}
console.log(`Validated ${files.length} ${mode} records against the shared schema (v1.1); states: ${[...states].sort().join(', ')}`);
