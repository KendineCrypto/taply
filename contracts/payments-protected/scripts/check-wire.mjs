// Cross-language check: every Protected Pay state the Rust unit tests produced
// must parse with the UNCHANGED frozen shared schema (packages/shared).
// Run after `cargo test --lib` and `pnpm --filter @taply/shared build`.
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { ContractRequestSchema, calculateTermsHash, parseStrictJson } from '../../../packages/shared/dist/index.js';

// Default: unit-test snapshots. `sandbox` argument: records read from a real local node.
const sandbox = process.argv[2] === 'sandbox';
const dir = new URL(sandbox ? '../artifacts/sandbox-requests/' : '../artifacts/requests/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
assert.ok(files.length > 0, 'Run cargo test --lib first');
const states = new Set();
for (const file of files) {
  const parsed = ContractRequestSchema.safeParse(parseStrictJson(readFileSync(new URL(file, dir))));
  assert.ok(parsed.success, `${file}: ${JSON.stringify(parsed.error?.issues)}`);
  assert.equal(parsed.data.termsHash, calculateTermsHash(parsed.data.terms));
  states.add(parsed.data.status);
}
const required = sandbox ? ['LOCKED', 'CANCELLED_REFUNDED', 'FINAL_PAID']
  : ['OPEN', 'LOCKED', 'REFUND_IN_FLIGHT', 'REFUND_FAILED_RECOVERABLE', 'CANCELLED_REFUNDED',
    'RELEASE_IN_FLIGHT', 'RELEASE_FAILED_RECOVERABLE', 'FINAL_PAID'];
for (const state of required) {
  assert.ok(states.has(state), `Missing state: ${state}`);
}
console.log(`Validated ${files.length} ${sandbox ? 'sandbox' : 'unit-test'} Protected Pay records against the unchanged shared schema; states: ${[...states].sort().join(', ')}`);
