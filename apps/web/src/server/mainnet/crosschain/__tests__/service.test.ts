// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createCrosschainService, type RecordState, type Store } from '../service';
import { ASSETS, address, parseAmount, normalized, type Proof } from '@/lib/mainnet/crosschain/model';
import { createFixtureSigner, fixtureQuoteResponse } from '../../oneclick/fixture-client';
import { ONE_CLICK_MANAGER_PUB_KEY } from '../../oneclick/sdk';
const now = Date.UTC(2026, 10, 23, 12);
const secret = 'a'.repeat(64), deposit = '0x' + '2'.repeat(40);
const input = { from: 'base', to: 'near', amount: '1000000', recipient: 'alice.near', refundTo: '0x' + '1'.repeat(40), slippageBps: 50 } as const;
function harness() {
  const signer = createFixtureSigner(); const records = new Map<string, RecordState>();
  const store: Store = {
    get: async k => records.get(k) ?? null,
    reserve: async (k, r) => { if (records.has(k)) return false; records.set(k, r); return true; },
    finish: async (k, r) => { records.set(k, r); },
    archive: async (k, r) => { if (records.get(k) !== r) return false; records.delete(k); return true; },
  };
  const mutate = { value: (v: ReturnType<typeof fixtureQuoteResponse>) => v };
  let last: ReturnType<typeof signer.signResponse>;
  const quote = vi.fn(async (body: unknown) => {
    const sent = body as Record<string, unknown>;
    const response = fixtureQuoteResponse(sent, now);
    response.quote.amountIn = String(sent['amount']); response.quote.minAmountIn = String(sent['amount']);
    response.quote.amountOut = '990000'; response.quote.minAmountOut = '985050';
    response.quote.deadline = String(sent['deadline']);
    if (!sent['dry']) response.quote.depositAddress = deposit;
    last = signer.signResponse(mutate.value(response)); return last;
  });
  const status = vi.fn(async () => ({ status: 'SUCCESS', quoteResponse: { correlationId: last.correlationId, quote: { depositAddress: deposit } }, swapDetails: { destinationChainTxHashes: [{ hash: 'x'.repeat(44) }] } }));
  const verify = vi.fn(async (): Promise<Proof> => ({ state: 'pending', amount: null, chain: 'near', txs: [], trust: 'configured-rpc' }));
  const deps = { mode: 'funded' as const, client: { quote, status, tokens: async () => Object.values(ASSETS).map(a => ({ ...a, blockchain: a.chain, contractAddress: a.contract })) }, store, now: () => now, managerKey: signer.publicKey, verify, registered: async () => true };
  return { service: createCrosschainService(deps), deps, records, mutate, quote, status, verify };
}
describe('independent cross-chain sessions', () => {
  it('dry quote is signed/echo-bound, exact-input, and creates no deposit or ledger record', async () => {
    const h = harness(); const q = await h.service.quote(input, secret, false);
    expect(q).toMatchObject({ funded: false, deposit: null, amountIn: '1000000', minAmountOut: '985050' });
    expect(h.records.size).toBe(0);
    const sent = h.quote.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent['swapType']).toBe('EXACT_INPUT'); expect(sent['recipient']).toBe('alice.near'); expect(sent).not.toHaveProperty('customRecipientMsg');
  });
  it.each(['recipient','refundTo','amount','destinationAsset','originAsset','swapType','slippageTolerance','depositType','recipientType','refundType'])('rejects signed echo substitution: %s', async key => {
    const h = harness(); h.mutate.value = r => ({ ...r, quoteRequest: { ...r.quoteRequest, [key]: 'evil' } });
    await expect(h.service.quote(input, secret, false)).rejects.toThrow('QUOTE_INVALID');
  });
  it('rejects a fixture signed under a key other than the configured production manager', async () => {
    const h = harness(); const service = createCrosschainService({ ...h.deps, managerKey: ONE_CLICK_MANAGER_PUB_KEY });
    await expect(service.quote(input, secret, false)).rejects.toThrow('QUOTE_INVALID');
  });
  it.each(['amountIn','amountOut','minAmountOut'])('rejects amount violation: %s', async key => {
    const h = harness(); h.mutate.value = r => ({ ...r, quote: { ...r.quote, [key]: '0' } });
    await expect(h.service.quote(input, secret, false)).rejects.toThrow('QUOTE_INVALID');
  });
  it('accepts the provider integer slippage floor without floating point', async () => {
    const h = harness(); h.mutate.value = r => ({ ...r, quote: { ...r.quote, amountOut: '990001', minAmountOut: '985050' } });
    expect(await h.service.quote(input, secret, false)).toMatchObject({ minAmountOut: '985050' });
  });
  it('rejects a signed minimum below the reviewed slippage', async () => {
    const h = harness(); h.mutate.value = r => ({ ...r, quote: { ...r.quote, minAmountOut: '1' } });
    await expect(h.service.quote(input, secret, false)).rejects.toThrow('QUOTE_INVALID');
  });
  it('serializes simultaneous funded requests and survives a service restart', async () => {
    const h = harness(); const r = await Promise.allSettled([h.service.quote(input, secret, true, '985000'), h.service.quote(input, secret, true, '985000')]);
    expect(r.filter(x => x.status === 'fulfilled')).toHaveLength(1); expect(h.quote).toHaveBeenCalledTimes(1);
    expect(await createCrosschainService(h.deps).session(secret)).toMatchObject({ state: 'ready', upstream: 'SUCCESS', proof: { state: 'pending' } });
    await expect(h.service.quote(input, secret, true, '985000')).rejects.toThrow('ATTEMPT_EXISTS');
  });
  it('lost quote response remains uncertain and cannot issue a second address', async () => {
    const h = harness(); h.quote.mockRejectedValue(new Error('timeout'));
    await expect(h.service.quote(input, secret, true, '1')).rejects.toThrow('timeout');
    expect(await h.service.session(secret)).toMatchObject({ state: 'uncertain', quote: null });
    await expect(h.service.quote(input, secret, true, '1')).rejects.toThrow('ATTEMPT_EXISTS');
  });
  it('price change persists uncertainty without exposing a deposit', async () => {
    const h = harness(); await expect(h.service.quote(input, secret, true, '999999')).rejects.toThrow('PRICE_CHANGED');
    expect(await h.service.session(secret)).toMatchObject({ state: 'uncertain', quote: null });
  });
  it('another secret cannot read a session and upstream success alone cannot archive it', async () => {
    const h = harness(); await h.service.quote(input, secret, true, '985000');
    expect(await h.service.session('b'.repeat(64))).toBeNull();
    await expect(h.service.archive(secret)).rejects.toThrow('ATTEMPT_EXISTS');
  });
  it('only verified final destination delivery permits archiving', async () => {
    const h = harness(); await h.service.quote(input, secret, true, '985000');
    h.verify.mockResolvedValue({ state: 'verified', chain: 'near', amount: '990000', txs: ['x'.repeat(44)], trust: 'configured-rpc' });
    await h.service.archive(secret); expect(await h.service.session(secret)).toBeNull();
  });
  it('status for another correlation id is refused', async () => {
    const h = harness(); await h.service.quote(input, secret, true, '985000');
    h.status.mockResolvedValue({ status: 'SUCCESS', quoteResponse: { correlationId: 'other', quote: { depositAddress: deposit } }, swapDetails: { destinationChainTxHashes: [] } });
    await expect(h.service.session(secret)).rejects.toThrow('STATUS_MISMATCH'); expect(h.verify).not.toHaveBeenCalled();
  });
  it('unregistered NEAR USDC recipient blocks before requesting an address', async () => {
    const h = harness(); const service = createCrosschainService({ ...h.deps, registered: async () => false });
    await expect(service.quote(input, secret, true, '1')).rejects.toThrow('REGISTER_USDC'); expect(h.quote).not.toHaveBeenCalled();
  });
  it('token listing metadata mismatch blocks before signing', async () => {
    const h = harness(); const service = createCrosschainService({ ...h.deps, client: { ...h.deps.client, tokens: async () => [] } });
    await expect(service.quote(input, secret, true, '1')).rejects.toThrow('TOKEN_UNAVAILABLE');
  });
  it('funded mode requires a durable store and cannot be enabled by a dry request', async () => {
    const h = harness(); await expect(createCrosschainService({ ...h.deps, store: null }).quote(input, secret, true, '1')).rejects.toThrow('STORE_UNAVAILABLE');
    await expect(createCrosschainService({ ...h.deps, mode: 'dry' }).quote(input, secret, true, '1')).rejects.toThrow('FUNDING_DISABLED');
  });
});
describe('cross-chain input boundaries', () => {
  it.each(['0','-1','1.0000001','100.000001','1e2','1,2.3'])('rejects %s', value => expect(parseAmount(value)).toBeNull());
  it('supports a Turkish decimal without floating point', () => expect(parseAmount('0,123456')).toBe('123456'));
  it('rejects a token address or zero address as receiver', () => { expect(() => address('base', ASSETS.base.contract)).toThrow(); expect(() => address('base', '0x'+'0'.repeat(40))).toThrow(); });
  it('rejects wrong networks and same-chain input', () => { expect(() => address('near','alice.testnet')).toThrow(); expect(() => normalized({ ...input, from:'near' })).toThrow(); expect(() => address('sol', '0x'+'1'.repeat(40))).toThrow(); });
});
