// Read-only: imports the pinned source's verifier; no wallet, seed or signing path.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const sourceRoot = process.argv[2];
if (!sourceRoot) throw new Error('Usage: node verify.mjs <pinned-mainnet-source-root>');
const saved = JSON.parse(await readFile(new URL('./proof.json', import.meta.url), 'utf8'));
const { verifyMainnetSettlement } = await import(pathToFileURL(resolve(sourceRoot, 'packages/near-client/dist/index.js')).href);
const result = await verifyMainnetSettlement({ kind: 'instant', profile: saved.profile }, {
  id: saved.requestId, funding: saved.funding, operations: [saved.funding],
});
console.log(JSON.stringify({ freshCheck: true, observedAtUtc: new Date().toISOString(), result }, null, 2));
assert.equal(result.kind, 'VERIFIED_SETTLEMENT', 'Live RPC evidence unavailable or not verified; archived proof is not a fresh result');
assert.equal(result.status, 'PAID');
for (const key of ['network', 'assetId', 'amountBaseUnits', 'beneficiary', 'fundingTransactionHash', 'transferReceiptId', 'callbackReceiptId']) {
  assert.equal(result[key], saved.proof[key], `Unexpected ${key}`);
}
