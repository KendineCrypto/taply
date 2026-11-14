import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MainnetWalletProvider, useMainnetWallet } from '../wallet';
const state = vi.hoisted(() => ({ account: 'alice.near', sign: vi.fn(), accept: vi.fn() }));
const KEY = 'ed25519:' + '1'.repeat(32);
vi.mock('@taply/near-client', async original => ({ ...await original<Record<string, unknown>>(), createMainnetWalletKeyProof: () => ({ params: { message: 'connection proof only' }, accept: state.accept }) }));
vi.mock('../config', () => ({ MAINNET_CONFIG: { ok: true, rpcUrl: 'https://rpc.mainnet.fastnear.com' } }));
vi.mock('@hot-labs/near-connect', () => {
  const wallet = { manifest: { name: 'Keyless fixture' }, getAccounts: async () => [{ accountId: state.account }], signMessage: state.sign, signAndSendTransaction: () => { throw Error('NO_TRANSACTIONS_IN_TEST'); } };
  return { NearConnector: class { async getConnectedWallet() { return { wallet, accounts: await wallet.getAccounts() }; } async disconnect() {} } };
});
function Probe() {
  const w = useMainnetWallet(); const [accounts, setAccounts] = useState('');
  return <><p data-testid="key">{w.publicKey ?? 'none'}</p><p>{w.accountId}</p><button onClick={() => void w.verifyKey().catch(() => {})}>verify</button><button onClick={() => void w.disconnect()}>disconnect</button><button onClick={async () => { const a = await w.signerWallet()?.getAccounts(); setAccounts(JSON.stringify(a)); }}>accounts</button><p id="result" data-testid="accounts">{accounts}</p></>;
}
afterEach(() => { cleanup(); state.account = 'alice.near'; vi.clearAllMocks(); });
const mount = async () => { state.accept.mockResolvedValue(KEY); state.sign.mockResolvedValue({}); render(<MainnetWalletProvider><Probe /></MainnetWalletProvider>); await screen.findByText('alice.near'); };
it('restoring a wallet never requests a signature; an explicit proof supplies its omitted key', async () => {
  await mount(); expect(state.sign).not.toHaveBeenCalled(); expect(screen.getByTestId('key').textContent).toBe('none');
  fireEvent.click(screen.getByText('verify')); await waitFor(() => expect(screen.getByTestId('key').textContent).toBe(KEY));
  fireEvent.click(screen.getByText('accounts')); await waitFor(() => expect(screen.getByTestId('accounts').textContent).toContain(KEY));
});
it('a proof is never attached to a different account returned by the wallet', async () => {
  await mount(); fireEvent.click(screen.getByText('verify')); await waitFor(() => expect(screen.getByTestId('key').textContent).toBe(KEY));
  state.account = 'bob.near'; fireEvent.click(screen.getByText('accounts')); await waitFor(() => expect(screen.getByTestId('accounts').textContent).toContain('bob.near'));
  expect(screen.getByTestId('accounts').textContent).not.toContain(KEY);
});
it('disconnecting while a signature is pending prevents its late response from restoring a key', async () => {
  await mount(); let finish: (v: unknown) => void = () => {}; state.sign.mockImplementationOnce(() => new Promise(r => { finish = r; }));
  fireEvent.click(screen.getByText('verify')); fireEvent.click(screen.getByText('disconnect'));
  await waitFor(() => expect(screen.queryByText('alice.near')).toBeNull()); finish({});
  await waitFor(() => expect(state.accept).toHaveBeenCalled()); expect(screen.getByTestId('key').textContent).toBe('none');
});
