import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { codeHash } from './deploy-dry-run.mjs';
const wasm = readFileSync(new URL('../artifacts/payments-mainnet.wasm', import.meta.url));
const report = { kind: 'CI_BUILD_NOT_DEPLOYMENT', commit: process.env.GITHUB_SHA ?? null,
  contractVersion: '0.6.0-mainnet', wasmBytes: wasm.length,
  sha256Hex: createHash('sha256').update(wasm).digest('hex'), nearCodeHash: codeHash(wasm),
  codeStorageOnlyYoctoAt1e19PerByte: (BigInt(wasm.length) * 10000000000000000000n).toString(),
  excludesAccountStateStorageRegistrationGasAndOperationalReserve: true,
  deploymentApproved: false };
writeFileSync(new URL('../artifacts/build-report.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
