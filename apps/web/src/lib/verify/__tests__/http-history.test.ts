import { describe, expect, it } from 'vitest';
import { FIXTURES } from '@/test/chain';
import { createFetchLocatorRpc, createFetchVerifierRpc } from '../rpc';
import type { VerifierMethod } from '../rpc';
import { verifyInstantReceipt } from '../instant-receipt';
import { actionOf, buildPaidChain, hashOf, receipts, txJson } from './fake-chain';

type Json = Record<string, unknown>;
const errorEnvelope = (id: string, name: string): Json => ({ jsonrpc: '2.0', id,
  error: { code: -32000, name: 'HANDLER_ERROR', cause: { name }, message: 'private upstream prose' } });

for (const [label, factory] of [['verifier', createFetchVerifierRpc], ['locator', createFetchLocatorRpc]] as const) {
  describe(`${label} bounded HTTP history classification`, () => {
    for (const status of [400, 404, 408, 422, 500]) {
      it.each(['UNKNOWN_BLOCK', 'GARBAGE_COLLECTED_BLOCK', 'UNKNOWN_CHUNK'])(`HTTP ${status}: explicit %s`, async name => {
        const rpc = factory({ rpcUrl: 'https://fixture.example', providerId: 'synthetic', fetcher: async (_url, init) =>
          Response.json(errorEnvelope(JSON.parse(String(init?.body)).id as string, name), { status }) });
        await expect(rpc.call('block', { block_id: 1 })).rejects.toMatchObject({ code: 'UNKNOWN_BLOCK' });
      });
    }
    it.each([408, 422])('HTTP %s timeout stays uncertain and does not leak upstream prose', async status => {
      const rpc = factory({ rpcUrl: 'https://fixture.example', providerId: 'synthetic', fetcher: async (_url, init) =>
        Response.json(errorEnvelope(JSON.parse(String(init?.body)).id as string, 'TIMEOUT_ERROR'), { status }) });
      await expect(rpc.call('block', {})).rejects.toMatchObject({ code: 'RPC_UNAVAILABLE', message: 'verifier-rpc:RPC_UNAVAILABLE' });
    });
    const mutations: [string, (body: Json) => unknown][] = [
      ['wrong id', e => ({ ...e, id: 'replayed-response' })],
      ['wrong version', e => ({ ...e, jsonrpc: '1.0' })],
      ['result plus error', e => ({ ...e, result: { verified: true } })],
      ['result only', e => ({ jsonrpc: '2.0', id: e['id'], result: { verified: true } })],
      ['missing numeric code', e => ({ ...e, error: { cause: { name: 'UNKNOWN_BLOCK' } } })],
      ['string code', e => ({ ...e, error: { ...(e['error'] as Json), code: '-32000' } })],
      ['fractional code', e => ({ ...e, error: { ...(e['error'] as Json), code: -0.5 } })],
      ['malformed cause', e => ({ ...e, error: { code: -32000, name: 'UNKNOWN_BLOCK', cause: null } })],
      ['array envelope', e => [e]],
    ];
    it.each(mutations)('refuses %s before inferring missing history', async (_label, mutate) => {
      const rpc = factory({ rpcUrl: 'https://fixture.example', providerId: 'synthetic', fetcher: async (_url, init) =>
        Response.json(mutate(errorEnvelope(JSON.parse(String(init?.body)).id as string, 'UNKNOWN_BLOCK')), { status: 422 }) });
      await expect(rpc.call('block', {})).rejects.toMatchObject({ code: 'RPC_UNAVAILABLE' });
    });
    it.each([
      [408, 'RPC_UNAVAILABLE'],
      [422, 'RPC_UNAVAILABLE'],
      // Monday sprint: a 429 is its own transient code (with a cool-down), still never pruning.
      [429, 'RATE_LIMITED'],
      [503, 'RPC_UNAVAILABLE'],
    ])('plain HTTP %s text cannot prove history absence', async (status, code) => {
      const rpc = factory({ rpcUrl: 'https://fixture.example', providerId: 'synthetic', fetcher: async () =>
        new Response('UNKNOWN_BLOCK', { status }) });
      await expect(rpc.call('block', {})).rejects.toMatchObject({ code });
    });
    it('rejects oversized HTTP error bodies', async () => {
      const rpc = factory({ rpcUrl: 'https://fixture.example', providerId: 'synthetic', maxResponseBytes: 64,
        fetcher: async () => new Response(' '.repeat(65), { status: 422 }) });
      await expect(rpc.call('block', {})).rejects.toMatchObject({ code: 'MALFORMED' });
    });
    it('cancels a stalled HTTP error body without inferring pruning', async () => {
      let cancelled = false;
      const rpc = factory({ rpcUrl: 'https://fixture.example', providerId: 'synthetic', timeoutMs: 10,
        fetcher: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 422 }) });
      await expect(rpc.call('block', {})).rejects.toMatchObject({ code: 'RPC_UNAVAILABLE' });
      expect(cancelled).toBe(true);
    });
  });
}

