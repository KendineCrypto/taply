import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PaymentsProvider, usePayments } from '../context';
import { JOURNAL_STORAGE_KEY } from '../journal';
import { installChain, memoryStorage, readySetup } from '@/test/chain';

/** Phase 5C: cross-tab journal changes reach screens; aged checks refresh on resume. */

function Probe() {
  const { journalVersion, check } = usePayments();
  return (
    <p>
      <span data-testid="version">{journalVersion}</span>
      <span data-testid="check">{check.status}</span>
    </p>
  );
}

afterEach(cleanup);

const CHAIN_MS = 1_793_476_890_000;

describe('payments context', () => {
  it('another tab changing the journal makes screens re-read it', () => {
    render(
      <PaymentsProvider setup={{ status: 'not_configured' }} storage={memoryStorage()} journalLock={null}>
        <Probe />
      </PaymentsProvider>,
    );
    const version = () => Number(screen.getByTestId('version').textContent);
    const start = version();
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: JOURNAL_STORAGE_KEY }));
    });
    expect(version()).toBe(start + 1);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'something.else' }));
    });
    expect(version()).toBe(start + 1);
  });

  it('coming back to the tab re-verifies an aged contract check', async () => {
    const chain = installChain({ contractId: 'pay.testnet', blockTimestampNs: (BigInt(CHAIN_MS) * 1_000_000n).toString() });
    let now = CHAIN_MS;
    render(
      <PaymentsProvider setup={readySetup(chain, true)} storage={memoryStorage()} journalLock={null} now={() => now}>
        <Probe />
      </PaymentsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('check').textContent).toBe('verified'));
    const reads = () => chain.calls.filter((c) => c.methodName === 'get_config').length;
    const before = reads();
    const visible = () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    // Recent check: reused.
    act(visible);
    expect(reads()).toBe(before);
    // Ten minutes in the background, provider stuck on the old block: re-read, and it is stale now.
    now += 10 * 60_000;
    act(visible);
    await waitFor(() => expect(screen.getByTestId('check').textContent).toBe('stale_chain'));
    expect(reads()).toBeGreaterThan(before);
  });
});
