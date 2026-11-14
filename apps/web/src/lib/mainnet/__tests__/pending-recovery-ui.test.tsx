import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ pending: null as null | { state: string; transactionHash: string | null; operationHash: string }, final: false, reconcile: vi.fn() }));
const DEVICE = '11111111-1111-4111-8111-111111111111';
vi.mock('../copy', () => ({ useMainnetLocale: () => ({ locale: 'en' }) }));
vi.mock('../config', () => ({ MAINNET_CONFIG: { ok: true, signingEnabled: true } }));
vi.mock('../wallet', () => ({ useMainnetWallet: () => ({ accountId: null }) }));
vi.mock('@/components/mainnet/Wallet', () => ({ useMainnetVault: () => ({ identity: { accountId: 'alice.near' } }), vault: () => ({}) }));
vi.mock('@/components/mainnet/Settlement', () => ({ DirectTransferCheck: () => null }));
vi.mock('../wallet-ops', () => ({
  currentAuthority: () => ({ kind: 'device', store: {} }), deviceId: () => DEVICE, signingProfiles: () => ({}),
  prepareOperation: vi.fn(), authoritySignerFor: vi.fn(),
  walletBackend: () => ({ readAttempt: async () => ({ ownerDeviceId: DEVICE, pending: state.pending, completed: [] }), reconcile: state.reconcile }),
}));
const { LedgerPanel } = await import('@/components/mainnet/Operation');
afterEach(() => { cleanup(); vi.clearAllMocks(); state.pending = null; });
it('a matching FINAL result notifies the Gift form so its stale unknown warning can disappear', async () => {
  state.pending = { state: 'UNCERTAIN', transactionHash: '1'.repeat(32), operationHash: 'a'.repeat(64) };
  state.reconcile.mockImplementation(async () => { state.pending = null; return { kind: 'FINAL_EXECUTION', execution: 'SUCCESS' }; });
  const resolved = vi.fn(); render(<LedgerPanel onResolved={resolved} />);
  await waitFor(() => expect(resolved).toHaveBeenCalledTimes(1));
  expect(state.reconcile).toHaveBeenCalledWith();
});
it('an unresolved proof never clears the parent warning', async () => {
  state.pending = { state: 'UNCERTAIN', transactionHash: '1'.repeat(32), operationHash: 'a'.repeat(64) };
  state.reconcile.mockResolvedValue({ kind: 'OUTCOME_UNRESOLVED' }); const resolved = vi.fn(); render(<LedgerPanel onResolved={resolved} />);
  await screen.findByTestId('ledger-pending'); expect(resolved).not.toHaveBeenCalled(); expect(state.pending).not.toBeNull();
});
it('a missing hash is not guessed or silently reset', async () => {
  state.pending = { state: 'UNCERTAIN', transactionHash: null, operationHash: 'a'.repeat(64) };
  const resolved = vi.fn(); render(<LedgerPanel onResolved={resolved} />);
  await screen.findByTestId('ledger-pending'); expect(state.reconcile).not.toHaveBeenCalled(); expect(resolved).not.toHaveBeenCalled();
});
