import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@taply/near-client', async original => ({ ...await original<Record<string, unknown>>(), createMainnetAccountReader: (p: { rpcUrl: string }) => ({ readBalances: (id: string) => state.read(p.rpcUrl, id) }) }));
import { NearClientError } from '@taply/near-client';
import { readMainnetDisplayBalances } from '../balance-read';
const profile = { network: 'near-mainnet' as const, rpcUrl: 'https://rpc.mainnet.fastnear.com' as const, rpcProviderId: 'primary' };
afterEach(() => { state.read.mockReset(); });
it('a timeout uses a complete archival snapshot instead of losing the balance', async () => {
  const balance = { native: '169080818282300900000000', usdc: '0', blockHash: 'one-final-block' };
  state.read.mockRejectedValueOnce(new NearClientError('RPC_TIMEOUT')).mockResolvedValueOnce(balance);
  expect(await readMainnetDisplayBalances('alice.near', profile)).toBe(balance);
  expect(state.read.mock.calls.map(c => c[0])).toEqual(['https://rpc.mainnet.fastnear.com', 'https://archival-rpc.mainnet.fastnear.com']);
});
it('wrong-network or contradictory evidence is not hidden by another provider', async () => {
  for (const code of ['NETWORK_MISMATCH', 'EVIDENCE_MISMATCH'] as const) {
    state.read.mockReset(); state.read.mockRejectedValue(new NearClientError(code));
    await expect(readMainnetDisplayBalances('alice.near', profile)).rejects.toMatchObject({ code });
    expect(state.read).toHaveBeenCalledTimes(1);
  }
});
it('all providers unavailable remains an error, never a fabricated zero', async () => {
  state.read.mockRejectedValue(new NearClientError('RPC_UNAVAILABLE'));
  await expect(readMainnetDisplayBalances('alice.near', profile)).rejects.toMatchObject({ code: 'RPC_UNAVAILABLE' });
  expect(state.read).toHaveBeenCalledTimes(3);
});
