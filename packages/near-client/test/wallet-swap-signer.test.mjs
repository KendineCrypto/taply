import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signerFixture } from './wallet-signer-fixture.mjs';
import { checkedSwapTransaction } from '../dist/wallet-backend.js';
import { prepareBuyToken, prepareSellTokenForNear, prepareTokenRegistration, quoteExactNearForToken, quoteTokenForExactNear, TESTNET_USDC_ROUTE } from '../dist/ref-swap.js';

const NEAR = 10n ** 24n;
const snap = (payer, over = {}) => ({ route: TESTNET_USDC_ROUTE, blockHash: '1'.repeat(32), blockHeight: '1',
  tokenReserve: '57744697537784089814302612588', nearReserve: '27390188960113886565427550613', feeBps: 30,
  payer: { accountId: payer, tokenBalance: '3000000000000000000000000', tokenRegistered: true, wrappedNearRegistered: false, ...over },
  tokenStorageMinYocto: '1250000000000000000000', wrappedNearStorageMinYocto: '1250000000000000000000' });
const asWallet = (tx) => ({ receiverId: tx.receiverId, actions: tx.actions });

test('swap shapes built by ref-swap.ts pass exactly; anything else is CALL_NOT_ALLOWED', () => {
  const me = 'payer.testnet', s = snap(me);
  const sell = asWallet(prepareSellTokenForNear(s, quoteTokenForExactNear(s, (NEAR / 2n).toString())));
  const buy = asWallet(prepareBuyToken(s, quoteExactNearForToken(s, NEAR.toString())));
  const reg = asWallet(prepareTokenRegistration(snap(me, { tokenRegistered: false })));
  for (const ok of [sell, buy, reg]) assert.deepEqual(checkedSwapTransaction(ok, me), JSON.parse(JSON.stringify(ok)));
  const mutate = (tx, f) => { const c = structuredClone(tx); f(c); return c; };
  const msgOf = (tx, i = 0) => JSON.parse(tx.actions[i].args.msg);
  const withMsg = (tx, i, f) => mutate(tx, (c) => { const m = JSON.parse(c.actions[i].args.msg); f(m); c.actions[i].args.msg = JSON.stringify(m); });
  for (const bad of [
    mutate(sell, (c) => { c.receiverId = 'evil-token.testnet'; }),
    mutate(sell, (c) => { c.actions[0].args.receiver_id = 'attacker.testnet'; }),
    mutate(sell, (c) => { c.actions[0].depositYocto = '2'; }),
    mutate(sell, (c) => { c.actions[0].gas = '400000000000000'; }),
    mutate(sell, (c) => { c.actions[0].args.memo = 'x'; }),
    withMsg(sell, 0, (m) => { m.actions[0].pool_id = 54; }),
    withMsg(sell, 0, (m) => { m.actions[0].amount_in = '1'; }),
    withMsg(sell, 0, (m) => { m.skip_unwrap_near = true; }),
    withMsg(sell, 0, (m) => { m.actions.push({ ...m.actions[0] }); }),
    mutate(reg, (c) => { c.actions[0].args.account_id = 'someone-else.testnet'; }),
    mutate(reg, (c) => { c.actions[0].depositYocto = (NEAR).toString(); }),
    mutate(buy, (c) => { c.actions[1].depositYocto = '7'; }),
    mutate(buy, (c) => { c.actions.push({ methodName: 'ft_transfer', args: { receiver_id: 'x.testnet', amount: '1' }, gas: '1', depositYocto: '1' }); }),
    mutate(buy, (c) => { c.receiverId = 'usdc.itachicara.testnet'; }),
    withMsg(buy, 2, (m) => { m.actions[0].token_out = 'evil-token.testnet'; }),
  ]) assert.throws(() => checkedSwapTransaction(bad, me), { code: 'CALL_NOT_ALLOWED' });
  assert.throws(() => checkedSwapTransaction(reg, 'someone-else.testnet'), { code: 'CALL_NOT_ALLOWED' }, 'registration for another account');
  assert.throws(() => checkedSwapTransaction(buy, 'someone-else.testnet'), { code: 'CALL_NOT_ALLOWED' }, 'wNEAR registration for another account');
  assert.equal(msgOf(sell).skip_unwrap_near, false);
});

test('reviewed backend signs a multi-action swap once, journals it and reconciles every action at FINAL', async () => {
  const f = await signerFixture();
  const me = f.identity.accountId;
  const buy = asWallet(prepareBuyToken(snap(me), quoteExactNearForToken(snap(me), (NEAR / 10n).toString())));
  const review = await f.backend.prepareSwapTransaction(buy);
  assert.equal(review.kind, 'token_swap'); assert.equal(review.receiverId, 'wrap.testnet');
  assert.equal(review.methodName, 'storage_deposit+near_deposit+ft_transfer_call');
  assert.equal(BigInt(review.depositYocto), NEAR / 10n + 1250000000000000000000n + 1n);
  assert.deepEqual(JSON.parse(review.actionsJson).map((a) => a.methodName), ['storage_deposit', 'near_deposit', 'ft_transfer_call']);
  const result = await f.backend.submit(review.id, async (seen) => { assert.equal(seen, review); return true; });
  assert.equal(result.kind, 'final'); assert.equal(result.outcome, 'SUCCEEDED');
  assert.equal(f.state.sends, 1); assert.equal(f.state.tx.transaction.actions.length, 3);
  assert.equal(f.journal.read().phase, 'FINAL_SUCCEEDED');
  f.vault.lock();
});

test('swap: decline and a forged RPC action never settle; contract gate applies', async () => {
  const f = await signerFixture();
  const me = f.identity.accountId;
  const sell = asWallet(prepareSellTokenForNear(snap(me), quoteTokenForExactNear(snap(me), (NEAR / 10n).toString())));
  const declined = await f.backend.prepareSwapTransaction(sell);
  await assert.rejects(f.backend.submit(declined.id, async () => false), { code: 'REVIEW_REJECTED' });
  assert.equal(f.state.sends, 0);
  f.state.enabled = false;
  const off = await f.backend.prepareSwapTransaction(sell);
  await assert.rejects(f.backend.submit(off.id, async () => true), { code: 'SIGNING_DISABLED' });
  f.state.enabled = true;
  const g = await signerFixture(); g.state.forgeAction = true;
  const buy = asWallet(prepareBuyToken(snap(g.identity.accountId), quoteExactNearForToken(snap(g.identity.accountId), (NEAR / 10n).toString())));
  const forged = await g.backend.prepareSwapTransaction(buy);
  const out = await g.backend.submit(forged.id, async () => true);
  assert.equal(out.kind, 'unknown'); assert.equal(g.journal.read().phase.startsWith('FINAL'), false);
  f.vault.lock(); g.vault.lock();
});
