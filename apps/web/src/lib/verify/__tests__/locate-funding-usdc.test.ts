import { describe, expect, it } from 'vitest';
import { isFundingCandidate, locateFundingTransaction } from '../locate-funding';
import type { FundingShape } from '../locate-funding';
import { buildLocatorChain, fakeLocatorRpc } from './fake-locator';

/**
 * USDC funding shapes for the chain locator. SYNTHETIC transactions shaped like
 * the observed mainnet ones: `intents.near` signs `execute_intents` to itself
 * (e.g. tx GSruMXYuTGfPpLnZFWxegGEhSifg6fVqsTVZoC4bPqfM, block 224773278) with
 * NEP-413 signed payloads whose `message` is a JSON string of intents.
 */
const USDC = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const CONTRACT = 'taply-pay.kendinecrypto.near';
const ROUTER = 'intents.near';
const ID = 'a'.repeat(64);
const HASH = '9x5BWFTV7ZcFDXxHyLsdNFHD5KQdXLfwQdgs6GPdShfJ';
const routerShape: FundingShape = { kind: 'router', tokenContract: USDC, router: ROUTER };
const tokenShape: FundingShape = { kind: 'token', tokenContract: USDC };
const b64 = (v: unknown) => btoa(JSON.stringify(v));
const msg = (id = ID) => JSON.stringify({ id, expectedTermsHash: 'b'.repeat(64), action: 'pay_instant' });

function executeIntents(withdraw: Record<string, unknown>, extraIntents: unknown[] = []) {
  const message = JSON.stringify({ deadline: '2026-11-16T06:00:00.000Z', signer_id: 'solver-or-user', intents: [...extraIntents, { intent: 'ft_withdraw', token: USDC, receiver_id: CONTRACT, amount: '1000000', msg: msg(), ...withdraw }] });
  const args = { signed: [{ standard: 'nep413', payload: { message, nonce: 'AAAA', recipient: ROUTER }, public_key: 'ed25519:x', signature: 'ed25519:y' }] };
  return { FunctionCall: { method_name: 'execute_intents', args: b64(args), gas: 300_000_000_000_000, deposit: '0' } };
}
const routerTx = (action: unknown, over: Record<string, unknown> = {}) => ({ hash: HASH, signer_id: ROUTER, receiver_id: ROUTER, actions: [action], ...over });

describe('router (NEAR Intents) funding candidates', () => {
  const expected = { payer: ROUTER, contractId: CONTRACT, requestId: ID, funding: routerShape };
  it('matches an intents.near execute_intents whose ft_withdraw of USDC to the contract names this request', () => {
    expect(isFundingCandidate(routerTx(executeIntents({})), expected)).toBe(true);
    // Also inside a batch with other intents.
    expect(isFundingCandidate(routerTx(executeIntents({}, [{ intent: 'transfer', receiver_id: 'x', tokens: {} }])), expected)).toBe(true);
  });
  it.each([
    ['another token', { token: 'usdt.tether-token.near' }],
    ['another receiver', { receiver_id: 'attacker.near' }],
    ['another request id', { msg: msg('c'.repeat(64)) }],
    ['no msg (plain ft_transfer)', { msg: undefined }],
    ['malformed msg', { msg: '{not json' + ID }],
  ])('rejects %s', (_label, change) => {
    expect(isFundingCandidate(routerTx(executeIntents(change)), expected)).toBe(false);
  });
  it('rejects a transaction not signed by, or not sent to, the router; or another method', () => {
    expect(isFundingCandidate(routerTx(executeIntents({}), { signer_id: 'mallory.near' }), expected)).toBe(false);
    expect(isFundingCandidate(routerTx(executeIntents({}), { receiver_id: CONTRACT }), expected)).toBe(false);
    expect(isFundingCandidate(routerTx(executeIntents({})), { ...expected, payer: 'mallory.near' })).toBe(false);
    const other = { FunctionCall: { method_name: 'add_public_key', args: (executeIntents({}).FunctionCall.args), gas: 1, deposit: '0' } };
    expect(isFundingCandidate(routerTx(other), expected)).toBe(false);
  });
});

describe('direct USDC (ft_transfer_call) funding candidates', () => {
  const payer = 'alice.near';
  const expected = { payer, contractId: CONTRACT, requestId: ID, funding: tokenShape };
  const call = (args: Record<string, unknown>) => ({ FunctionCall: { method_name: 'ft_transfer_call', args: b64({ receiver_id: CONTRACT, amount: '1000000', msg: msg(), ...args }), gas: 1, deposit: '1' } });
  it('matches the payer’s ft_transfer_call on USDC to the contract for this request', () => {
    expect(isFundingCandidate({ hash: HASH, signer_id: payer, receiver_id: USDC, actions: [call({})] }, expected)).toBe(true);
  });
  it('rejects another receiver, another id, another token contract or signer', () => {
    expect(isFundingCandidate({ hash: HASH, signer_id: payer, receiver_id: USDC, actions: [call({ receiver_id: 'x.near' })] }, expected)).toBe(false);
    expect(isFundingCandidate({ hash: HASH, signer_id: payer, receiver_id: USDC, actions: [call({ msg: msg('d'.repeat(64)) })] }, expected)).toBe(false);
    expect(isFundingCandidate({ hash: HASH, signer_id: payer, receiver_id: 'fake-usdc.near', actions: [call({})] }, expected)).toBe(false);
    expect(isFundingCandidate({ hash: HASH, signer_id: 'bob.near', receiver_id: USDC, actions: [call({})] }, expected)).toBe(false);
  });
});

describe('locating a router delivery on a synthetic chain', () => {
  const fundedAtNs = '1763280000000000000';
  const request = { status: 'FINAL_PAID' as const, payerAccountId: ROUTER, fundedAtNs, latestOperation: { nonce: '1' } as never, terms: { id: ID } };
  it('finds the execute_intents transaction several blocks before the ft_on_transfer block', async () => {
    const chain = buildLocatorChain({ fundedAtNs, fundingHeight: 1000 });
    chain.txs.set(994, [routerTx(executeIntents({}))]);
    const r = await locateFundingTransaction({ rpc: fakeLocatorRpc(chain), contractId: CONTRACT, request, funding: routerShape, maxCalls: 160 });
    expect(r).toMatchObject({ kind: 'found', candidates: [HASH], blockHeight: 994 });
  });
  it('the native search shape does not see it (no false Verified path from a wrong shape)', async () => {
    const chain = buildLocatorChain({ fundedAtNs, fundingHeight: 1000 });
    chain.txs.set(999, [routerTx(executeIntents({}))]);
    const r = await locateFundingTransaction({ rpc: fakeLocatorRpc(chain), contractId: CONTRACT, request });
    expect(r.kind).toBe('not_found');
  });
});
