// Real NEAR Testnet proof: the merchant asks for NEAR, the payer pays with test USDC.
// Uses the SAME near-client builders the web app uses (ref-swap.ts) and the
// frozen pilot contract's pay_instant_native. Disposable automation accounts only.
import { mkdirSync } from 'node:fs';
import { actions } from 'near-api-js';
import { assertTestnet, buildTerms, call, createFaucetAccount, finalBlock, finalTx, failureOf, loadAccount, TGAS, view, viewAccount, writeEvidence } from './lib.mjs';
import { createSwapReader, prepareBuyToken, prepareSellTokenForNear, prepareTokenRegistration, quoteExactNearForToken, quoteTokenForExactNear } from '../dist/ref-swap.js';

const CONTRACT = 'taply-pay-pilot-1.testnet';
const APPROVED_CODE_HASH = 'BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B';
const AMOUNT = 300_000_000_000_000_000_000_000n; // 0.3 test NEAR asked by the merchant

await assertTestnet();
if ((await viewAccount(CONTRACT)).code_hash !== APPROVED_CODE_HASH) throw new Error('pilot code hash changed');
const merchantId = await createFaucetAccount('taply-usdc-merchant');
const payerId = await createFaucetAccount('taply-usdc-payer');
const merchant = loadAccount(merchantId), payer = loadAccount(payerId);
const swap = createSwapReader({ network: 'near-testnet', rpcUrl: 'https://rpc.testnet.near.org', rpcProviderId: 'near-public-testnet', contract: null });
const sendTx = async (tx) => {
  const sent = await payer.signAndSendTransaction({ receiverId: tx.receiverId, waitUntil: 'EXECUTED_OPTIMISTIC', throwOnFailure: false,
    actions: tx.actions.map((a) => actions.functionCall(a.methodName, a.args, BigInt(a.gas), BigInt(a.depositYocto))) });
  const hash = sent.transaction_outcome?.id ?? sent.transaction?.hash;
  const out = await finalTx(hash, payerId);
  const failed = [out.transaction_outcome, ...out.receipts_outcome].some((o) => o.outcome.status.Failure);
  return { hash, failed, failure: failureOf(out), logs: out.receipts_outcome.flatMap((r) => r.outcome.logs) };
};

// Merchant: NEAR request.
const block = await finalBlock();
const { terms, termsHash } = buildTerms({ contractId: CONTRACT, creator: merchantId, amount: AMOUNT, nowNs: block.timestampNs, memo: 'Taply: pay a NEAR request with test USDC' });
const quote = await view(CONTRACT, 'quote_create_request', { terms });
const created = await call(merchant, CONTRACT, 'create_request', { terms, quoteVersion: quote.quoteVersion }, { deposit: BigInt(quote.depositYocto), gas: BigInt(quote.gas) });
if (created.failure) throw new Error(`create failed ${created.failure}`);

// Payer gets test USDC (register + buy), exactly like the app's "Get test USDC".
let s = await swap.read(payerId);
const register = await sendTx(prepareTokenRegistration(s));
s = await swap.read(payerId);
const buyNear = (AMOUNT * 105n) / 100n;
const buy = await sendTx(prepareBuyToken(s, quoteExactNearForToken(s, buyNear.toString())));
s = await swap.read(payerId);
const usdcHeld = s.payer.tokenBalance;

// Step 1: convert USDC -> at least AMOUNT native NEAR.
const sellQuote = quoteTokenForExactNear(s, AMOUNT.toString());
const nearBefore = BigInt((await viewAccount(payerId)).amount);
const sell = await sendTx(prepareSellTokenForNear(s, sellQuote));
const nearAfter = BigInt((await viewAccount(payerId)).amount);
if (sell.failed) throw new Error(`sell failed ${sell.failure}`);
const swappedLog = sell.logs.find((l) => l.startsWith('Swapped')) ?? null;
const withdrawLog = sell.logs.find((l) => l.startsWith('Withdraw')) ?? null;

// Step 2: the unchanged NEAR payment.
const merchantBefore = BigInt((await viewAccount(merchantId)).amount);
const paid = await call(payer, CONTRACT, 'pay_instant_native', { id: terms.id, expectedTermsHash: termsHash }, { deposit: AMOUNT, gas: 50n * TGAS });
if (paid.failure) throw new Error(`pay failed ${paid.failure}`);
const final = await view(CONTRACT, 'get_request', { id: terms.id });
const merchantAfter = BigInt((await viewAccount(merchantId)).amount);

const result = {
  kind: 'TAPLY_PAY_NEAR_REQUEST_WITH_TEST_USDC_TESTNET_PROOF', network: 'near-testnet',
  note: 'Disposable automation accounts. Test USDC (usdc.itachicara.testnet) has no real value. Ref pool 1103 on ref-finance-101.testnet.',
  contractId: CONTRACT, merchantAccountId: merchantId, payerAccountId: payerId, requestedYocto: AMOUNT, requestId: terms.id,
  createTransaction: created.hash,
  registerUsdc: { hash: register.hash, failed: register.failed },
  buyTestUsdc: { hash: buy.hash, failed: buy.failed, nearSpentYocto: buyNear, usdcHeld },
  convert: { hash: sell.hash, failed: sell.failed, usdcIn: sellQuote.tokenIn, minNearOut: sellQuote.minNearOut, expectedNearOut: sellQuote.expectedNearOut,
    swappedLog, withdrawLog, payerNativeDeltaYocto: nearAfter - nearBefore },
  payment: { hash: paid.hash, finalStatus: final.status, latestOperation: final.latestOperation, merchantDeltaYocto: merchantAfter - merchantBefore },
};
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync(new URL('../../../docs/evidence/testnet-e2e/', import.meta.url), { recursive: true });
const out = new URL(`../../../docs/evidence/testnet-e2e/${stamp}-usdc-pay.json`, import.meta.url);
writeEvidence(out, result);
console.log(JSON.stringify({ ...result, evidence: out.pathname }, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 1));