describe('independent receipt proof through HTTP failures and recovery', () => {
  function setup() {
    const ctx = buildPaidChain(FIXTURES.paidRestricted);
    let failure: number | null = 422;
    const rpc = createFetchVerifierRpc({ rpcUrl: 'https://fixture.example', providerId: 'synthetic-recovery',
      fetcher: async (_url, init) => {
        const req = JSON.parse(String(init?.body)) as { id: string; method: VerifierMethod; params: unknown };
        if (failure !== null && req.method === 'EXPERIMENTAL_tx_status') {
          return Response.json(errorEnvelope(req.id, failure === 422 ? 'UNKNOWN_BLOCK' : 'TIMEOUT_ERROR'), { status: failure });
        }
        return Response.json({ jsonrpc: '2.0', id: req.id, result: await ctx.input.rpc.call(req.method, req.params) });
      } });
    return { ctx, input: { ...ctx.input, rpc }, recover: () => { failure = null; }, timeout: () => { failure = 408; } };
  }
  it('pruned history and timeout never verify; recovery rereads the complete independent proof', async () => {
    const f = setup();
    expect(await verifyInstantReceipt(f.input)).toMatchObject({ kind: 'not_verified', reason: 'HISTORY_UNAVAILABLE' });
    f.timeout();
    expect(await verifyInstantReceipt(f.input)).toMatchObject({ kind: 'not_verified', reason: 'RPC_UNAVAILABLE' });
    f.recover();
    expect(await verifyInstantReceipt(f.input)).toMatchObject({ kind: 'verified' });
    expect(f.ctx.chain.calls.filter(c => c.method === 'status')).toHaveLength(3);
  });
  it.each(['malformed hash', 'foreign hash'])('a malicious candidate (%s) cannot reuse a valid payment proof after recovery', async kind => {
    const f = setup(); f.recover();
    const input = { ...f.input, fundingTransaction: { ...f.input.fundingTransaction,
      hash: kind === 'malformed hash' ? '<script>paid</script>' : hashOf('attacker-payment') } };
    const result = await verifyInstantReceipt(input);
    expect(result.kind).toBe('not_verified');
    expect(result).not.toHaveProperty('receipt');
  });
  it('recovery with a wrong transfer recipient still refuses Verified Paid', async () => {
    const f = setup();
    expect(await verifyInstantReceipt(f.input)).toMatchObject({ reason: 'HISTORY_UNAVAILABLE' });
    const tx = txJson(f.ctx.chain, f.input.fundingTransaction.hash);
    const transfer = receipts(tx).find(r => r['predecessor_id'] === f.input.contractId
      && (actionOf(r)['actions'] as Json[]).some(a => 'Transfer' in a));
    if (!transfer) throw Error('fixture transfer missing');
    transfer['receiver_id'] = 'attacker.testnet';
    f.recover();
    expect(await verifyInstantReceipt(f.input)).toMatchObject({ kind: 'not_verified', reason: 'TRANSFER_MISMATCH' });
  });
});
