import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { fixtureRequests } from '../fixtures';

const mock = vi.hoisted(() => ({ readRequest: vi.fn() }));
vi.mock('@taply/near-client', async original => ({ ...await original<Record<string, unknown>>(), createMainnetReader: () => mock }));
vi.mock('../config', () => ({ MAINNET_CONFIG: { ok: true, profile: {}, fixtures: false } }));
const { useMainnetRequest } = await import('../hooks');
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('never shows the prior merchant request when navigation to a different id fails', async () => {
  const paid = fixtureRequests(Date.now()).find(e => e.scenario.name === 'usdc-recorded')!.request;
  mock.readRequest.mockResolvedValueOnce({ data: paid }).mockRejectedValue(new Error('RPC outage'));
  const { result, rerender } = renderHook(({ id }) => useMainnetRequest(id, false), { initialProps: { id: paid.terms.id } });
  await waitFor(() => expect(result.current.read.kind).toBe('ok'));
  rerender({ id: 'e'.repeat(64) });
  await waitFor(() => expect(result.current.read.kind).toBe('error'));
});
