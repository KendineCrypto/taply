import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  APPROVED,
  EMPTY_CODE_HASH,
  FAULT_BUILD_SHA256,
  anchored,
  codeHashFromSha256Hex,
  createRpc,
  deployGasUpperBound,
  evaluateAccount,
  evaluatePostDeploy,
  evaluateWasm,
  isNamedTestnetAccount,
  main,
  minimumFunding,
  nearToYocto,
  sha256Hex,
} from '../../../../scripts/deploy-preflight.mjs';
import type { AccessKeyView } from '../../../../scripts/deploy-preflight.mjs';
import { CODE_HASH as HARNESS_PIN } from '@/test/chain';

/** Deterministic checks for the read-only deployment preflight. No network. */

const NEAR = 10n ** 24n;
const BYTE_COST = '10000000000000000000'; // 10^19 yoctoNEAR per byte (Testnet runtime config)
const KEY: AccessKeyView = { public_key: 'ed25519:Ops', access_key: { nonce: 1, permission: 'FullAccess' } };
const allPass = (checks: Array<{ ok: boolean }>) => checks.every((c) => c.ok);
const failed = (checks: Array<{ ok: boolean; name: string }>) => checks.filter((c) => !c.ok).map((c) => c.name);

describe('code hash derivation', () => {
  it('the reviewed SHA-256 encodes to the pinned NEAR code hash', () => {
    expect(codeHashFromSha256Hex(APPROVED.sha256)).toBe(APPROVED.codeHash);
  });

  it('32 zero bytes encode to the empty-code hash and leading zeros are kept', () => {
    expect(codeHashFromSha256Hex('0'.repeat(64))).toBe(EMPTY_CODE_HASH);
    expect(codeHashFromSha256Hex(`${'0'.repeat(62)}01`)).toBe('11111111111111111111111111111112');
    expect(HARNESS_PIN).toBe(EMPTY_CODE_HASH);
  });

  it('matches the known SHA-256 of the empty input', () => {
    expect(sha256Hex(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('rejects non-canonical hex', () => {
    expect(() => codeHashFromSha256Hex(APPROVED.sha256.toUpperCase())).toThrow();
  });
});

describe('evaluateWasm', () => {
  it('passes only the reviewed artifact', () => {
    expect(allPass(evaluateWasm({ sha256: APPROVED.sha256, sizeBytes: APPROVED.sizeBytes, exportsAbi: true }))).toBe(
      true,
    );
  });

  it('flags the callback-fault build', () => {
    expect(failed(evaluateWasm({ sha256: FAULT_BUILD_SHA256, sizeBytes: APPROVED.sizeBytes }))).toContain(
      'not the callback-fault build',
    );
  });

  it('flags any other artifact and wrong exports', () => {
    const checks = evaluateWasm({ sha256: 'ab'.repeat(32), sizeBytes: 1, exportsAbi: false });
    expect(failed(checks)).toEqual([
      'SHA-256 matches the reviewed artifact',
      'NEAR code hash matches the frontend pin',
      'size matches the reviewed artifact',
      'exports exactly the 12 ABI methods',
    ]);
  });

  it('CLI exits 1 for a file that is not the reviewed artifact, and 2 on usage errors', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'taply-preflight-'));
    const file = join(dir, 'not-payments.wasm');
    writeFileSync(file, new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await main(['wasm', file])).toBe(1);
    expect(await main(['deploy', 'x.testnet'])).toBe(2);
    log.mockRestore();
    err.mockRestore();
  });
});

/** Live Testnet runtime costs, protocol 88, read 2026-11-01 (EXPERIMENTAL_protocol_config). */
const PROTOCOL_88_COSTS = {
  action_receipt_creation_config: { execution: 108059500000, send_not_sir: 108059500000, send_sir: 108059500000 },
  action_creation_config: {
    deploy_contract_cost: { execution: 184765750000, send_not_sir: 184765750000, send_sir: 184765750000 },
    deploy_contract_cost_per_byte: { execution: 64572944, send_not_sir: 47683715, send_sir: 6812999 },
    function_call_cost: { execution: 780000000000, send_not_sir: 200000000000, send_sir: 200000000000 },
    function_call_cost_per_byte: { execution: 2235934, send_not_sir: 47683715, send_sir: 2235934 },
  },
};
const GAS_PRICE = '100000000'; // live gas_price, 10^8 yoctoNEAR per gas

describe('minimum funding model', () => {
  it('deploy + init gas upper bound for the reviewed artifact is 56.23 Tgas (live protocol 88 costs)', () => {
    expect(deployGasUpperBound(PROTOCOL_88_COSTS, APPROVED.sizeBytes)).toBe(56_232_442_989_503n);
  });

  it('minimum = storage after deploy (code + account + state allowance) + all gas bought up front', () => {
    const min = minimumFunding({
      wasmBytes: APPROVED.sizeBytes,
      storageUsage: 182,
      storageByteCostYocto: BYTE_COST,
      gasUnits: deployGasUpperBound(PROTOCOL_88_COSTS, APPROVED.sizeBytes),
      gasPriceYocto: GAS_PRICE,
    });
    expect(min.storageBytes).toBe(346_023n);
    expect(min.storageYocto).toBe(3_460_230_000_000_000_000_000_000n); // 3.46023 NEAR
    expect(min.gasYocto).toBe(5_623_244_298_950_300_000_000n); // 0.00562 NEAR
    expect(min.totalYocto).toBe(3_465_853_244_298_950_300_000_000n); // 3.46585 NEAR
  });

  it('parses NEAR amounts exactly', () => {
    expect(nearToYocto('3.5')).toBe(3_500_000_000_000_000_000_000_000n);
    expect(nearToYocto('0.03')).toBe(30_000_000_000_000_000_000_000n);
    expect(() => nearToYocto('1e3')).toThrow();
    expect(() => nearToYocto('-1')).toThrow();
  });

  it('accepts only named .testnet accounts', () => {
    expect(isNamedTestnetAccount('taply-pay-pilot-1.testnet')).toBe(true);
    expect(isNamedTestnetAccount('taply.near')).toBe(false);
    expect(isNamedTestnetAccount('a'.repeat(64))).toBe(false);
    expect(isNamedTestnetAccount('Taply.testnet')).toBe(false);
    expect(isNamedTestnetAccount('testnet')).toBe(false);
  });
});

describe('evaluateAccount (pre-deployment)', () => {
  const account = (yocto: bigint, code = EMPTY_CODE_HASH) => ({
    amount: yocto.toString(),
    storage_usage: 182,
    code_hash: code,
  });
  const run = (
    acct: ReturnType<typeof account> | null,
    keys: AccessKeyView[] = [KEY],
    accountId = 'taply-pay-pilot-1.testnet',
  ) =>
    evaluateAccount({
      accountId,
      account: acct,
      keys,
      storageByteCostYocto: BYTE_COST,
      wasmBytes: APPROVED.sizeBytes,
      gasUnits: deployGasUpperBound(PROTOCOL_88_COSTS, APPROVED.sizeBytes),
      gasPriceYocto: GAS_PRICE,
    });

  it('3.5 NEAR (recommended funding) on a fresh single-key account passes', () => {
    expect(allPass(run(account(nearToYocto('3.5'))))).toBe(true);
  });

  it('3.47 NEAR covers the minimum but not the 0.03 NEAR buffer', () => {
    expect(failed(run(account(nearToYocto('3.47'))))).toEqual(['balance covers the minimum + buffer']);
  });

  it('3.46 NEAR does not cover the minimum', () => {
    expect(failed(run(account(nearToYocto('3.46'))))).toContain(
      'balance covers the minimum (storage after deploy + up-front deploy gas)',
    );
  });

  it('refuses a reused account (code already deployed) or extra keys', () => {
    const extra: AccessKeyView = {
      public_key: 'ed25519:Other',
      access_key: { nonce: 1, permission: { FunctionCall: {} } },
    };
    expect(failed(run(account(nearToYocto('10'), APPROVED.codeHash), [KEY, extra]))).toEqual([
      'account has no contract yet',
      'exactly one access key',
    ]);
  });

  it('refuses a mainnet-style account name', () => {
    expect(failed(run(account(nearToYocto('3.5')), [KEY], 'taply.near'))).toEqual(['named .testnet account']);
  });

  it('reports a missing account as a human step, not an error', () => {
    expect(failed(run(null, []))).toEqual(['account exists']);
  });
});

describe('evaluatePostDeploy', () => {
  const config = {
    network: 'near-testnet',
    contractId: 'taply-pay.testnet',
    capabilities: {
      instantNative: true,
      protectedPay: false,
      handshake: false,
      merchantProfiles: false,
      nep141: false,
      sponsoredGas: false,
    },
    quoteVersion: '1',
    testFaultBuild: false,
  };
  const accounting = {
    receivedPrincipalYocto: '0',
    confirmedPaidYocto: '0',
    failedHeldPrincipalYocto: '0',
    inFlightPrincipalYocto: '0',
    requestCount: '0',
    runtimeStorageCostYocto: (3_460_000n * 10n ** 18n).toString(),
    runtimeAccountBalanceYocto: (4n * NEAR).toString(),
  };
  const base = {
    accountId: 'taply-pay.testnet',
    account: { code_hash: APPROVED.codeHash },
    keys: [KEY],
    config,
    accounting,
  };

  it('passes a correct fresh deployment with the retained pilot key', () => {
    expect(allPass(evaluatePostDeploy(base))).toBe(true);
  });

  it('the "no requests" check runs only with --fresh, so monitoring after the pilot payment still passes', () => {
    const used = { ...accounting, requestCount: '1', receivedPrincipalYocto: '5', confirmedPaidYocto: '5' };
    expect(allPass(evaluatePostDeploy({ ...base, accounting: used }))).toBe(true);
    expect(failed(evaluatePostDeploy({ ...base, accounting: used, fresh: true }))).toEqual([
      'fresh deployment holds no principal',
    ]);
  });

  it('--expect-key detects any use of the retained key (nonce change) or a swapped key', () => {
    expect(allPass(evaluatePostDeploy({ ...base, expectKey: 'ed25519:Ops:1' }))).toBe(true);
    expect(failed(evaluatePostDeploy({ ...base, expectKey: 'ed25519:Ops:0' }))).toEqual([
      'retained key unchanged since baseline (unused)',
    ]);
    expect(failed(evaluatePostDeploy({ ...base, expectKey: 'ed25519:Other:1' }))).toEqual([
      'retained key unchanged since baseline (unused)',
    ]);
  });

  it.each([
    ['wrong code', { account: { code_hash: EMPTY_CODE_HASH } }, 'code hash equals the approved pin'],
    ['fault build', { config: { ...config, testFaultBuild: true } }, 'get_config.testFaultBuild is false'],
    ['extra key', { keys: [KEY, { ...KEY, public_key: 'ed25519:Two' }] }, 'one retained FullAccess key, nothing else'],
    ['deleted key', { keys: [] }, 'one retained FullAccess key, nothing else'],
    [
      'capability on',
      { config: { ...config, capabilities: { ...config.capabilities, protectedPay: true } } },
      'only instantNative capability',
    ],
    [
      'other contract id',
      { config: { ...config, contractId: 'other.testnet' } },
      'get_config.contractId is this account',
    ],
    [
      'underfunded',
      { accounting: { ...accounting, runtimeAccountBalanceYocto: '1' } },
      'balance covers runtime storage',
    ],
    ['unreadable accounting', { accounting: null }, 'get_accounting readable'],
  ])('fails on %s', (_label, change, expected) => {
    expect(failed(evaluatePostDeploy({ ...base, ...change }))).toContain(expected);
  });
});

describe('read-only RPC guard', () => {
  const ok = async (_url: string, init: RequestInit) =>
    new Response(
      JSON.stringify({ jsonrpc: '2.0', id: (JSON.parse(String(init.body)) as { id: string }).id, result: {} }),
    );

  it('refuses every write-capable method and non-view calls', async () => {
    const rpc = createRpc('https://rpc.testnet.near.org', ok);
    await expect(rpc('send_tx', {})).rejects.toThrow(/refusing/);
    await expect(rpc('broadcast_tx_commit', [])).rejects.toThrow(/refusing/);
    await expect(rpc('query', { request_type: 'call_function', method_name: 'pay_instant_native' })).rejects.toThrow(
      /refusing/,
    );
    await expect(rpc('query', { request_type: 'view_state' })).rejects.toThrow(/refusing/);
    await expect(rpc('query', { request_type: 'call_function', method_name: 'get_config' })).resolves.toEqual({});
  });

  it('refuses a response whose JSON-RPC id does not match the request', async () => {
    const rpc = createRpc(
      'https://rpc.testnet.near.org',
      async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 'someone-else', result: {} })),
    );
    await expect(rpc('status', [])).rejects.toThrow(/id mismatch/);
  });

  it('refuses query results that are not anchored to the requested block', () => {
    expect(() => anchored({ block_hash: 'other' }, 'wanted')).toThrow(/anchored/);
    expect(anchored({ block_hash: 'wanted', x: 1 }, 'wanted')).toEqual({ block_hash: 'wanted', x: 1 });
  });

  it('refuses a non-https endpoint', () => {
    expect(() => createRpc('http://rpc.testnet.near.org')).toThrow();
  });
});
