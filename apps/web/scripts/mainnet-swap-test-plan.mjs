// READ-ONLY funded-test planner for the Mainnet swap. Signs nothing, sends nothing.
// Usage (Node 24, from the repo root after `pnpm build`):
//   node apps/web/scripts/mainnet-swap-test-plan.mjs <accountId> [nearIn=0.03] [slippageBps=50]
// Reads ONE final block: pool 4512 (pins checked, quote cross-checked with get_return), the account's
// NEAR / wNEAR / USDC balances, its registrations (storage_balance_of) and the tokens' storage_balance_bounds,
// the gas price and the account's storage, then prints the exact steps and budget of:
//   leg 1: NEAR -> USDC (nearIn), leg 2: USDC -> NEAR (leg-1 minimum USDC, the amount the user certainly holds).
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const nc = await import(pathToFileURL(path.join(HERE, '../../../packages/near-client/dist/index.js')).href);
const shared = await import(pathToFileURL(path.join(HERE, '../../../packages/shared/dist/index.js')).href);
const [accountId, nearText = '0.03', slipText = '50'] = process.argv.slice(2);
if (!accountId) { console.error('usage: mainnet-swap-test-plan.mjs <accountId> [nearIn] [slippageBps]'); process.exit(2); }
const USDC = shared.MAINNET_USDC, WRAP = nc.MAINNET_WRAP;
const USDC_PIN = process.env.NEXT_PUBLIC_TAPLY_MAINNET_USDC_CODE_HASH ?? 'DVJx7F3dHEHJYwpYPwXHu8K9Uo7h4kXFcALucY5oNX8q';
const profile = { network: 'near-mainnet', rpcUrl: 'https://rpc.mainnet.fastnear.com', rpcProviderId: 'fastnear-mainnet' };
const toUnits = (t, d) => { const [w, f = ''] = t.replace(',', '.').split('.'); if (f.length > d) throw Error('precision'); return BigInt(w || '0') * 10n ** BigInt(d) + BigInt((f + '0'.repeat(d)).slice(0, d) || '0'); };
const fmt = (v, d, sym) => { const s = v.toString().padStart(d + 1, '0'); const fr = s.slice(-d).replace(/0+$/, ''); return `${s.slice(0, -d)}${fr ? '.' + fr : ''} ${sym}`; };
const slippage = Number.parseInt(slipText, 10);
const st = await nc.createMainnetSwapReader(profile, USDC_PIN).read(accountId);
const a = st.account;
const gasPrice = BigInt(a.gasPriceYocto);
const gas = { register: BigInt(nc.MAINNET_SWAP_GAS.register), wrap: BigInt(nc.MAINNET_SWAP_GAS.wrap), swap: BigInt(nc.MAINNET_SWAP_GAS.swap), unwrap: BigInt(nc.MAINNET_SWAP_GAS.unwrap) };
const reserve = BigInt(a.storageUsageBytes) * BigInt(a.storageByteCostYocto) + 300_000_000_000_000n * gasPrice * 2n;
const nearIn = toUnits(nearText, 24);
const q1 = await nc.quoteMainnetSwap(st.chain, st.pool, WRAP, USDC, nearIn.toString());
const min1 = nc.mainnetMinAmountOut(BigInt(q1.expectedOut), slippage);
const leg1 = [];
if (!a.registered[WRAP]) leg1.push(['register wNEAR (storage_deposit)', BigInt(a.storageMinYocto[WRAP]), gas.register]);
if (!a.registered[USDC]) leg1.push(['register USDC (storage_deposit)', BigInt(a.storageMinYocto[USDC]), gas.register]);
leg1.push(['wrap NEAR -> wNEAR (near_deposit)', nearIn, gas.wrap]);
leg1.push([`swap wNEAR -> USDC (ft_transfer_call, min_amount_out ${fmt(min1, 6, 'USDC')})`, 1n, gas.swap]);
const usdcIn = min1; // the USDC the account certainly holds after leg 1
const q2 = await nc.quoteMainnetSwap(st.chain, st.pool, USDC, WRAP, usdcIn.toString());
const min2 = nc.mainnetMinAmountOut(BigInt(q2.expectedOut), slippage);
const leg2 = [[`swap USDC -> wNEAR (ft_transfer_call, min_amount_out ${fmt(min2, 24, 'wNEAR')})`, 1n, gas.swap], ['unwrap exactly the verified swap output (near_withdraw)', 1n, gas.unwrap]];
const sum = (l, i) => l.reduce((s, x) => s + x[i], 0n);
const storage1 = leg1.filter(x => x[0].startsWith('register')).reduce((s, x) => s + x[1], 0n);
const prepaid1 = sum(leg1, 2) * gasPrice, prepaid2 = sum(leg2, 2) * gasPrice;
const need = nearIn + storage1 + prepaid1 + 2n; // must fit in spendable NEAR (balance - reserve)
const out = {
  readAt: new Date().toISOString(), finalBlock: { height: st.blockHeight, hash: st.blockHash }, accountId,
  balances: { NEAR: fmt(BigInt(a.nearYocto), 24, 'NEAR'), wNEAR: fmt(BigInt(a.balances[WRAP]), 24, 'wNEAR'), USDC: fmt(BigInt(a.balances[USDC]), 6, 'USDC') },
  registered: { wNEAR: a.registered[WRAP], USDC: a.registered[USDC] },
  storageBalanceBoundsMin: { wNEAR: fmt(BigInt(a.storageMinYocto[WRAP]), 24, 'NEAR'), USDC: fmt(BigInt(a.storageMinYocto[USDC]), 24, 'NEAR') },
  gasPrice: `${gasPrice} yocto/gas`,
  keptReserve: { total: fmt(reserve, 24, 'NEAR'), note: 'account storage + 2 x 300 Tgas at this gas price; never spent, only kept' },
  leg1: { pay: fmt(nearIn, 24, 'NEAR'), expected: fmt(BigInt(q1.expectedOut), 6, 'USDC'), minimum: fmt(min1, 6, 'USDC'), priceImpactBps: q1.priceImpactBps, poolFee: fmt(BigInt(q1.poolFeeIn), 24, 'NEAR'),
    steps: leg1.map(([s, d, g]) => `${s} | deposit ${d === 1n ? '1 yocto' : fmt(d, 24, 'NEAR')} | prepaid gas ${g / 10n ** 12n} Tgas`),
    refundableStorage: fmt(storage1, 24, 'NEAR'), prepaidGasUpperBound: fmt(prepaid1, 24, 'NEAR') },
  leg2: { pay: fmt(usdcIn, 6, 'USDC'), expected: fmt(BigInt(q2.expectedOut), 24, 'NEAR'), minimum: fmt(min2, 24, 'NEAR'), steps: leg2.map(([s, , g]) => `${s} | deposit 1 yocto | prepaid gas ${g / 10n ** 12n} Tgas`), prepaidGasUpperBound: fmt(prepaid2, 24, 'NEAR') },
  balanceCheck: { spendable: fmt(BigInt(a.nearYocto) > reserve ? BigInt(a.nearYocto) - reserve : 0n, 24, 'NEAR'), leg1Needs: fmt(need, 24, 'NEAR'),
    ok: BigInt(a.nearYocto) - reserve >= need, minimumBalanceForThisPlan: fmt(reserve + need, 24, 'NEAR') },
  note: 'Prepaid gas is an upper bound; NEAR refunds unused gas. Storage deposits are refundable (storage_unregister), not fees. Re-run right before signing: the app re-quotes and the policy refuses a stale minimum.',
};
console.log(JSON.stringify(out, null, 2));
