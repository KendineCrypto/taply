// Read-only deployment planner. Intentionally has no signing/broadcast/key APIs.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
export const GENESIS = 'EPnLgE7iEq9s7yTkos96M3cWymH5avBAPm3qx3NXqR8H';
export const USDC = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
export const CONSTRUCTOR = Object.freeze({ tokens: [{ accountId: USDC, decimals: 6, symbol: 'USDC' }],
  routerAccountId: 'intents.near', recoveryAccountId: 'kendinecrypto.near', nativeCapYocto: '1000000000000000000000000', usdcCapBaseUnits: '25000000' });
const RPCS = new Set(['https://rpc.mainnet.fastnear.com', 'https://archival-rpc.mainnet.fastnear.com', 'https://rpc.mainnet.near.org']);
function base58(bytes) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt('0x' + Buffer.from(bytes).toString('hex')), result = '';
  while (n) { result = alphabet[Number(n % 58n)] + result; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; result = '1' + result; } return result;
}
export function codeHash(wasm) { return base58(createHash('sha256').update(wasm).digest()); }
export function validateConfig(config, accountId) {
  if (config.network !== 'near-mainnet' || config.contractVersion !== '0.6.0-mainnet' || config.contractId !== accountId || config.testFaultBuild !== false ||
    config.capabilities?.protectedPay !== false || config.capabilities?.intentsRouter !== false ||
    config.unknownCallbackPolicy !== 'IN_FLIGHT_NO_RETRY_NO_ADMIN_OVERRIDE') throw new Error('UNSAFE_DEPLOYED_CONFIG');
  for (const k of ['routerAccountId', 'recoveryAccountId', 'nativeCapYocto', 'usdcCapBaseUnits'])
    if (config[k] !== CONSTRUCTOR[k]) throw new Error(`CONFIG_MISMATCH_${k}`);
  if (config.tokens?.length !== 1 || config.tokens[0].accountId !== USDC || config.tokens[0].decimals !== 6 || config.tokens[0].symbol !== 'USDC') throw new Error('WRONG_USDC');
}
export async function plan({ rpcUrl, accountId, wasm, verify = false, previousCodeHash = null }, rpcOverride) {
  if (!RPCS.has(rpcUrl)) throw new Error('UNAPPROVED_MAINNET_RPC');
  if (!['devkendinecrypto.near', 'taply-pay.kendinecrypto.near'].includes(accountId)) throw new Error('WRONG_DESTINATION');
  if (wasm.length < 8 || wasm.subarray(0, 8).toString('hex') !== '0061736d01000000') throw new Error('INVALID_WASM');
  const rpc = rpcOverride ?? (async (method, params) => {
    const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'taply-mainnet-dry-run', method, params }), redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`RPC_HTTP_${response.status}`);
    const text = await response.text(); if (text.length > 4194304) throw new Error('RPC_TOO_LARGE');
    const body = JSON.parse(text); if (body.error || body.result === undefined) throw new Error('RPC_UNAVAILABLE_OR_ACCOUNT_MISSING'); return body.result;
  });
  const status = await rpc('status', []);
  const genesis = await rpc('block', { block_id: 0 });
  if (status.chain_id !== 'mainnet' || status.sync_info?.syncing !== false || genesis.header?.hash !== GENESIS) throw new Error('WRONG_NETWORK');
  const block = await rpc('block', { finality: 'final' }); const blockId = block.header.hash;
  const account = await rpc('query', { request_type: 'view_account', account_id: accountId, block_id: blockId });
  const view = async (receiver, method, args) => {
    const r = await rpc('query', { request_type: 'call_function', account_id: receiver, method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString('base64'), block_id: blockId });
    return JSON.parse(Buffer.from(r.result).toString('utf8'));
  };
  const hash = codeHash(wasm); const storage = await view(USDC, 'storage_balance_of', { account_id: accountId });
  if (verify) {
    if (account.code_hash !== hash) throw new Error('DEPLOYED_CODE_HASH_MISMATCH');
    const config = await view(accountId, 'get_config', {}); validateConfig(config, accountId);
    if (!storage || BigInt(storage.total) <= 0n) throw new Error('USDC_NOT_REGISTERED');
    return { mode: 'READ_ONLY_VERIFICATION', accountId, blockId, codeHash: hash, constructorVerified: true, usdcRegistered: true,
      readiness: 'NO_GO: receipt proof, sandbox review and owner release approval still required', transactions: [] };
  }
  if (account.code_hash !== '11111111111111111111111111111111') {
    // This version only plans initial deployment. Reinitializing existing state is forbidden.
    throw new Error(previousCodeHash ? 'EXISTING_STATE_REQUIRES_SEPARATE_MIGRATION_REVIEW' : 'DESTINATION_HAS_CODE');
  }
  const bounds = await view(USDC, 'storage_balance_bounds', {});
  if (!/^[1-9][0-9]*$/.test(bounds.min) || BigInt(bounds.min) > 2000000000000000000000n) throw new Error('UNSAFE_STORAGE_BOUNDS');
  const protocol = await rpc('EXPERIMENTAL_protocol_config', { block_id: blockId });
  const byteCost = BigInt(protocol.runtime_config.storage_amount_per_byte);
  const gasPrice = BigInt((await rpc('gas_price', [blockId])).gas_price);
  // Conservative state allowance, NOT measured serialized state. Requests pay separately.
  const stateAllowanceBytes = 8192n;
  const storageEstimate = (BigInt(wasm.length) + BigInt(account.storage_usage) + stateAllowanceBytes) * byteCost;
  const gasUpperBudget = 300000000000000n * gasPrice;
  const margin = 1000000000000000000000000n;
  const registration = storage ? 0n : BigInt(bounds.min);
  const required = storageEstimate + gasUpperBudget + registration + margin;
  const available = BigInt(account.amount);
  return { mode: 'DRY_RUN_ONLY', accountId, blockId, codeHash: hash, wasmBytes: wasm.length,
    storageEstimateYocto: storageEstimate.toString(), stateAllowanceBytes: stateAllowanceBytes.toString(),
    gasPriceYocto: gasPrice.toString(), gasUpperBudgetYocto: gasUpperBudget.toString(), operationalMarginYocto: margin.toString(),
    estimatedRequiredYocto: required.toString(), accountAmountYocto: available.toString(),
    additionalFundingEstimateYocto: (required > available ? required - available : 0n).toString(),
    estimatesAreNotMeasuredDeploymentCosts: true,
    transactions: [
      { signerId: accountId, receiverId: accountId, actions: [
        { type: 'DeployContract', wasmBytes: wasm.length, codeHash: hash },
        { type: 'FunctionCall', methodName: 'new', args: CONSTRUCTOR, gas: '30000000000000', depositYocto: '0' } ] },
      ...(!storage ? [{ signerId: accountId, receiverId: USDC, actions: [{ type: 'FunctionCall', methodName: 'storage_deposit',
        args: { account_id: accountId, registration_only: true }, gas: '30000000000000', depositYocto: bounds.min }] }] : []) ],
    requiredAfterOwnerDeployment: ['Run this script with --verify against identical WASM', 'Review access keys independently; no deletion transaction is generated',
      'Record native/USDC/router merchant payout receipts and failure tests', 'Independent security review of R-2 and router gas envelope'],
    readiness: 'NO_GO: unaudited candidate; dry-run is not permission to deploy' };
}
async function main() {
  const args = process.argv.slice(2); const allowed = new Set(['--dry-run', '--verify', '--wasm', '--account', '--rpc']);
  for (let i = 0; i < args.length; i++) { if (!allowed.has(args[i])) throw new Error('UNKNOWN_ARGUMENT'); if (['--wasm','--account','--rpc'].includes(args[i])) i++; }
  if (args.includes('--dry-run') === args.includes('--verify')) throw new Error('CHOOSE_DRY_RUN_OR_VERIFY');
  const value = key => args[args.indexOf(key) + 1];
  if (!args.includes('--wasm') || !args.includes('--account') || !args.includes('--rpc')) throw new Error('REQUIRE_WASM_ACCOUNT_RPC');
  const report = await plan({ rpcUrl: value('--rpc'), accountId: value('--account'), wasm: readFileSync(value('--wasm')), verify: args.includes('--verify') });
  console.log('Taply mainnet deployment report — READ ONLY, NOTHING SIGNED\n' + JSON.stringify(report, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(`NO-GO: ${e.message}`); process.exitCode = 1; });
