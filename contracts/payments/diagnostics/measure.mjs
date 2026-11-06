import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function measure(wasm, abiBytes) {
  const digest = createHash('sha256').update(wasm).digest();
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt('0x' + digest.toString('hex'));
  let codeHash = '';
  while (n) { codeHash = alphabet[Number(n % 58n)] + codeHash; n /= 58n; }
  for (const byte of digest) { if (byte !== 0) break; codeHash = '1' + codeHash; }
  const exports = WebAssembly.Module.exports(new WebAssembly.Module(wasm));
  const functions = exports.filter(e => e.kind === 'function').map(e => e.name).sort();
  const expected = JSON.parse(abiBytes).methods.map(m => m.name).sort();
  return {
    approval: 'UNAPPROVED', sha256: digest.toString('hex'), codeHash, size: wasm.length,
    exports, abiFunctionMatch: JSON.stringify(functions) === JSON.stringify(expected),
    abiSha256: createHash('sha256').update(abiBytes).digest('hex'),
    abiScope: 'Export names only; argument/return semantics require runtime tests.'
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(measure(readFileSync(process.argv[2]), readFileSync(process.argv[3])), null, 2));
}
