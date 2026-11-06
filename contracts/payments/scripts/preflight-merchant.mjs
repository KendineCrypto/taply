import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AccountIdSchema } from '../../../packages/shared/dist/index.js';
const PILOT = 'taply-pay-pilot-1.testnet';
const PILOT_SHA = 'a13d932f3b4cadbb4a6580d447a8142f8c704656998659fb3ccebde6ddacb0d2';
function base58(bytes) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt('0x' + bytes.toString('hex')), out = '';
  while (n) { out = alphabet[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = '1' + out; }
  return out;
}
/** Offline byte/ABI check only. A supplied pin is not a grant of deployment approval. */
export function preflightMerchant({ wasmPath, contractId, expectedSha256, expectedCodeHash }) {
  AccountIdSchema.parse(contractId);
  if (contractId === PILOT || expectedSha256 === PILOT_SHA) throw Error('PILOT_MUST_NOT_BE_REUSED');
  if (!/^[0-9a-f]{64}$/.test(expectedSha256) || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(expectedCodeHash)
    || typeof wasmPath !== 'string' || !wasmPath.endsWith('.wasm') || /callback-fault/.test(wasmPath)) throw Error('INVALID_CANDIDATE');
  const bytes = readFileSync(wasmPath), digest = createHash('sha256').update(bytes).digest();
  const sha256 = digest.toString('hex'), codeHash = base58(digest);
  if (sha256 !== expectedSha256 || codeHash !== expectedCodeHash) throw Error('ARTIFACT_PIN_MISMATCH');
  const abi = JSON.parse(readFileSync(new URL('../abi.merchant-v1.json', import.meta.url), 'utf8'));
  const module = new WebAssembly.Module(bytes);
  const actual = WebAssembly.Module.exports(module).filter(e => e.kind === 'function').map(e => e.name).sort();
  if (JSON.stringify(actual) !== JSON.stringify(abi.methods.map(m => m.name).sort())) throw Error('ABI_EXPORT_MISMATCH');
  return { contractId, contractVersion: abi.contractVersion, bytes: bytes.length, sha256, codeHash,
    exportedMethods: actual.length, scope: 'OFFLINE_ARTIFACT_ONLY', deploymentApproved: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [wasmPath, contractId, expectedSha256, expectedCodeHash, ...extra] = process.argv.slice(2);
  if (extra.length || !expectedCodeHash) throw Error('Usage: node preflight-merchant.mjs <candidate.wasm> <operator-selected-account> <reviewed-sha256> <reviewed-code-hash>');
  console.log(JSON.stringify(preflightMerchant({ wasmPath, contractId, expectedSha256, expectedCodeHash }), null, 2));
}
