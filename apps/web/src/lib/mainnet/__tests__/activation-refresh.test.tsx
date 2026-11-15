import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { MainnetWalletIdentity } from '@taply/near-client';
const state = vi.hoisted(() => ({ snapshot: vi.fn(async () => null) }));
vi.mock('@taply/near-client', async original => ({ ...await original<Record<string, unknown>>(), createMainnetWalletChain: () => ({ snapshot: state.snapshot }) }));
vi.mock('../config', () => ({ MAINNET_CONFIG: { ok: true, network: 'near-mainnet', rpcUrl: 'https://rpc.mainnet.fastnear.com', rpcProviderId: 'test' } }));
const { useActivation } = await import('@/components/mainnet/Wallet');
afterEach(() => { cleanup(); state.snapshot.mockClear(); });
it('unlock/render changes do not reread activation; explicit refresh and a different key do', async () => {
  const identity: MainnetWalletIdentity = { network: 'near-mainnet', accountId: 'alice.near', publicKeyHex: 'a'.repeat(64), provisioning: 'LOCAL_ONLY', recovery: 'RECOVERY_PHRASE' };
  const { result, rerender } = renderHook(({ id, tick }) => useActivation(id, tick), { initialProps: { id: identity, tick: 0 } });
  await waitFor(() => expect(result.current.kind).toBe('not_activated'));
  rerender({ id: { ...identity }, tick: 0 });
  expect(state.snapshot).toHaveBeenCalledTimes(1);
  rerender({ id: { ...identity }, tick: 1 });
  await waitFor(() => expect(state.snapshot).toHaveBeenCalledTimes(2));
  rerender({ id: { ...identity, publicKeyHex: 'b'.repeat(64) }, tick: 1 });
  await waitFor(() => expect(state.snapshot).toHaveBeenCalledTimes(3));
});
