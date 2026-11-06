export { preflightMerchant } from '../../payments-merchant/scripts/preflight-merchant.mjs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../payments-merchant/scripts/preflight-merchant.mjs', import.meta.url)), ...process.argv.slice(2)], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
