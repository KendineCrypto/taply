import { expect, it } from '../../../apps/web/node_modules/vitest/dist/index.js';
import { ContractRequestSchema } from '../../shared/dist/index.js';
import paid from '../../../apps/web/src/test/fixtures/sandbox/paid-restricted.json';
import { verifyInstantReceipt } from '../../../apps/web/src/lib/verify/instant-receipt';
import { createFetchVerifierRpc, VerifierRpcError } from '../../../apps/web/src/lib/verify/rpc';
import { buildPaidChain, txJson, receipts, outcomes, actionOf, encodeArgs } from '../../../apps/web/src/lib/verify/__tests__/fake-chain';

const request = ContractRequestSchema.parse(paid);
type Context = ReturnType<typeof buildPaidChain>;
type Json = Record<string, unknown>;
function transfer(ctx: Context) {
  return receipts(txJson(ctx.chain, ctx.input.fundingTransaction.hash))
    .find(r => r.predecessor_id === request.terms.contractId && (actionOf(r).actions as Json[]).some(a => 'Transfer' in a))!;
}
const attacks: [string, (ctx: Context) => void][] = [
  ['wrong payer', ctx => { Object.assign(ctx.input, { fundingTransaction: { ...ctx.input.fundingTransaction, signerAccountId: 'attacker.testnet' } }); }],
  ['wrong recipient', ctx => { transfer(ctx).receiver_id = 'attacker.testnet'; }],
  ['one yocto underpayment', ctx => { actionOf(transfer(ctx)).actions = [{ Transfer: { deposit: String(BigInt(request.terms.amountBaseUnits) - 1n) } }]; }],
  ['one yocto overpayment', ctx => { actionOf(transfer(ctx)).actions = [{ Transfer: { deposit: String(BigInt(request.terms.amountBaseUnits) + 1n) } }]; }],
  ['receipt replay against another request', ctx => { Object.assign(ctx.input, { requestId: 'f'.repeat(64) }); }],
  ['callback operation replay', ctx => {
    const tx = txJson(ctx.chain, ctx.input.fundingTransaction.hash);
    const callback = receipts(tx).find(r => (actionOf(r).actions as Json[]).some(a => (a.FunctionCall as Json)?.method_name === 'on_native_transfer_complete'))!;
    const call = (actionOf(callback).actions as Json[])[0]!.FunctionCall as Json;
    const args = JSON.parse(Buffer.from(call.args as string, 'base64').toString());
    call.args = encodeArgs({ ...args, operationNonce: '0' });
  }],
  ['missing transfer payload', ctx => {
    const tx = txJson(ctx.chain, ctx.input.fundingTransaction.hash), target = transfer(ctx);
    tx.receipts = receipts(tx).filter(r => r !== target);
  }],
  ['missing transfer outcome', ctx => {
    const tx = txJson(ctx.chain, ctx.input.fundingTransaction.hash), id = transfer(ctx).receipt_id;
    tx.receipts_outcome = outcomes(tx).filter(o => o.id !== id);
  }],
];
for (const [label, attack] of attacks) it(`independent verification refuses ${label} on each device`, async () => {
  // Separate synthetic transports/state on merchant and payer, no shared paid flag.
  for (let device = 0; device < 2; device++) {
    const ctx = buildPaidChain(request); attack(ctx);
    const result = await verifyInstantReceipt(ctx.input);
    expect(result.kind === 'verified').toBe(false);
    expect('receipt' in result).toBe(false);
  }
});
it('two independent reads still verify the intact receipt graph', async () => {
  const a = buildPaidChain(request), b = buildPaidChain(request);
  const results = await Promise.all([verifyInstantReceipt(a.input), verifyInstantReceipt(b.input)]);
  expect(results.every(r => r.kind === 'verified')).toBe(true);
  expect(a.chain.calls.length).toBeGreaterThan(0);
  expect(b.chain.calls.length).toBeGreaterThan(0);
});
it('explicit pruned history never becomes Verified Paid', async () => {
  const ctx = buildPaidChain(request);
  ctx.chain.failing.set('EXPERIMENTAL_tx_status', new VerifierRpcError('UNKNOWN_BLOCK'));
  expect(await verifyInstantReceipt(ctx.input)).toMatchObject({ reason: 'HISTORY_UNAVAILABLE' });
});
it('a stalled RPC is transient, not evidence of pruning or successful settlement', async () => {
  const ctx = buildPaidChain(request);
  Object.assign(ctx.input, { rpc: createFetchVerifierRpc({ rpcUrl: 'https://fixture.example', providerId: 'synthetic-timeout', timeoutMs: 10,
    fetcher: async () => new Promise<Response>(() => {}) }) });
  expect(await verifyInstantReceipt(ctx.input)).toMatchObject({ reason: 'RPC_UNAVAILABLE' });
});
it.each([408, 422])('documents unmodified web HTTP %s handoff: fails closed but loses classification', async status => {
  const ctx = buildPaidChain(request);
  Object.assign(ctx.input, { rpc: createFetchVerifierRpc({ rpcUrl: 'https://fixture.example', providerId: 'synthetic-http',
    fetcher: async (_url, init) => Response.json({ jsonrpc: '2.0', id: JSON.parse(String(init?.body)).id,
      error: { code: -32000, name: 'HANDLER_ERROR', cause: { name: status === 422 ? 'UNKNOWN_BLOCK' : 'TIMEOUT_ERROR' } } }, { status }) }) });
  expect(await verifyInstantReceipt(ctx.input)).toMatchObject({ reason: 'RPC_UNAVAILABLE' });
});
