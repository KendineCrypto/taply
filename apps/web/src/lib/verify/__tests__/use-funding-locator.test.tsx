import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIXTURES } from '@/test/chain';
import { useFundingLocator } from '../use-funding-locator';
import { buildLocatorChain, fakeLocatorRpc, payCall } from './fake-locator';

/** Phase 7G: background-tab and re-render behaviour of the locator hook. Synthetic chain only. */

const paid = FIXTURES.paidRestricted;
const HASH = '9x5BWFTV7ZcFDXxHyLsdNFHD5KQdXLfwQdgs6GPdShfJ';

function chain() {
  const c = buildLocatorChain({ fundedAtNs: paid.fundedAtNs ?? '0', fundingHeight: 7_000 });
  c.txs.set(6_999, [{ hash: HASH, signer_id: paid.payerAccountId ?? '', receiver_id: paid.terms.contractId, actions: [payCall(paid.terms.id)] }]);
  return c;
}

function Probe({ rpc, enabled = true, generation = 0 }: { rpc: ReturnType<typeof fakeLocatorRpc>; enabled?: boolean; generation?: number }) {
  const view = useFundingLocator({ rpc, contractId: paid.terms.contractId, request: paid, enabled, generation });
  return <p data-testid="view">{view.kind === 'found' ? `found:${view.candidates[0]}` : view.kind}</p>;
}

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  cleanup();
  setVisibility('visible');
  vi.restoreAllMocks();
});

describe('useFundingLocator', () => {
  it('a hidden tab spends no RPC; it searches once the tab comes back', async () => {
    const c = chain();
    setVisibility('hidden');
    render(<Probe rpc={fakeLocatorRpc(c)} />);
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    expect(c.calls).toEqual([]);
    expect(screen.getByTestId('view').textContent).toBe('searching');

    await act(async () => setVisibility('visible'));
    expect(await screen.findByText(`found:${HASH}`)).toBeTruthy();
  });

  it('re-renders with the same inputs do not search again; a new generation does', async () => {
    const c = chain();
    const rpc = fakeLocatorRpc(c);
    const { rerender } = render(<Probe rpc={rpc} />);
    await screen.findByText(`found:${HASH}`);
    const first = c.calls.length;
    rerender(<Probe rpc={rpc} />);
    rerender(<Probe rpc={rpc} />);
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    expect(c.calls.length).toBe(first);
    rerender(<Probe rpc={rpc} generation={1} />);
    await screen.findByText(`found:${HASH}`);
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    expect(c.calls.length).toBe(first * 2);
  });

  it('disabled (a reference is already known): idle, no RPC at all', async () => {
    const c = chain();
    render(<Probe rpc={fakeLocatorRpc(c)} enabled={false} />);
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    expect(screen.getByTestId('view').textContent).toBe('idle');
    expect(c.calls).toEqual([]);
  });

  it('unmounting mid-search (navigation) never writes state afterwards', async () => {
    const c = chain();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { unmount } = render(<Probe rpc={fakeLocatorRpc(c)} />);
    unmount();
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    expect(errors).not.toHaveBeenCalled();
  });
});
