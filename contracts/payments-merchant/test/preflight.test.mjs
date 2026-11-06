import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { preflightMerchant } from '../scripts/preflight-merchant.mjs';
const wasmPath = fileURLToPath(new URL('../artifacts/merchant-v1/payments.wasm', import.meta.url));
const sha = createHash('sha256').update(readFileSync(wasmPath)).digest('hex');
// Independent encoding via the already pinned SDK, not the preflight encoder.
const { baseEncode } = await import('../../../packages/near-client/node_modules/near-api-js/lib/index.js');
const code = baseEncode(Buffer.from(sha, 'hex'));
const args = { wasmPath, contractId: 'candidate.fixture.testnet', expectedSha256: sha, expectedCodeHash: code };
test('candidate preflight checks both hashes, exact ABI and isolation without approval or transactions', () => {
  const result = preflightMerchant(args);
  assert.equal(result.codeHash, code); assert.equal(result.exportedMethods, 12); assert.equal(result.deploymentApproved, false);
  for (const patch of [{ expectedSha256: 'f'.repeat(64) }, { expectedCodeHash: '1'.repeat(32) },
    { contractId: 'taply-pay-pilot-1.testnet' }, { contractId: 'invalid account' },
    { wasmPath: wasmPath.replace('payments.wasm', 'payments.callback-fault.wasm') }]) assert.throws(() => preflightMerchant({ ...args, ...patch }));
});
