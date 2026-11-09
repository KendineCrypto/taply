import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stringify } from 'lossless-json';
import { createSwapReader, prepareBuyToken, prepareSellTokenForNear, prepareTokenRegistration, quoteExactNearForToken,
  quoteTokenForExactNear, simplePoolOut, TESTNET_USDC_ROUTE } from '../dist/ref-swap.js';
import { config, status, block, HASH, HASH2 } from './helpers.mjs';

const NEAR = 10n ** 24n;
// Reserves of pool 1103 observed on Testnet before the probe swap (block 276950xxx).
const POOL = { pool_kind: 'SIMPLE_POOL', token_account_ids: ['usdc.itachicara.testnet', 'wrap.testnet'],
  amounts: ['57748901646608445708609799734', '27388188960113886565427550613'], total_fee: 30, shares_total_supply: '1', amp: 0 };
const bytes = (v) => [...new TextEncoder().encode(JSON.stringify(v))];

function reader(over = {}) {
  const calls = [];
  const fetcher = async (_url, init) => {
    const req = JSON.parse(init.body); calls.push(req);
    let result;
    if (req.method === 'status') result = over.status ?? status;
    else if (req.method === 'block') result = block;
    else {
      const { account_id: a, method_name: m } = req.params;
      const views = {
        'ref-finance-101.testnet:get_pool': over.pool ?? POOL,
        'usdc.itachicara.testnet:ft_metadata': over.meta ?? { spec: 'ft-1.0.0', name: 'USDC', symbol: 'USDC', decimals: 24 },
        'usdc.itachicara.testnet:ft_balance_of': over.balance ?? '3000000000000000000000000',
        'usdc.itachicara.testnet:storage_balance_of': over.tokenStorage === undefined ? { total: '1250000000000000000000', available: '0' } : over.tokenStorage,
        'wrap.testnet:storage_balance_of': over.wrapStorage ?? null,
        'usdc.itachicara.testnet:storage_balance_bounds': { min: '1250000000000000000000', max: null },
        'wrap.testnet:storage_balance_bounds': { min: '1250000000000000000000', max: '1250000000000000000000' },
      };
      result = { result: bytes(views[`${a}:${m}`]), logs: [], block_hash: over.blockHash ?? HASH, block_height: 123 };
    }
    return new Response(stringify({ jsonrpc: '2.0', id: req.id, result }));
  };
  return { api: createSwapReader(config, fetcher), calls };
}

test('reader: pool, metadata and payer balances at one final block; route is pinned', async () => {
  const { api, calls } = reader();
  const s = await api.read('payer.testnet');
  assert.equal(s.tokenReserve, POOL.amounts[0]); assert.equal(s.nearReserve, POOL.amounts[1]); assert.equal(s.feeBps, 30);
  assert.equal(s.payer.tokenRegistered, true); assert.equal(s.payer.wrappedNearRegistered, false);
  assert.deepEqual([...new Set(calls.filter(c => c.method === 'query').map(c => c.params.block_id))], [HASH]);
  assert.equal(calls.find(c => c.method === 'block').params.finality, 'final');
  assert.equal(calls.some(c => /send|broadcast/.test(c.method)), false);
});

test('reader fails closed on wrong chain, wrong pool tokens, wrong metadata and unanchored views', async () => {
  for (const [over, code] of [
    [{ status: { ...status, chain_id: 'mainnet' } }, 'NETWORK_MISMATCH'],
    [{ pool: { ...POOL, token_account_ids: ['evil.testnet', 'wrap.testnet'] } }, 'POOL_MISMATCH'],
    [{ meta: { symbol: 'USDC', decimals: 6 } }, 'POOL_MISMATCH'],
    [{ pool: { ...POOL, pool_kind: 'STABLE_SWAP' } }, 'POOL_MISMATCH'],
    [{ blockHash: HASH2 }, 'RPC_UNAVAILABLE'],
  ]) await assert.rejects(reader(over).api.read('payer.testnet'), { code }, JSON.stringify(over).slice(0, 60));
});

// Pool 1103 right after the probe bought 4.2041 USDC with 2 NEAR (fees stay in the pool).
const AFTER_BUY = { ...POOL, amounts: ['57744697537784089814302612588', '27390188960113886565427550613'] };

