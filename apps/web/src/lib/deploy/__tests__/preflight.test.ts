import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  APPROVED,
  EMPTY_CODE_HASH,
  FAULT_BUILD_SHA256,
  codeHashFromSha256Hex,
  createRpc,
  evaluateAccount,
  evaluatePostDeploy,
  evaluateWasm,
  main,
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

describe('evaluateAccount (pre-deployment)', () => {
  const account = (near: bigint, code = EMPTY_CODE_HASH) => ({
    amount: (near * NEAR).toString(),
    storage_usage: 182,
    code_hash: code,
  });
  const run = (acct: ReturnType<typeof account> | null, keys: AccessKeyView[] = [KEY]) =>
    evaluateAccount({ account: acct, keys, storageByteCostYocto: BYTE_COST, wasmBytes: APPROVED.sizeBytes });

  it('4 NEAR on a fresh single-key account passes (about 3.46 NEAR storage + 0.5 margin)', () => {
    expect(allPass(run(account(4n)))).toBe(true);
  });

  it('3.5 NEAR covers storage but not the margin', () => {
    expect(failed(run({ ...account(0n), amount: ((35n * NEAR) / 10n).toString() }))).toEqual([
      'balance covers storage + 0.5 NEAR margin',
    ]);
  });

  it('3 NEAR does not cover storage', () => {
    expect(failed(run(account(3n)))).toContain('balance covers code + state storage');
  });

  it('refuses a reused account (code already deployed) or extra keys', () => {
    const extra: AccessKeyView = { public_key: 'ed25519:Other', access_key: { nonce: 1, permission: { FunctionCall: {} } } };
    expect(failed(run(account(10n, APPROVED.codeHash), [KEY, extra]))).toEqual([
      'account has no contract yet',
      'exactly one access key',
    ]);
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
    ['other contract id', { config: { ...config, contractId: 'other.testnet' } }, 'get_config.contractId is this account'],
    ['underfunded', { accounting: { ...accounting, runtimeAccountBalanceYocto: '1' } }, 'balance covers runtime storage'],
    ['unreadable accounting', { accounting: null }, 'get_accounting readable'],
  ])('fails on %s', (_label, change, expected) => {
    expect(failed(evaluatePostDeploy({ ...base, ...change }))).toContain(expected);
  });
});

describe('read-only RPC guard', () => {
  const ok = async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 'x', result: {} }));

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

  it('refuses a non-https endpoint', () => {
    expect(() => createRpc('http://rpc.testnet.near.org')).toThrow();
  });
});
