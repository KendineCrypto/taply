#!/usr/bin/env node
/**
 * Taply Instant Pay — READ-ONLY Testnet deployment preflight (Phase 2D, dry run).
 *
 * This script never creates accounts, deploys, signs, transfers or holds keys.
 * It has no key input of any kind and only calls these JSON-RPC read methods:
 * status, block, query (view_account, view_access_key_list, call_function on
 * view methods), EXPERIMENTAL_protocol_config.
 *
 *   node apps/web/scripts/deploy-preflight.mjs wasm <path/to/payments.wasm>
 *   node apps/web/scripts/deploy-preflight.mjs account <account.testnet> --wasm <path> [--rpc <https-url>]
 *   node apps/web/scripts/deploy-preflight.mjs post <account.testnet> [--rpc <https-url>]
 *
 * Exit code 0 = every check passed, 1 = a check failed, 2 = usage/RPC error.
 * See apps/web/docs/TESTNET_DEPLOYMENT_DRY_RUN.md for the full procedure.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// --- The artifact under review (TESTNET_READINESS_REVIEW.md section 2) -------
export const APPROVED = Object.freeze({
  sha256: 'a13d932f3b4cadbb4a6580d447a8142f8c704656998659fb3ccebde6ddacb0d2',
  codeHash: 'BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B',
  sizeBytes: 345541,
});
/** The callback-fault test build. Must never be deployed. */
export const FAULT_BUILD_SHA256 = '989596a8b2d8b3fa814c749951946ad0396f7725e8cb5b924715493b6153f6be';
export const TESTNET_GENESIS_HASH = 'FWJ9kR6KFWoyMoNjpLXXGHeuiy7tEY6GmoFeCA5yuc6b';
/** NEAR's code hash for "no contract deployed" (32 zero bytes). */
export const EMPTY_CODE_HASH = '11111111111111111111111111111111';
/** Base state + account + one access key, rounded up (readiness review section 4). */
export const BASE_STATE_ALLOWANCE_BYTES = 300n;
/** Operating margin on top of computed storage (0.5 NEAR). */
export const MARGIN_YOCTO = 500_000_000_000_000_000_000_000n;
export const DEFAULT_RPC = 'https://rpc.testnet.near.org';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** NEAR code hash = base58 of the 32-byte SHA-256 of the WASM. */
export function codeHashFromSha256Hex(hex) {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('expected 64 lowercase hex characters');
  let n = BigInt(`0x${hex}`);
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (let i = 0; i < hex.length && hex.slice(i, i + 2) === '00'; i += 2) out = `1${out}`;
  return out;
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const check = (name, ok, detail) => ({ name, ok: Boolean(ok), detail });

export function evaluateWasm({ sha256, sizeBytes, exportsAbi = null }) {
  const codeHash = codeHashFromSha256Hex(sha256);
  return [
    check('not the callback-fault build', sha256 !== FAULT_BUILD_SHA256, sha256),
    check('SHA-256 matches the reviewed artifact', sha256 === APPROVED.sha256, `${sha256} vs ${APPROVED.sha256}`),
    check(
      'NEAR code hash matches the frontend pin',
      codeHash === APPROVED.codeHash,
      `${codeHash} vs ${APPROVED.codeHash}`,
    ),
    check('size matches the reviewed artifact', sizeBytes === APPROVED.sizeBytes, `${sizeBytes} bytes`),
    ...(exportsAbi === null
      ? []
      : [check('exports exactly the 12 ABI methods', exportsAbi, 'WebAssembly.Module.exports')]),
  ];
}

const yoctoToNear = (y) => {
  const whole = y / 10n ** 24n;
  const frac = (y % 10n ** 24n).toString().padStart(24, '0').slice(0, 4);
  return `${whole}.${frac} NEAR`;
};

/** Pre-deployment: dedicated, empty, single-key, sufficiently funded account. */
export function evaluateAccount({ account, keys, storageByteCostYocto, wasmBytes }) {
  if (account === null) {
    return [check('account exists', false, 'not found: create the dedicated account first (human step)')];
  }
  const balance = BigInt(account.amount);
  const usage = BigInt(account.storage_usage);
  const byteCost = BigInt(storageByteCostYocto);
  const storageBytes = BigInt(wasmBytes) + usage + BASE_STATE_ALLOWANCE_BYTES;
  const required = storageBytes * byteCost;
  const recommended = required + MARGIN_YOCTO;
  const fullAccess = keys.filter((k) => k.access_key.permission === 'FullAccess');
  return [
    check('account has no contract yet', account.code_hash === EMPTY_CODE_HASH, account.code_hash),
    check('exactly one access key', keys.length === 1, `${keys.length} keys`),
    check(
      'that key is FullAccess (retained by the operator for the pilot)',
      fullAccess.length === 1,
      'pilot key policy',
    ),
    check(
      'balance covers code + state storage',
      balance >= required,
      `${yoctoToNear(balance)} >= ${yoctoToNear(required)} (${storageBytes} bytes x ${byteCost} yocto/byte)`,
    ),
    check(
      'balance covers storage + 0.5 NEAR margin',
      balance >= recommended,
      `recommended ${yoctoToNear(recommended)}`,
    ),
  ];
}

/** Post-deployment, all reads at one final block. */
export function evaluatePostDeploy({ accountId, account, keys, config, accounting }) {
  const fullAccess = keys.filter((k) => k.access_key.permission === 'FullAccess');
  const caps = config?.capabilities ?? {};
  const onlyInstant =
    caps.instantNative === true &&
    ['protectedPay', 'handshake', 'merchantProfiles', 'nep141', 'sponsoredGas'].every((c) => caps[c] === false);
  const results = [
    check('code hash equals the approved pin', account?.code_hash === APPROVED.codeHash, account?.code_hash),
    check(
      'one retained FullAccess key, nothing else',
      keys.length === 1 && fullAccess.length === 1,
      `${keys.length} keys`,
    ),
    check('get_config.testFaultBuild is false', config?.testFaultBuild === false, String(config?.testFaultBuild)),
    check('get_config.contractId is this account', config?.contractId === accountId, config?.contractId),
    check('get_config.network is near-testnet', config?.network === 'near-testnet', config?.network),
    check('only instantNative capability', onlyInstant, JSON.stringify(caps)),
    check('quote version 1', config?.quoteVersion === '1', config?.quoteVersion),
  ];
  if (accounting) {
    const received = BigInt(accounting.receivedPrincipalYocto);
    const sum =
      BigInt(accounting.confirmedPaidYocto) +
      BigInt(accounting.failedHeldPrincipalYocto) +
      BigInt(accounting.inFlightPrincipalYocto);
    results.push(
      check(
        'balance covers runtime storage',
        BigInt(accounting.runtimeAccountBalanceYocto) >= BigInt(accounting.runtimeStorageCostYocto),
        `${yoctoToNear(BigInt(accounting.runtimeAccountBalanceYocto))} >= ${yoctoToNear(BigInt(accounting.runtimeStorageCostYocto))}`,
      ),
      check(
        'principal conserved (received = paid + failed-held + in-flight)',
        received === sum,
        `${received} = ${sum}`,
      ),
      check(
        'fresh deployment holds no principal',
        received === 0n && accounting.requestCount === '0',
        `requests ${accounting.requestCount}`,
      ),
    );
  } else {
    results.push(check('get_accounting readable', false, 'no response'));
  }
  return results;
}

// --- Read-only RPC ----------------------------------------------------------
const READ_METHODS = new Set(['status', 'block', 'query', 'EXPERIMENTAL_protocol_config']);
const READ_QUERIES = new Set(['view_account', 'view_access_key_list', 'call_function']);
const VIEW_METHODS = new Set(['get_config', 'get_accounting']);

export function createRpc(url, fetcher = globalThis.fetch) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('RPC must be https');
  let id = 0;
  return async (method, params) => {
    if (!READ_METHODS.has(method)) throw new Error(`refusing non-read RPC method ${method}`);
    if (method === 'query') {
      if (!READ_QUERIES.has(params.request_type)) throw new Error(`refusing query ${params.request_type}`);
      if (params.request_type === 'call_function' && !VIEW_METHODS.has(params.method_name)) {
        throw new Error(`refusing call_function ${params.method_name}`);
      }
    }
    const response = await fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: `preflight-${++id}`, method, params }),
    });
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    const body = await response.json();
    if (body.error) {
      const name = body.error.cause?.name ?? body.error.name ?? 'RPC_ERROR';
      const error = new Error(`RPC error ${name}`);
      error.rpcName = name;
      throw error;
    }
    return body.result;
  };
}

