import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { fixtureRequests } from '../fixtures';
const api = vi.hoisted(() => ({ locate: vi.fn(), verify: vi.fn() }));
vi.mock('@taply/near-client', async original => ({ ...await original<Record<string, unknown>>(), verifyMainnetSettlement: api.verify }));
vi.mock('@/lib/verify/locate-funding', () => ({ locateAcrossProviders: api.locate }));
vi.mock('@/lib/verify/rpc', () => ({ createFetchLocatorRpc: () => ({}) }));
vi.mock('../config', () => ({ MAINNET_CONFIG: { ok: true, fixtures: false, profile: { network: 'near-mainnet', rpcUrl: 'https://rpc.mainnet.fastnear.com', rpcProviderId: 'test', contract: { accountId: 'devkendinecrypto.near', expectedCodeHash: '1'.repeat(32) } } } }));
const { useVerifiedMainnetReceipt } = await import('../use-verified-receipt');
const base = fixtureRequests(Date.now()).find(e => e.scenario.name === 'usdc-recorded')!.request;
const request = { ...base, terms: { ...base.terms, assetId: 'near:native' as const, amountBaseUnits: '100000000000000000000000' } };
const hash = '1'.repeat(32);
const proof = { kind: 'VERIFIED_SETTLEMENT', status: 'PAID', network: 'near-mainnet', beneficiary: request.recipientAccountId, amountBaseUnits: request.terms.amountBaseUnits, assetId: request.terms.assetId, transferReceiptId: '2'.repeat(32) };
afterEach(() => { cleanup(); sessionStorage.clear(); vi.clearAllMocks(); });
const found = () => api.locate.mockResolvedValue({ kind: 'found', candidates: [hash] });
it('a located transaction is only a candidate: it must pass the independent payout verifier', async () => {
  found(); api.verify.mockResolvedValue({ kind: 'NOT_VERIFIED', reason: 'UNRESOLVED' });
  const { result } = renderHook(() => useVerifiedMainnetReceipt(request));
  await waitFor(() => expect(result.current?.kind).toBe('unavailable'));
  expect(api.verify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'instant' }), { id: request.terms.id, funding: { transactionHash: hash, signerAccountId: request.payerAccountId }, operations: [{ transactionHash: hash, signerAccountId: request.payerAccountId }] });
});
it('a matching independently proven payout can become Verified Paid', async () => {
  found(); api.verify.mockResolvedValue(proof);
  const { result } = renderHook(() => useVerifiedMainnetReceipt(request));
  await waitFor(() => expect(result.current?.kind).toBe('verified'));
});
it('saved public references avoid scanning but never skip receipt verification', async () => {
  sessionStorage.setItem(`taply.mainnet.receipt:instant:${request.terms.id}`, `${hash} ${request.payerAccountId}`);
  api.verify.mockResolvedValue(proof); const { result } = renderHook(() => useVerifiedMainnetReceipt(request));
  await waitFor(() => expect(result.current?.kind).toBe('verified'));
  expect(api.locate).not.toHaveBeenCalled(); expect(api.verify).toHaveBeenCalledTimes(1);
});
it('a proof for a different beneficiary is not applied to this receipt', async () => {
  found(); api.verify.mockResolvedValue({ ...proof, beneficiary: 'other.near' });
  const { result } = renderHook(() => useVerifiedMainnetReceipt(request));
  await waitFor(() => expect(result.current?.kind).toBe('unavailable'));
});
it('in-flight, retry-history and USDC receipts cannot become verified from a first-attempt native search', () => {
  for (const r of [base, { ...request, status: 'PAYOUT_IN_FLIGHT' as const }, { ...request, latestOperation: { ...request.latestOperation!, nonce: '2' } }]) {
    const view = renderHook(() => useVerifiedMainnetReceipt(r)); expect(view.result.current).toBeNull(); view.unmount();
  }
  expect(api.locate).not.toHaveBeenCalled(); expect(api.verify).not.toHaveBeenCalled();
});
it('a late verification result never follows navigation to a different request', async () => {
  let finish: (v: unknown) => void = () => {}; found(); api.verify.mockImplementationOnce(() => new Promise(r => { finish = r; }));
  const view = renderHook(({ r }) => useVerifiedMainnetReceipt(r), { initialProps: { r: request } });
  await waitFor(() => expect(api.verify).toHaveBeenCalled());
  api.verify.mockResolvedValue({ kind: 'NOT_VERIFIED' }); view.rerender({ r: { ...request, terms: { ...request.terms, id: 'b'.repeat(64) } } });
  await act(async () => { finish(proof); }); await waitFor(() => expect(view.result.current?.kind).toBe('unavailable'));
});
