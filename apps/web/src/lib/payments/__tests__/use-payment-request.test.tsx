import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePaymentRequest } from '../use-payment-request';

/**
 * Phase 5C: status reads must never show a result for a request/account/reader
 * that is no longer current, and a read requested while another is in flight
 * must still happen (with the newest parameters).
 */

interface Pending {
  readonly id: string;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

let calls: Pending[] = [];
const reader = {
  readPaymentRequest: vi.fn(
    (id: string) =>
      new Promise((resolve, reject) => {
        calls.push({ id, resolve, reject });
      }),
  ),
};
let accountId: string | null = 'payer.testnet';
let setup: { status: 'ready'; reader: typeof reader; contractId: string } = { status: 'ready', reader, contractId: 'pay.testnet' };

vi.mock('@/lib/wallet/provider', () => ({ useAccountId: () => accountId }));
vi.mock('../context', () => ({ usePayments: () => ({ setup }) }));
// The view is reduced to "which id and account was this read for".
vi.mock('../intent', () => ({
  buildPaymentView: ({ read, accountId: who }: { read: { id: string }; accountId: string | null }) => ({
    kind: 'marker',
    id: read.id,
    accountId: who,
  }),
}));

const ID_A = 'a'.repeat(64);
const ID_B = 'b'.repeat(64);

function read(id: string) {
  return { id, observation: { checkedAt: '2026-11-01T00:00:00.000Z', observedBlock: { hash: 'h', height: '1', timestampNs: '1' } } };
}

async function settle(index: number) {
  const call = calls[index];
  if (call === undefined) throw new Error(`no read #${index}`);
  await act(async () => {
    call.resolve(read(call.id));
  });
}

const marker = (view: unknown) => view as { id: string; accountId: string | null } | null;

beforeEach(() => {
  calls = [];
  reader.readPaymentRequest.mockClear();
  accountId = 'payer.testnet';
  setup = { status: 'ready', reader, contractId: 'pay.testnet' };
});
afterEach(() => vi.restoreAllMocks());

describe('usePaymentRequest', () => {
  it('switching A -> B during a slow read never shows A, and B is still read', async () => {
    const { result, rerender } = renderHook(({ id }) => usePaymentRequest(id, false), { initialProps: { id: ID_A } });
    expect(calls.map((c) => c.id)).toEqual([ID_A]);
    rerender({ id: ID_B });
    expect(result.current.view).toBeNull();
    expect(result.current.loading).toBe(true);
    // A answers late: dropped. The queued read for B starts right after.
    await settle(0);
    expect(result.current.view).toBeNull();
    expect(calls.map((c) => c.id)).toEqual([ID_A, ID_B]);
    await settle(1);
    expect(marker(result.current.view)).toEqual({ kind: 'marker', id: ID_B, accountId: 'payer.testnet' });
    expect(result.current.loading).toBe(false);
  });

  it('a payer account switch during a read drops the old role and re-reads for the new account', async () => {
    const { result, rerender } = renderHook(() => usePaymentRequest(ID_A, false));
    accountId = 'other.testnet';
    rerender();
    await settle(0);
    expect(result.current.view).toBeNull();
    expect(calls).toHaveLength(2);
    await settle(1);
    expect(marker(result.current.view)?.accountId).toBe('other.testnet');
  });

  it('a reader (provider) change never shows the old provider’s result', async () => {
    const { result, rerender } = renderHook(() => usePaymentRequest(ID_A, false));
    const other = { readPaymentRequest: reader.readPaymentRequest };
    setup = { status: 'ready', reader: { ...other }, contractId: 'pay.testnet' };
    rerender();
    await settle(0);
    expect(result.current.view).toBeNull();
    expect(calls).toHaveLength(2);
    await settle(1);
    expect(marker(result.current.view)?.id).toBe(ID_A);
  });

  it('refreshes requested mid-read are queued into exactly one more read', async () => {
    const { result } = renderHook(() => usePaymentRequest(ID_A, false));
    act(() => {
      result.current.refresh();
      result.current.refresh();
      result.current.refresh();
    });
    expect(calls).toHaveLength(1);
    await settle(0);
    expect(calls).toHaveLength(2);
    await settle(1);
    expect(calls).toHaveLength(2);
  });

  it('after unmount nothing is applied and no queued read starts', async () => {
    const { result, unmount } = renderHook(() => usePaymentRequest(ID_A, false));
    act(() => result.current.refresh());
    unmount();
    await act(async () => {
      calls[0]?.resolve(read(ID_A));
    });
    expect(calls).toHaveLength(1);
  });

  it('reads again when the tab becomes visible', async () => {
    const { result } = renderHook(() => usePaymentRequest(ID_A, false));
    await settle(0);
    expect(marker(result.current.view)?.id).toBe(ID_A);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(calls).toHaveLength(2);
    // The previous (still current) view stays visible while re-reading.
    expect(marker(result.current.view)?.id).toBe(ID_A);
  });

  it('a failed read for a stale request is dropped too', async () => {
    const { result, rerender } = renderHook(({ id }) => usePaymentRequest(id, false), { initialProps: { id: ID_A } });
    rerender({ id: ID_B });
    await act(async () => {
      calls[0]?.reject(new Error('boom'));
    });
    expect(result.current.view).toBeNull();
    await settle(1);
    expect(marker(result.current.view)?.id).toBe(ID_B);
  });
});
