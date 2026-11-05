import { describe, expect, it } from 'vitest';
import { FIXTURES } from '@/test/chain';
import type { ContractRequest } from '@/lib/protocol';
import { DEFAULT_MAX_LOCATOR_CALLS, isFundingCandidate, locateFundingTransaction } from '../locate-funding';
import { createFetchLocatorRpc, createFetchVerifierRpc, LOCATOR_METHODS, VERIFIER_METHODS, VerifierRpcError } from '../rpc';
import { buildLocatorChain, fakeLocatorRpc, payCall } from './fake-locator';

/**
 * Phase 7G funding locator. Synthetic chain only (fake-locator.ts); a real
 * read-only run against the Testnet pilot is documented in PHASE_7G_UX_REPORT.md.
 */

const paid = FIXTURES.paidRestricted;
const contractId = paid.terms.contractId;
const payer = paid.payerAccountId ?? '';
const HASH = '9x5BWFTV7ZcFDXxHyLsdNFHD5KQdXLfwQdgs6GPdShfJ';
const OTHER = 'Bm1VgjQLsDZ8Eib8aHnnakt9zq1Kq8j8MVsQWkH8nvQd';

function chainWithFunding(at: number, tx = { hash: HASH, signer_id: payer, receiver_id: contractId, actions: [payCall(paid.terms.id)] }) {
  const chain = buildLocatorChain({ fundedAtNs: paid.fundedAtNs ?? '0', fundingHeight: 10_000 });
  chain.txs.set(at, [tx]);
  return chain;
}

describe('locateFundingTransaction', () => {
  it('finds the payer’s pay_instant_native for this ID one block before the funding receipt', async () => {
    const chain = chainWithFunding(9_999);
    const result = await locateFundingTransaction({ rpc: fakeLocatorRpc(chain), contractId, request: paid });
    expect(result).toMatchObject({ kind: 'found', candidates: [HASH], blockHeight: 9_999 });
    if (result.kind !== 'found') throw new Error('found expected');
    expect(result.calls).toBeLessThanOrEqual(DEFAULT_MAX_LOCATOR_CALLS);
    // Only read methods were used.
    expect(new Set(chain.calls)).toEqual(new Set(['block', 'chunk']));
  });

  it('also finds a transaction included in the funding block itself or a few blocks earlier', async () => {
    for (const at of [10_000, 9_998, 9_997]) {
      const result = await locateFundingTransaction({ rpc: fakeLocatorRpc(chainWithFunding(at)), contractId, request: paid });
      expect(result).toMatchObject({ kind: 'found', candidates: [HASH], blockHeight: at });
    }
  });

  it('never returns a look-alike: other signer, other contract, other ID, other method or extra actions', async () => {
    const lookAlikes = [
      { hash: HASH, signer_id: 'mallory.testnet', receiver_id: contractId, actions: [payCall(paid.terms.id)] },
      { hash: HASH, signer_id: payer, receiver_id: 'other.testnet', actions: [payCall(paid.terms.id)] },
      { hash: HASH, signer_id: payer, receiver_id: contractId, actions: [payCall('e'.repeat(64))] },
      { hash: HASH, signer_id: payer, receiver_id: contractId, actions: [{ FunctionCall: { method_name: 'create_request', args: btoa(JSON.stringify({ id: paid.terms.id })) } }] },
      { hash: HASH, signer_id: payer, receiver_id: contractId, actions: [payCall(paid.terms.id), payCall(paid.terms.id)] },
      { hash: 'not-a-hash', signer_id: payer, receiver_id: contractId, actions: [payCall(paid.terms.id)] },
      { hash: HASH, signer_id: payer, receiver_id: contractId, actions: [{ FunctionCall: { method_name: 'pay_instant_native', args: '%%%' } }] },
      { hash: HASH, signer_id: payer, receiver_id: contractId, actions: [{ Transfer: { deposit: '1' } }] },
    ];
    for (const tx of lookAlikes) {
      const result = await locateFundingTransaction({ rpc: fakeLocatorRpc(chainWithFunding(9_999, tx)), contractId, request: paid });
      expect(result.kind).toBe('not_found');
    }
  });

  it('returns every matching transaction in that block as candidates, in chain order', async () => {
    const chain = chainWithFunding(9_999);
    chain.txs.set(9_999, [
      { hash: HASH, signer_id: payer, receiver_id: contractId, actions: [payCall(paid.terms.id)] },
      { hash: OTHER, signer_id: payer, receiver_id: contractId, actions: [payCall(paid.terms.id)] },
    ]);
    const result = await locateFundingTransaction({ rpc: fakeLocatorRpc(chain), contractId, request: paid });
    expect(result).toMatchObject({ kind: 'found', candidates: [HASH, OTHER] });
  });

  it('reports not_found (never a guess) when the window has no matching transaction', async () => {
    const chain = chainWithFunding(9_990); // outside the 4-block window
    expect((await locateFundingTransaction({ rpc: fakeLocatorRpc(chain), contractId, request: paid })).kind).toBe('not_found');
  });

  it('reports history_unavailable when the RPC pruned those blocks', async () => {
    const chain = chainWithFunding(9_999);
    chain.prunedBelow = 10_200;
    expect((await locateFundingTransaction({ rpc: fakeLocatorRpc(chain), contractId, request: paid })).kind).toBe('history_unavailable');
  });

  it('reports unavailable on RPC failure and stops at the call budget', async () => {
    const down = chainWithFunding(9_999);
    down.failWith = new VerifierRpcError('RPC_UNAVAILABLE');
    expect((await locateFundingTransaction({ rpc: fakeLocatorRpc(down), contractId, request: paid })).kind).toBe('unavailable');

    const chain = chainWithFunding(9_999);
    const result = await locateFundingTransaction({ rpc: fakeLocatorRpc(chain), contractId, request: paid, maxCalls: 3 });
    expect(result.kind).toBe('budget_exhausted');
    expect(chain.calls.length).toBe(3);
  });

  it('does not search for requests that are not FINAL_PAID or needed a payout retry', async () => {
    const chain = chainWithFunding(9_999);
    const rpc = fakeLocatorRpc(chain);
    expect(await locateFundingTransaction({ rpc, contractId, request: FIXTURES.open })).toEqual({ kind: 'not_applicable', reason: 'not_final_paid' });
    expect(await locateFundingTransaction({ rpc, contractId, request: FIXTURES.inFlight })).toEqual({ kind: 'not_applicable', reason: 'not_final_paid' });
    expect(await locateFundingTransaction({ rpc, contractId, request: FIXTURES.paidAfterRetry })).toEqual({
      kind: 'not_applicable',
      reason: 'needs_retry_references',
    });
    const noFacts = { ...paid, fundedAtNs: null } as unknown as ContractRequest;
    expect(await locateFundingTransaction({ rpc, contractId, request: noFacts })).toEqual({ kind: 'not_applicable', reason: 'missing_funding_facts' });
    expect(chain.calls).toEqual([]);
  });

  it('a funding time later than the final block is not found yet', async () => {
    const chain = buildLocatorChain({ fundedAtNs: paid.fundedAtNs ?? '0', fundingHeight: 10_000, finalHeight: 9_000 });
    expect((await locateFundingTransaction({ rpc: fakeLocatorRpc(chain), contractId, request: paid })).kind).toBe('not_found');
  });
});

