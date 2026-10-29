import { describe, expect, it } from 'vitest';
import type { NativeBalance, ReadResult, RpcErrorCode } from '@taply/near-client';
import { classifyAccountId, isRejectedAccount, shortAccountId } from '../account';
import { displayableBalance, nextBalanceView } from '../balance';
import type { BalanceView } from '../balance';
import { DEFAULT_TESTNET_RPC_URL, explorerAccountUrl, resolveChainConfig } from '../config';

const ACCOUNT = 'alice.testnet';
const BLOCK = { hash: '1328yXzKFJMjYN1m7dZiqCsX68o7WF5eAvT1qYkrVFX', height: '275322097', timestampNs: '1793289882103894449' };
const BALANCE: NativeBalance = {
  accountId: ACCOUNT,
  assetId: 'near:native',
  amountYoctoNear: '1015695997481455830262305522945',
  lockedYoctoNear: '0',
  storageUsageBytes: '1186783',
};

function ok(overrides: Partial<ReadResult<NativeBalance>['observation']> = {}): ReadResult<NativeBalance> {
  return {
    observation: {
      source: 'rpc',
      assurance: 'verified_final',
      data: BALANCE,
      observedBlock: BLOCK,
      checkedAt: '2026-10-29T16:04:56.240Z',
      stale: false,
      rpcAvailable: true,
      ...overrides,
    },
    error: null,
  };
}

function failed(code: RpcErrorCode): ReadResult<NativeBalance> {
  return {
    observation: {
      source: 'rpc',
      assurance: 'unknown',
      data: null,
      observedBlock: null,
      checkedAt: '2026-10-29T16:05:00.000Z',
      stale: false,
      rpcAvailable: code !== 'RPC_UNAVAILABLE',
    },
    error: { code, messageKey: `nearClient.errors.${code}`, retry: 'READ_ONLY', providerId: 'near-public-testnet' },
  };
}

const LOADING: BalanceView = { kind: 'loading' };