async function finalContext(rpc) {
  const status = await rpc('status', []);
  if (status.chain_id !== 'testnet' || status.genesis_hash !== TESTNET_GENESIS_HASH) {
    throw new Error(`not NEAR Testnet (chain ${status.chain_id})`);
  }
  const block = await rpc('block', { finality: 'final' });
  return block.header.hash;
}

async function viewAccount(rpc, accountId, blockId) {
  try {
    return await rpc('query', { request_type: 'view_account', account_id: accountId, block_id: blockId });
  } catch (error) {
    if (error.rpcName === 'UNKNOWN_ACCOUNT') return null;
    throw error;
  }
}

async function accessKeys(rpc, accountId, blockId) {
  const list = await rpc('query', { request_type: 'view_access_key_list', account_id: accountId, block_id: blockId });
  return list.keys;
}

async function callView(rpc, accountId, method, blockId) {
  try {
    const result = await rpc('query', {
      request_type: 'call_function',
      account_id: accountId,
      method_name: method,
      args_base64: Buffer.from('{}').toString('base64'),
      block_id: blockId,
    });
    return JSON.parse(Buffer.from(result.result).toString('utf8'));
  } catch {
    return null;
  }
}

function wasmFacts(path) {
  const bytes = readFileSync(path);
  let exportsAbi = null;
  try {
    const abi = JSON.parse(readFileSync(new URL('../../../contracts/payments/abi.json', import.meta.url), 'utf8'));
    const names = WebAssembly.Module.exports(new WebAssembly.Module(bytes))
      .filter((e) => e.kind === 'function')
      .map((e) => e.name)
      .sort();
    const expected = abi.methods.map((m) => m.name).sort();
    exportsAbi = names.length === expected.length && names.every((n, i) => n === expected[i]);
  } catch {
    exportsAbi = false;
  }
  return { sha256: sha256Hex(bytes), sizeBytes: bytes.length, exportsAbi };
}

