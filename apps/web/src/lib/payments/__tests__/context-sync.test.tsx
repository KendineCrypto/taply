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

  it('a tab return right after a check resolves is not lost (no stale "checking" mirror)', async () => {
    // Regression for a CI-only timeout: the visibility handler read a ref that
    // was synced in a passive effect, one scheduler tick after the check
    // resolved. A tab return inside that tick saw "checking" and was dropped,
    // so an aged check was never refreshed. Here the read resolves with
    // microtasks only and the tab event fires before any macrotask runs.
    const chain = installChain({ contractId: 'pay.testnet', blockTimestampNs: (BigInt(CHAIN_MS) * 1_000_000n).toString() });
    let now = CHAIN_MS;
    const base = readySetup(chain, true);
    if (base.status !== 'ready') throw new Error('setup');
    const real = await base.reader.readContractConfig();
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    let reads = 0;
    // The client object is frozen, so copy it and replace the one read.
    const reader = {
      ...base.reader,
      readContractConfig: () => {
        reads += 1;
        return gate.then(() => real);
      },
    };
    render(
      <PaymentsProvider setup={{ ...base, reader }} storage={memoryStorage()} journalLock={null} now={() => now}>
        <Probe />
      </PaymentsProvider>,
    );
    expect(screen.getByTestId('check').textContent).toBe('checking');
    expect(reads).toBe(1);
    open();
    for (let i = 0; i < 20; i += 1) await Promise.resolve(); // microtasks only: no React effect tick yet
    now += 10 * 60_000;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(screen.getByTestId('check').textContent).toBe('stale_chain'), { timeout: 2_000 });
    expect(reads).toBe(2);
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
    // An async chain re-read: allow for a loaded CI/workspace run (default 1 s was flaky under `pnpm check`).
    await waitFor(() => expect(screen.getByTestId('check').textContent).toBe('stale_chain'), { timeout: 5_000 });
    expect(reads()).toBeGreaterThan(before);
  });
});
