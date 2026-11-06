import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeBalance, ReadResult } from '@taply/near-client';
import { JOIN_WINDOW_MS, useNativeBalance } from '../use-native-balance';

/**
 * Phase 5C: identical overlapping balance reads are coalesced, a later refresh
 * is never lost, and nothing is shared across accounts or providers.
 */

interface Pending {
  readonly accountId: string;
  readonly client: string;
  resolve: (value: ReadResult<NativeBalance>) => void;
}

let pending: Pending[] = [];

function client(name: string) {
  return {
    readNativeBalance: vi.fn(
      (accountId: string) =>
        new Promise<ReadResult<NativeBalance>>((resolve) => {
          pending.push({ accountId, client: name, resolve });
        }),
    ),
  };
}

function balance(accountId: string, yocto: string): ReadResult<NativeBalance> {
  return {
    observation: {
      source: 'rpc',
      assurance: 'verified_final',
      data: { accountId, assetId: 'near:native', amountYoctoNear: yocto, lockedYoctoNear: '0', storageUsageBytes: '100' },
      observedBlock: { hash: 'h', height: '10', timestampNs: '1' },
      checkedAt: '2026-11-01T00:00:00.000Z',
      stale: false,
      rpcAvailable: true,
    },
    error: null,
  };
}

async function answer(index: number, yocto: string) {
  const p = pending[index];
  if (p === undefined) throw new Error(`no read #${index}`);
  await act(async () => {
    p.resolve(balance(p.accountId, yocto));
  });
}

const amountOf = (view: unknown) =>
  (view as { kind: string; balance?: { amountYoctoNear: string } }).balance?.amountYoctoNear ?? (view as { kind: string }).kind;

let clock = 1_000_000;
beforeEach(() => {
  pending = [];
  clock = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
});
afterEach(() => vi.restoreAllMocks());

function visible() {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useNativeBalance', () => {
  it('coalesces a resume read and a manual refresh that arrive together', async () => {
    const rpc = client('p1');
    const { result } = renderHook(() => useNativeBalance(rpc, 'alice.testnet'));
    act(() => {
      visible();
      result.current.refresh();
    });
    expect(rpc.readNativeBalance).toHaveBeenCalledTimes(1);
    await answer(0, '5');
    expect(amountOf(result.current.view)).toBe('5');
    expect(result.current.refreshing).toBe(false);
  });

  it('does not lose a refresh that arrives after the in-flight read started: exactly one follow-up', async () => {
    const rpc = client('p1');
    const { result } = renderHook(() => useNativeBalance(rpc, 'alice.testnet'));
    clock += JOIN_WINDOW_MS + 1;
    act(() => {
      result.current.refresh();
      result.current.refresh();
      visible();
    });
    expect(rpc.readNativeBalance).toHaveBeenCalledTimes(1);
    await answer(0, '5');
    // The follow-up is running; the spinner stays on until it lands.
    expect(rpc.readNativeBalance).toHaveBeenCalledTimes(2);
    expect(result.current.refreshing).toBe(true);
    await answer(1, '7');
    expect(amountOf(result.current.view)).toBe('7');
    expect(result.current.refreshing).toBe(false);
    expect(rpc.readNativeBalance).toHaveBeenCalledTimes(2);
  });

  it('an account switch never joins the old read, and the old balance is never shown', async () => {
    const rpc = client('p1');
    const { result, rerender } = renderHook(({ id }) => useNativeBalance(rpc, id), { initialProps: { id: 'alice.testnet' } });
    rerender({ id: 'bob.testnet' });
    expect(pending.map((p) => p.accountId)).toEqual(['alice.testnet', 'bob.testnet']);
    await answer(0, '111'); // alice, late
    expect(result.current.view.kind).toBe('loading');
    await answer(1, '222');
    expect(amountOf(result.current.view)).toBe('222');
  });

  it('a provider switch for the same account starts a new read and drops the old provider’s result', async () => {
    const first = client('p1');
    const second = client('p2');
    const { result, rerender } = renderHook(({ c }) => useNativeBalance(c, 'alice.testnet'), { initialProps: { c: first } });
    rerender({ c: second });
    expect(pending.map((p) => p.client)).toEqual(['p1', 'p2']);
    await answer(0, '111');
    expect(amountOf(result.current.view)).not.toBe('111');
    await answer(1, '222');
    expect(amountOf(result.current.view)).toBe('222');
  });

  it('under StrictMode (mount, cleanup, mount) the balance still loads: no join to the dropped read', async () => {
    const rpc = client('p1');
    const { result } = renderHook(() => useNativeBalance(rpc, 'alice.testnet'), { wrapper: StrictMode });
    expect(rpc.readNativeBalance).toHaveBeenCalledTimes(2);
    await answer(0, '1'); // from the discarded first mount
    expect(result.current.view.kind).toBe('loading');
    await answer(1, '2');
    expect(amountOf(result.current.view)).toBe('2');
  });
});
