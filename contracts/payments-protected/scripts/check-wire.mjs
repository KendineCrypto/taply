// Cross-language check: every Protected Pay state the Rust unit tests produced
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
const required = mode === 'token' ? ['OPEN', 'PAYOUT_IN_FLIGHT', 'FINAL_PAID', 'LOCKED', 'REFUND_FAILED_RECOVERABLE', 'CANCELLED_REFUNDED']
  : mode === 'sandbox-token' ? ['FINAL_PAID', 'PAYOUT_FAILED_RECOVERABLE', 'CANCELLED_REFUNDED']
  : sandbox ? ['LOCKED', 'CANCELLED_REFUNDED', 'FINAL_PAID']
  : ['OPEN', 'LOCKED', 'REFUND_IN_FLIGHT', 'REFUND_FAILED_RECOVERABLE', 'CANCELLED_REFUNDED',
    'RELEASE_IN_FLIGHT', 'RELEASE_FAILED_RECOVERABLE', 'FINAL_PAID'];
for (const state of required) {
  assert.ok(states.has(state), `Missing state: ${state}`);
}
console.log(`Validated ${files.length} ${mode} records against the shared schema (v1.1); states: ${[...states].sort().join(', ')}`);