describe('locator transport', () => {
  it('has its own read-only allowlist and leaves the verifier allowlist unchanged', async () => {
    expect([...LOCATOR_METHODS]).toEqual(['block', 'chunk']);
    expect([...VERIFIER_METHODS]).toEqual(['status', 'block', 'query', 'EXPERIMENTAL_tx_status']);
    let fetched = 0;
    const rpc = createFetchLocatorRpc({
      rpcUrl: 'https://rpc.example.test',
      providerId: 'x',
      fetcher: async () => {
        fetched += 1;
        return new Response('{}');
      },
    });
    for (const method of ['broadcast_tx_commit', 'send_tx', 'EXPERIMENTAL_tx_status', 'query']) {
      await expect(rpc.call(method as 'block', {})).rejects.toBeInstanceOf(VerifierRpcError);
    }
    expect(fetched).toBe(0);
  });

  it('isFundingCandidate needs the exact ID in the call arguments', () => {
    const tx = { hash: HASH, signer_id: payer, receiver_id: contractId, actions: [payCall(paid.terms.id)] };
    expect(isFundingCandidate(tx, { payer, contractId, requestId: paid.terms.id })).toBe(true);
    expect(isFundingCandidate(tx, { payer, contractId, requestId: paid.terms.id.replace(/.$/, '0') })).toBe(false);
  });
});

describe('locator transport: JSON-RPC errors sent with an HTTP error status', () => {
  const answer = (status: number, body: string): typeof fetch => async (_url, init) => {
    const id = (JSON.parse(String(init?.body)) as { id: string }).id;
    return new Response(body.replace('__ID__', id), { status, headers: { 'content-type': 'application/json' } });
  };
  const unknownBlock = '{"jsonrpc":"2.0","id":"__ID__","error":{"name":"HANDLER_ERROR","cause":{"name":"UNKNOWN_BLOCK","info":{}},"code":-32000,"message":"Server error"}}';
  const codeOf = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof VerifierRpcError ? e.code : 'other'));

  it('a 422 UNKNOWN_BLOCK (pruned history, e.g. FastNEAR) is UNKNOWN_BLOCK for the locator', async () => {
    const rpc = createFetchLocatorRpc({ rpcUrl: 'https://rpc.example.test', providerId: 'x', fetcher: answer(422, unknownBlock) });
    expect(await codeOf(rpc.call('block', { block_id: 1 }))).toBe('UNKNOWN_BLOCK');
  });

  it('other error bodies, non-JSON bodies and a result with an error status stay RPC_UNAVAILABLE', async () => {
    const other = '{"jsonrpc":"2.0","id":"__ID__","error":{"name":"HANDLER_ERROR","cause":{"name":"INTERNAL_ERROR"},"code":-32000}}';
    const result = '{"jsonrpc":"2.0","id":"__ID__","result":{"header":{}}}';
    for (const [status, body] of [[422, other], [500, '<html>'], [422, result], [503, unknownBlock]] as const) {
      const rpc = createFetchLocatorRpc({ rpcUrl: 'https://rpc.example.test', providerId: 'x', fetcher: answer(status, body) });
      expect(await codeOf(rpc.call('block', { block_id: 1 }))).toBe('RPC_UNAVAILABLE');
    }
  });

  it('the verifier transport is unchanged: any HTTP error status is RPC_UNAVAILABLE', async () => {
    const rpc = createFetchVerifierRpc({ rpcUrl: 'https://rpc.example.test', providerId: 'x', fetcher: answer(422, unknownBlock) });
    expect(await codeOf(rpc.call('block', { block_id: 1 }))).toBe('RPC_UNAVAILABLE');
  });
});