test('exact-NEAR quote matches the real Testnet swap: 0.5 NEAR needs 1.0573 USDC; Ref returned exactly the predicted NEAR', async () => {
  const s = await reader({ pool: AFTER_BUY }).api.read('payer.testnet');
  const q = quoteTokenForExactNear(s, (NEAR / 2n).toString(), 100);
  // Tx J8drH8hq... sent 1067876993978010690094845 and Ref logged
  // "Swapped ... for 504999907813723273484215 wrap.testnet".
  assert.equal(q.tokenInAtQuote, '1057303954433673950588956');
  assert.equal(q.tokenIn, '1067876993978010690094846');
  assert.equal(q.expectedNearOut, '504999907813723273484215');
  assert.equal(simplePoolOut(1067876993978010690094845n, BigInt(s.tokenReserve), BigInt(s.nearReserve), 30), 504999907813723273484215n);
  assert.ok(BigInt(q.expectedNearOut) >= NEAR / 2n);
  const exact = simplePoolOut(BigInt(q.tokenInAtQuote), BigInt(s.tokenReserve), BigInt(s.nearReserve), 30);
  assert.ok(exact >= NEAR / 2n, 'reserve math lands on or above the wanted amount');
  assert.ok(simplePoolOut(BigInt(q.tokenInAtQuote) - 10n ** 12n, BigInt(s.tokenReserve), BigInt(s.nearReserve), 30) < NEAR / 2n, 'and is tight');
  assert.throws(() => quoteTokenForExactNear(s, (2000n * NEAR).toString()), { code: 'PRICE_IMPACT_TOO_HIGH' });
  for (const bad of ['0', '-1', '1.5', 'abc']) assert.throws(() => quoteTokenForExactNear(s, bad), { code: 'INVALID_AMOUNT' });
  assert.throws(() => quoteTokenForExactNear(s, NEAR.toString(), 0), { code: 'INVALID_AMOUNT' });
  assert.throws(() => quoteTokenForExactNear(s, NEAR.toString(), 501), { code: 'INVALID_AMOUNT' });
});

test('sell builder: one ft_transfer_call on the token to Ref, 1 yocto, min_amount_out = wanted NEAR, native unwrap', async () => {
  const s = await reader().api.read('payer.testnet');
  const q = quoteTokenForExactNear(s, (NEAR / 2n).toString());
  const tx = prepareSellTokenForNear(s, q);
  assert.equal(tx.receiverId, TESTNET_USDC_ROUTE.token);
  assert.equal(tx.actions.length, 1);
  const [a] = tx.actions;
  assert.equal(a.methodName, 'ft_transfer_call'); assert.equal(a.depositYocto, '1');
  assert.equal(a.args.receiver_id, 'ref-finance-101.testnet'); assert.equal(a.args.amount, q.tokenIn);
  const msg = JSON.parse(a.args.msg);
  assert.deepEqual(msg, { force: 0, skip_unwrap_near: false, actions: [{ pool_id: 1103, token_in: 'usdc.itachicara.testnet',
    token_out: 'wrap.testnet', amount_in: q.tokenIn, min_amount_out: (NEAR / 2n).toString() }] });
  const poor = await reader({ balance: '1' }).api.read('payer.testnet');
  assert.throws(() => prepareSellTokenForNear(poor, q), { code: 'INSUFFICIENT_TOKEN' });
});

test('buy builder: registration first; then wrap + swap in one wrap.testnet transaction', async () => {
  const unregistered = await reader({ tokenStorage: null }).api.read('payer.testnet');
  const q = quoteExactNearForToken(unregistered, (2n * NEAR).toString());
  assert.equal(q.expectedTokenOut, '4204108824355894307187146'); // the real probe swap received exactly this
  assert.throws(() => prepareBuyToken(unregistered, q), { code: 'NOT_REGISTERED' });
  const reg = prepareTokenRegistration(unregistered);
  assert.equal(reg.receiverId, 'usdc.itachicara.testnet');
  assert.deepEqual(reg.actions[0].args, { account_id: 'payer.testnet', registration_only: true });
  assert.equal(reg.actions[0].depositYocto, '1250000000000000000000');
  const s = await reader().api.read('payer.testnet');
  const tx = prepareBuyToken(s, q);
  assert.equal(tx.receiverId, 'wrap.testnet');
  assert.deepEqual(tx.actions.map(a => a.methodName), ['storage_deposit', 'near_deposit', 'ft_transfer_call']);
  assert.equal(tx.actions[1].depositYocto, (2n * NEAR).toString());
  assert.deepEqual(JSON.parse(tx.actions[2].args.msg).actions[0].min_amount_out, q.minTokenOut);
  const registered = await reader({ wrapStorage: { total: '1', available: '0' } }).api.read('payer.testnet');
  assert.deepEqual(prepareBuyToken(registered, q).actions.map(a => a.methodName), ['near_deposit', 'ft_transfer_call']);
});
