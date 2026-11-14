import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const reader = vi.hoisted(() => ({ readGift: vi.fn() }));
vi.mock('@taply/near-client', async original => ({ ...await original<Record<string, unknown>>(), createMainnetGiftReader: () => reader }));
vi.mock('../gift-profile', () => ({ GIFT_PROFILE: {} }));
const { useMainnetGift } = await import('../use-gift');
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
const response = (id: string, payout: string | null = null) => ({ data: { id, payout }, config: {}, timestampNs: '1000' });
it('polls a gift through pending to confirmed without any signing or payout retry', async () => {
  vi.useFakeTimers(); reader.readGift.mockResolvedValueOnce(response('a')).mockResolvedValueOnce(response('a', 'PENDING')).mockResolvedValue(response('a', 'CONFIRMED'));
  const { result } = renderHook(() => useMainnetGift('a'));
  await act(async () => {}); expect(result.current.read.kind).toBe('ok');
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(result.current.read.kind === 'ok' && result.current.read.data.payout).toBe('PENDING');
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(result.current.read.kind === 'ok' && result.current.read.data.payout).toBe('CONFIRMED');
  expect(reader.readGift).toHaveBeenCalledTimes(3);
});
it('a late response for the prior gift cannot replace the current gift', async () => {
  let finish: (value: unknown) => void = () => {};
  reader.readGift.mockImplementationOnce(() => new Promise(r => { finish = r; })).mockResolvedValue(response('b'));
  const { result, rerender } = renderHook(({ id }) => useMainnetGift(id), { initialProps: { id: 'a' } });
  rerender({ id: 'b' }); await waitFor(() => expect(result.current.read.kind).toBe('ok'));
  await act(async () => { finish(response('a', 'CONFIRMED')); });
  expect(result.current.read.kind === 'ok' && result.current.read.data.id).toBe('b');
});
it('read failure replaces stale success; focus and explicit refresh recover from the chain', async () => {
  reader.readGift.mockResolvedValueOnce(response('a', 'CONFIRMED')).mockRejectedValueOnce(Error('RPC unavailable')).mockResolvedValue(response('a'));
  const { result } = renderHook(() => useMainnetGift('a'));
  await waitFor(() => expect(result.current.read.kind).toBe('ok'));
  act(() => result.current.refresh()); await waitFor(() => expect(result.current.read.kind).toBe('error'));
  act(() => window.dispatchEvent(new Event('focus'))); await waitFor(() => expect(result.current.read.kind).toBe('ok'));
  expect(reader.readGift).toHaveBeenCalledTimes(3);
});
it('unmount removes polling and focus listeners', async () => {
  vi.useFakeTimers(); reader.readGift.mockResolvedValue(response('a'));
  const { unmount } = renderHook(() => useMainnetGift('a')); await act(async () => {}); unmount();
  await vi.advanceTimersByTimeAsync(12000); window.dispatchEvent(new Event('focus'));
  expect(reader.readGift).toHaveBeenCalledTimes(1);
});