function report(title, results) {
  console.log(`\n${title}`);
  for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    failed === 0
      ? '\nAll checks passed. Nothing was signed or sent.'
      : `\n${failed} check(s) failed. Nothing was signed or sent.`,
  );
  return failed === 0 ? 0 : 1;
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function main(argv) {
  const [command, target, ...rest] = argv;
  const rpcUrl = option(rest, '--rpc') ?? DEFAULT_RPC;
  try {
    if (command === 'wasm' && target) {
      return report(`WASM artifact ${target}`, evaluateWasm(wasmFacts(target)));
    }
    if (command === 'account' && target) {
      const wasmPath = option(rest, '--wasm');
      const wasmBytes = wasmPath ? readFileSync(wasmPath).length : APPROVED.sizeBytes;
      const rpc = createRpc(rpcUrl);
      const blockId = await finalContext(rpc);
      const account = await viewAccount(rpc, target, blockId);
      const keys = account === null ? [] : await accessKeys(rpc, target, blockId);
      const protocol = await rpc('EXPERIMENTAL_protocol_config', { block_id: blockId });
      const storageByteCostYocto = protocol.runtime_config.storage_amount_per_byte;
      return report(
        `Pre-deployment account ${target} @ final block ${blockId}`,
        evaluateAccount({ account, keys, storageByteCostYocto, wasmBytes }),
      );
    }
    if (command === 'post' && target) {
      const rpc = createRpc(rpcUrl);
      const blockId = await finalContext(rpc);
      const account = await viewAccount(rpc, target, blockId);
      const keys = account === null ? [] : await accessKeys(rpc, target, blockId);
      const config = await callView(rpc, target, 'get_config', blockId);
      const accounting = await callView(rpc, target, 'get_accounting', blockId);
      return report(
        `Post-deployment ${target} @ final block ${blockId}`,
        evaluatePostDeploy({ accountId: target, account, keys, config, accounting }),
      );
    }
  } catch (error) {
    console.error(`preflight error: ${error.message}`);
    return 2;
  }
  console.error(
    'usage: deploy-preflight.mjs wasm <file> | account <id> [--wasm <file>] [--rpc <url>] | post <id> [--rpc <url>]',
  );
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main(process.argv.slice(2));
}