describe('resolveChainConfig', () => {
  it('defaults to the public Testnet RPC with no contract', () => {
    const result = resolveChainConfig({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.client.network).toBe('near-testnet');
    expect(result.client.rpcUrl).toBe(DEFAULT_TESTNET_RPC_URL);
    expect(result.client.contract).toBeNull();
  });

  it('treats empty env strings as unset', () => {
    expect(resolveChainConfig({ network: '', rpcUrl: '', rpcProviderId: '' }).ok).toBe(true);
  });

  it('refuses any network other than near-testnet (no mainnet fallback)', () => {
    expect(resolveChainConfig({ network: 'near-mainnet' })).toEqual({ ok: false, reason: 'wrong_network' });
    expect(resolveChainConfig({ network: 'mainnet' })).toEqual({ ok: false, reason: 'wrong_network' });
  });

  it('refuses non-HTTPS, credentialed or parameterised RPC URLs', () => {
    for (const rpcUrl of [
      'http://rpc.testnet.near.org',
      'https://user:pass@rpc.example.org',
      'https://rpc.example.org/?apiKey=secret',
      'https://rpc.example.org/#frag',
      'not a url',
    ]) {
      expect(resolveChainConfig({ rpcUrl }), rpcUrl).toEqual({ ok: false, reason: 'invalid_rpc_url' });
    }
  });

  it('builds encoded explorer account links without a trailing slash', () => {
    const result = resolveChainConfig({ explorerBaseUrl: 'https://testnet.nearblocks.io/' });
    expect(result.ok && result.explorerBaseUrl).toBe('https://testnet.nearblocks.io');
    expect(explorerAccountUrl('https://testnet.nearblocks.io', 'a.testnet')).toBe(
      'https://testnet.nearblocks.io/address/a.testnet',
    );
  });
});

describe('classifyAccountId', () => {
  it('recognises Testnet, implicit and ETH-implicit accounts', () => {
    expect(classifyAccountId('alice.testnet')).toBe('testnet_named');
    expect(classifyAccountId('testnet')).toBe('testnet_named');
    expect(classifyAccountId('a'.repeat(64))).toBe('implicit');
    expect(classifyAccountId(`0x${'b'.repeat(40)}`)).toBe('eth_implicit');
  });

  it('flags .near as likely mainnet but does not reject it (near exists on Testnet)', () => {
    expect(classifyAccountId('alice.near')).toBe('likely_mainnet');
    expect(isRejectedAccount('likely_mainnet')).toBe(false);
  });

  it('rejects syntactically invalid IDs', () => {
    for (const bad of ['', 'UPPER.testnet', 'a', 'has space.testnet', '-lead.testnet']) {
      expect(classifyAccountId(bad), bad).toBe('invalid');
    }
    expect(isRejectedAccount('invalid')).toBe(true);
  });

  it('shortens only long IDs', () => {
    expect(shortAccountId('alice.testnet')).toBe('alice.testnet');
    expect(shortAccountId('a'.repeat(64))).toBe(`${'a'.repeat(8)}…${'a'.repeat(8)}`);
  });
});

describe('nextBalanceView - never an invented balance', () => {
  it('shows a finalized Testnet RPC read', () => {
    const view = nextBalanceView(LOADING, ACCOUNT, ok());
    expect(view.kind).toBe('verified');
    expect(displayableBalance(view)?.balance.amountYoctoNear).toBe(BALANCE.amountYoctoNear);
  });

  it.each([
    ['mock source', { source: 'mock' as const }],
    ['unverified assurance', { assurance: 'unverified' as const }],
    ['pending finality', { assurance: 'pending_finality' as const }],
    ['stale observation', { stale: true }],
    ['rpc unavailable', { rpcAvailable: false }],
    ['missing block', { observedBlock: null }],
    ['null data', { data: null }],
    ['different account', { data: { ...BALANCE, accountId: 'mallory.testnet' } }],
  ])('shows no number for %s', (_label, overrides) => {
    const view = nextBalanceView(LOADING, ACCOUNT, ok(overrides));
    expect(view.kind).toBe('unverified');
    expect(displayableBalance(view)).toBeNull();
  });

  it('maps ACCOUNT_NOT_FOUND to not_found, never to zero', () => {
    const view = nextBalanceView(LOADING, ACCOUNT, failed('ACCOUNT_NOT_FOUND'));
    expect(view.kind).toBe('not_found');
    expect(displayableBalance(view)).toBeNull();
  });

  it('keeps the last verified value as stale through an outage', () => {
    const verified = nextBalanceView(LOADING, ACCOUNT, ok());
    const view = nextBalanceView(verified, ACCOUNT, failed('RPC_TIMEOUT'));
    expect(view.kind).toBe('stale');
    expect(displayableBalance(view)?.checkedAt).toBe('2026-10-29T16:04:56.240Z');
  });

  it.each(['ACCOUNT_NOT_FOUND', 'NETWORK_MISMATCH', 'EVIDENCE_MISMATCH'] as const)(
    'discards a previous value after %s',
    (code) => {
      const verified = nextBalanceView(LOADING, ACCOUNT, ok());
      expect(displayableBalance(nextBalanceView(verified, ACCOUNT, failed(code)))).toBeNull();
    },
  );

  it('never carries a previous balance over to a different account', () => {
    const verified = nextBalanceView(LOADING, ACCOUNT, ok());
    const view = nextBalanceView(verified, 'bob.testnet', failed('RPC_TIMEOUT'));
    expect(view).toEqual({ kind: 'error', errorCode: 'RPC_TIMEOUT' });
  });

  it('reports a first-read outage as an error without a number', () => {
    const view = nextBalanceView(LOADING, ACCOUNT, failed('RPC_UNAVAILABLE'));
    expect(view).toEqual({ kind: 'error', errorCode: 'RPC_UNAVAILABLE' });
  });
});
