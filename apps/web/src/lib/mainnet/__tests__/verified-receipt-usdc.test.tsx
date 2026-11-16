import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { fixtureRequests } from '../fixtures';
const api = vi.hoisted(() => ({ locate: vi.fn(), verify: vi.fn() }));
vi.mock('@taply/near-client', async original => ({ ...await original<Record<string, unknown>>(), verifyMainnetSettlement: api.verify }));
vi.mock('@/lib/verify/locate-funding', () => ({ locateAcrossProviders: api.locate }));
vi.mock('@/lib/verify/rpc', () => ({ createFetchLocatorRpc: () => ({}) }));
vi.mock('../config', () => ({ MAINNET_CONFIG: { ok: true, fixtures: false, profile: { network: 'near-mainnet', rpcUrl: 'https://rpc.mainnet.fastnear.com', rpcProviderId: 'test', contract: { accountId: 'devkendinecrypto.near', expectedCodeHash: '1'.repeat(32) } } } }));
// The USDC code pin is read at import; set it before loading the hook.
const PIN = 'DVJx7F3dHEHJYwpYPwXHu8K9Uo7h4kXFcALucY5oNX8q';
vi.stubEnv('NEXT_PUBLIC_TAPLY_MAINNET_USDC_CODE_HASH', PIN);
const { useVerifiedMainnetReceipt, MAINNET_ROUTER_ACCOUNT } = await import('../use-verified-receipt');

/** USDC receipts (router + direct). Mocked verifier/locator: proves wiring, not chain facts. */
const base = fixtureRequests(Date.now()).find(e => e.scenario.name === 'usdc-recorded')!.request;
const routed = { ...base, status: 'FINAL_PAID' as const, payerAccountId: MAINNET_ROUTER_ACCOUNT, latestOperation: { ...base.latestOperation!, status: 'SUCCEEDED' as const, nonce: '1' } };
const direct = { ...routed, payerAccountId: 'alice.near' };
const hint = '4'.repeat(43);
const proofFor = (r: typeof routed, router: boolean) => ({ kind: 'VERIFIED_SETTLEMENT', status: 'PAID', routerDelivery: router, beneficiary: r.recipientAccountId, amountBaseUnits: r.terms.amountBaseUnits, assetId: r.terms.assetId, transferReceiptId: '2'.repeat(32) });
afterEach(() => { cleanup(); sessionStorage.clear(); vi.clearAllMocks(); });

it('a router delivery verifies from the public 1Click hint hash, signed by intents.near, with the USDC pin', async () => {
  api.verify.mockResolvedValue(proofFor(routed, true));
  const { result } = renderHook(() => useVerifiedMainnetReceipt(routed, [hint]));
  await waitFor(() => expect(result.current?.kind).toBe('verified'));
  expect(api.verify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'instant' }), expect.objectContaining({ funding: { transactionHash: hint, signerAccountId: 'intents.near' }, usdcCodeHash: PIN }));
  expect(api.locate).not.toHaveBeenCalled();
});

it('without a hint (requester phone, no quote record) the chain search uses the router shape', async () => {
  api.locate.mockResolvedValue({ kind: 'found', candidates: ['5'.repeat(43)] });
  api.verify.mockResolvedValue(proofFor(routed, true));
  const { result } = renderHook(() => useVerifiedMainnetReceipt(routed));
  await waitFor(() => expect(result.current?.kind).toBe('verified'));
  expect(api.locate).toHaveBeenCalledWith(expect.objectContaining({ funding: { kind: 'router', tokenContract: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', router: 'intents.near' } }), expect.anything());
});

it('a proof that disagrees on the delivery kind, amount or beneficiary is never applied', async () => {
  for (const bad of [proofFor(routed, false), { ...proofFor(routed, true), amountBaseUnits: '1' }, { ...proofFor(routed, true), beneficiary: 'x.near' }]) {
    api.verify.mockResolvedValue(bad); api.locate.mockResolvedValue({ kind: 'not_found' });
    const view = renderHook(() => useVerifiedMainnetReceipt(routed, [hint]));
    await waitFor(() => expect(view.result.current?.kind).toBe('unavailable'));
    view.unmount();
  }
});

it('hint hashes are ignored for a direct wallet payment; it searches the token shape', async () => {
  api.locate.mockResolvedValue({ kind: 'not_found' });
  const { result } = renderHook(() => useVerifiedMainnetReceipt(direct, [hint]));
  await waitFor(() => expect(result.current?.kind).toBe('unavailable'));
  expect(api.verify).not.toHaveBeenCalled();
  expect(api.locate).toHaveBeenCalledWith(expect.objectContaining({ funding: { kind: 'token', tokenContract: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1' } }), expect.anything());
});

it('an open or in-flight request never starts verification', () => {
  for (const r of [{ ...routed, status: 'OPEN' as const }, { ...routed, status: 'PAYOUT_IN_FLIGHT' as const }]) {
    const view = renderHook(() => useVerifiedMainnetReceipt(r, [hint])); expect(view.result.current).toBeNull(); view.unmount();
  }
  expect(api.verify).not.toHaveBeenCalled();
});
