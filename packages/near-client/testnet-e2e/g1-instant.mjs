// Fresh G1 Instant Pay proof on the FROZEN, DEPLOYED pilot contract, using two
// disposable automation accounts. The contract is only called, never changed.
// Output: docs/evidence/testnet-e2e/<stamp>-g1-instant.json (public data only).
import { mkdirSync } from 'node:fs';
import { assertTestnet, buildTerms, call, finalBlock, loadAccount, NEAR, roleAccount, TGAS, view, viewAccount, writeEvidence } from './lib.mjs';
import { loadIndependentVerifier, PROVIDERS } from '../scripts/reproduce-instant-proof.mjs';

const CONTRACT = 'taply-pay-pilot-1.testnet';
const APPROVED_CODE_HASH = 'BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B';
const AMOUNT = 10_000_000_000_000_000_000_000n; // 0.01 test NEAR

await assertTestnet();
const code = (await viewAccount(CONTRACT)).code_hash;
if (code !== APPROVED_CODE_HASH) throw new Error(`pilot code hash changed: ${code}`);
const recipientId = await roleAccount('g1-recipient');
const payerId = await roleAccount('g1-payer');
const recipient = loadAccount(recipientId);
const payer = loadAccount(payerId);
const block = await finalBlock();
const { terms, termsHash } = buildTerms({ contractId: CONTRACT, creator: recipientId, amount: AMOUNT, nowNs: block.timestampNs,
  memo: 'Taply automated Testnet proof' });
const quote = await view(CONTRACT, 'quote_create_request', { terms });
if (quote.requestId !== terms.id || quote.termsHash !== termsHash) throw new Error('quote does not bind these terms');
const created = await call(recipient, CONTRACT, 'create_request', { terms, quoteVersion: quote.quoteVersion },
  { deposit: BigInt(quote.depositYocto), gas: BigInt(quote.gas) });
if (created.failure) throw new Error(`create failed ${created.failure}`);
const open = await view(CONTRACT, 'get_request', { id: terms.id });
const recipientBefore = BigInt((await viewAccount(recipientId)).amount);
const paid = await call(payer, CONTRACT, 'pay_instant_native', { id: terms.id, expectedTermsHash: termsHash },
  { deposit: AMOUNT, gas: 50n * TGAS });
if (paid.failure) throw new Error(`pay failed ${paid.failure}`);
const final = await view(CONTRACT, 'get_request', { id: terms.id });
const recipientAfter = BigInt((await viewAccount(recipientId)).amount);
// Duplicate funding must be refused (the attached deposit returns to the payer).
const duplicate = await call(payer, CONTRACT, 'pay_instant_native', { id: terms.id, expectedTermsHash: termsHash },
  { deposit: AMOUNT, gas: 50n * TGAS });

const { createFetchVerifierRpc, verifyInstantReceipt, sourceSha256 } = await loadIndependentVerifier();
const verification = [];
for (const provider of PROVIDERS) {
  const result = await verifyInstantReceipt({ rpc: createFetchVerifierRpc(provider), contractId: CONTRACT, approvedCodeHash: APPROVED_CODE_HASH,
    requestId: terms.id, fundingTransaction: { hash: paid.hash, signerAccountId: payerId }, retryTransactions: [] });
  verification.push({ providerId: provider.providerId, result });
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync(new URL('../../../docs/evidence/testnet-e2e/', import.meta.url), { recursive: true });
const out = new URL(`../../../docs/evidence/testnet-e2e/${stamp}-g1-instant.json`, import.meta.url);
writeEvidence(out, {
  kind: 'TAPLY_G1_INSTANT_AUTOMATED_TESTNET_PROOF', network: 'near-testnet', note: 'Disposable automation accounts, not owner wallets; not a physical-wallet acceptance run.',
  contractId: CONTRACT, contractCodeHash: code, recipientAccountId: recipientId, payerAccountId: payerId,
  amountYocto: AMOUNT, requestId: terms.id, termsHash,
  createTransaction: { hash: created.hash, signerAccountId: recipientId, gasBurnt: created.gasBurnt, storageDepositYocto: quote.depositYocto },
  openStatus: open.status,
  fundingTransaction: { hash: paid.hash, signerAccountId: payerId, gasBurnt: paid.gasBurnt },
  finalStatus: final.status, latestOperation: final.latestOperation,
  recipientBalanceDeltaYocto: recipientAfter - recipientBefore,
  duplicateFunding: { hash: duplicate.hash, refused: duplicate.failure !== null, failure: duplicate.failure },
  verifierSourceSha256: sourceSha256, verification,
});
console.log(JSON.stringify({ requestId: terms.id, create: created.hash, fund: paid.hash, final: final.status,
  recipientDelta: (recipientAfter - recipientBefore).toString(), duplicateRefused: duplicate.failure !== null,
  verification: verification.map((v) => `${v.providerId}:${v.result.kind}${v.result.reason ? `(${v.result.reason})` : ''}`), evidence: out.pathname }, null, 1));
