import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { calculateMainnetTermsHash, type MainnetIntentTerms } from '@taply/shared';
import { MainnetLocaleProvider } from '@/lib/mainnet/copy';
import { mainnetEn } from '@/lib/i18n/dictionaries/mainnet-en';
const mock = vi.hoisted(() => ({ quoteCreateRequest: vi.fn(), readUsdcStorageBounds: vi.fn() }));
vi.mock('@/lib/mainnet/config', () => ({ MAINNET_CONFIG: {
  ok: true, fixtures: false, signingEnabled: false, contract: { status: 'configured', accountId: 'devkendinecrypto.near' },
  profile: { network: 'near-mainnet', rpcUrl: 'https://rpc.mainnet.fastnear.com', rpcProviderId: 'fastnear-mainnet',
    contract: { accountId: 'devkendinecrypto.near', expectedCodeHash: 'AXaqzkMuA8fgX2ywEGUxr44ASnVe2otBiefutxVrJaE7' } },
} }));
vi.mock('@/lib/mainnet/hooks', () => ({ readerOrNull: () => mock, useUsdcRegistration: () => 'not_registered' }));
vi.mock('@/lib/mainnet/wallet', () => ({ useMainnetWallet: () => ({ status: 'connected', accountId: 'alice.near', connect: async () => {}, disconnect: async () => {} }) }));
vi.mock('../WalletPanel', () => ({ WalletPanel: () => null }));
const { CreateRequest } = await import('../CreateRequest');
const calls = () => screen.queryAllByTestId('call-preview').map(e => JSON.parse(e.textContent ?? '{}'));
const createCall = () => calls().find(c => c.methodName === 'create_request');
const validQuote = (t: MainnetIntentTerms) => ({ requestId: t.id, termsHash: calculateMainnetTermsHash(t), quoteVersion: '1', depositYocto: '6000000000000000000000', gas: '30000000000000' });
beforeEach(() => {
  mock.readUsdcStorageBounds.mockResolvedValue({ data: { min: '2000000000000000000000', max: null } });
  mock.quoteCreateRequest.mockImplementation(async (t: MainnetIntentTerms) => ({ data: validQuote(t) }));
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function start() {
  render(<MainnetLocaleProvider locale="en"><CreateRequest /></MainnetLocaleProvider>);
  fireEvent.click(screen.getByLabelText('USDC')); // NEAR is the default asset
  fireEvent.change(screen.getByLabelText('Amount (USDC)'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: mainnetEn.create.review }));
}
it('uses the current token storage minimum, never the fixture registration amount', async () => {
  start();
  await waitFor(() => expect(calls().find(c => c.methodName === 'storage_deposit')?.depositYocto).toBe('2000000000000000000000'));
  expect(mock.readUsdcStorageBounds).toHaveBeenCalledTimes(1);
});
it('does not offer a registration transaction when current storage bounds fail', async () => {
  mock.readUsdcStorageBounds.mockRejectedValue(new Error('RPC outage'));
  start(); await waitFor(() => expect(createCall()).toBeDefined());
  expect(calls().find(c => c.methodName === 'storage_deposit')).toBeUndefined();
});
it('does not reuse a storage quote when memo changes with the same request ID', async () => {
  start(); await waitFor(() => expect(createCall()).toBeDefined());
  const original = createCall().args.terms;
  mock.quoteCreateRequest.mockRejectedValue(new Error('RPC outage'));
  fireEvent.click(screen.getByRole('button', { name: mainnetEn.create.back }));
  fireEvent.change(screen.getByLabelText(mainnetEn.create.memoLabel), { target: { value: 'new exact terms' } });
  fireEvent.click(screen.getByRole('button', { name: mainnetEn.create.review }));
  await waitFor(() => expect(mock.quoteCreateRequest).toHaveBeenCalledTimes(2));
  const next = mock.quoteCreateRequest.mock.calls[1]![0];
  expect(next.id).toBe(original.id); expect(calculateMainnetTermsHash(next)).not.toBe(calculateMainnetTermsHash(original));
  expect(createCall()).toBeUndefined();
});
it('rejects a quote response with the wrong hash instead of inventing the expected hash', async () => {
  mock.quoteCreateRequest.mockImplementation(async (t: MainnetIntentTerms) => ({ data: { ...validQuote(t), termsHash: 'e'.repeat(64) } }));
  start(); await waitFor(() => expect(mock.quoteCreateRequest).toHaveBeenCalledTimes(1));
  expect(createCall()).toBeUndefined();
});
