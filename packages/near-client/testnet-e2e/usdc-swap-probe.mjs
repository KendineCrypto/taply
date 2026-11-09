// Real Testnet probe on a disposable account: NEAR -> test USDC -> NEAR through Ref (pool 1103).
import { actions } from 'near-api-js';
import { assertTestnet, loadAccount, view, viewAccount, finalTx, failureOf, TGAS, NEAR } from './lib.mjs';

const REF = 'ref-finance-101.testnet', WRAP = 'wrap.testnet', USDC = 'usdc.itachicara.testnet', POOL = 1103;
const id = process.argv[2];
await assertTestnet();
const acct = loadAccount(id);
const send = async (receiverId, list) => {
  const sent = await acct.signAndSendTransaction({ receiverId, waitUntil: 'EXECUTED_OPTIMISTIC', throwOnFailure: false, actions: list });
  const hash = sent.transaction_outcome?.id ?? sent.transaction?.hash;
  const out = await finalTx(hash, id);
  return { hash, failure: failureOf(out), out };
};
const fc = (m, a, dep = 0n, gas = 100n * TGAS) => actions.functionCall(m, a, gas, dep);
const bal = async () => BigInt((await viewAccount(id)).amount);
const usdcBal = async () => BigInt(await view(USDC, 'ft_balance_of', { account_id: id }));

// 1) NEAR -> USDC in ONE transaction to wrap.testnet: register, wrap 2 NEAR, swap via Ref.
const pool = await view(REF, 'get_pool', { pool_id: POOL });
console.log('pool', JSON.stringify(pool).slice(0, 220));
const inW = 2n * NEAR;
const quoteUsdc = await view(REF, 'get_return', { pool_id: POOL, token_in: WRAP, amount_in: inW.toString(), token_out: USDC });
console.log('quote 2 NEAR ->', quoteUsdc, 'USDC base units');
const msgBuy = JSON.stringify({ force: 0, actions: [{ pool_id: POOL, token_in: WRAP, token_out: USDC, amount_in: inW.toString(), min_amount_out: (BigInt(quoteUsdc) * 99n / 100n).toString() }] });
let r = await send(WRAP, [fc('storage_deposit', { account_id: id, registration_only: true }, 12_500_000_000_000_000_000_000n, 10n * TGAS),
  fc('near_deposit', {}, inW, 10n * TGAS), fc('ft_transfer_call', { receiver_id: REF, amount: inW.toString(), msg: msgBuy }, 1n, 200n * TGAS)]);
console.log('buy', r.hash, r.failure ?? 'OK', 'usdc now', (await usdcBal()).toString());

// 2) USDC -> exactly-enough NEAR (exact-out via quote + slippage), auto-unwrap to native NEAR.
const want = NEAR / 2n; // 0.5 NEAR
const p = await view(REF, 'get_pool', { pool_id: POOL });
const iu = p.token_account_ids.indexOf(USDC), iw = 1 - iu;
const rin = BigInt(p.amounts[iu]), rout = BigInt(p.amounts[iw]), fee = BigInt(p.total_fee);
const need = (rin * want * 10000n) / ((rout - want) * (10000n - fee)) + 1n;
const amountIn = need * 101n / 100n;
const check = BigInt(await view(REF, 'get_return', { pool_id: POOL, token_in: USDC, amount_in: amountIn.toString(), token_out: WRAP }));
console.log('exact-out: need', need.toString(), 'send', amountIn.toString(), 'get_return', check.toString(), '>= want', check >= want);
const before = await bal();
const msgSell = JSON.stringify({ force: 0, actions: [{ pool_id: POOL, token_in: USDC, token_out: WRAP, amount_in: amountIn.toString(), min_amount_out: want.toString() }], skip_unwrap_near: false });
r = await send(USDC, [fc('ft_transfer_call', { receiver_id: REF, amount: amountIn.toString(), msg: msgSell }, 1n, 200n * TGAS)]);
const after = await bal();
const gasBurnt = [r.out.transaction_outcome, ...r.out.receipts_outcome].reduce((s, o) => s + BigInt(o.outcome.tokens_burnt), 0n);
console.log('sell', r.hash, r.failure ?? 'OK');
console.log('native NEAR delta', (after - before).toString(), 'wNEAR balance', await view(WRAP, 'ft_balance_of', { account_id: id }), 'usdc left', (await usdcBal()).toString());
console.log('logs', JSON.stringify(r.out.receipts_outcome.flatMap((x) => x.outcome.logs)).slice(0, 600));
