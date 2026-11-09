// G2 merchant-bound sale on real NEAR Testnet (contracts/payments-merchant,
// UNREVIEWED candidate 0.5.0-merchant.1) with disposable automation accounts.
// Proves: a sale bound to ONE Handshake session (id, nonce, short expiry), the
// session commitment + 6-character comparison code both phones derive, payment
// to the bound merchant, and refusal to mint a second sale for the same session.
// The session SERVICE is not involved: the contract is the authority.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { baseEncode } from 'near-api-js';
import { calculateRequestId, calculateSessionCommitment, calculateTermsHash, comparisonCode } from '@taply/shared';
import { assertTestnet, call, finalBlock, loadAccount, rpc, roleAccount, TGAS, view, viewAccount, writeEvidence } from './lib.mjs';
import { loadIndependentVerifier, PROVIDERS } from '../scripts/reproduce-instant-proof.mjs';

const AMOUNT = 15_000_000_000_000_000_000_000n; // 0.015 test NEAR
await assertTestnet();
const wasm = readFileSync(new URL('../../../contracts/payments-merchant/artifacts/merchant-v1/payments.wasm', import.meta.url));
const expected = baseEncode(createHash('sha256').update(wasm).digest());
const C = await roleAccount('g2-contract');
const merchantId = await roleAccount('g2-merchant');
const customerId = await roleAccount('g2-customer');
const merchant = loadAccount(merchantId), customer = loadAccount(customerId);
const steps = {};
let acct = await viewAccount(C);
if (acct.code_hash === '11111111111111111111111111111111') {
  const owner = loadAccount(C);
  steps.deploy = (await owner.deployContract(new Uint8Array(wasm))).transaction_outcome?.id;
  const init = await call(owner, C, 'new', {}, { gas: 30n * TGAS });
  if (init.failure) throw new Error(`init ${init.failure}`);
  steps.init = init.hash;
  for (const k of (await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: C })).keys)
    steps.deleteKey = (await owner.deleteKey(k.public_key)).transaction_outcome?.id;
  acct = await viewAccount(C);
}
if (acct.code_hash !== expected) throw new Error('merchant candidate code hash mismatch');
const keysLeft = (await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: C })).keys.length;

function saleTerms(nowNs, session) {
  const creationNonce = randomBytes(32).toString('hex');
  const id = calculateRequestId({ contractId: C, creationNonce, creatorAccountId: merchantId, network: 'near-testnet' });
  const terms = { schemaVersion: 'taply.intent.v1', id, network: 'near-testnet', contractId: C, creationNonce, creatorAccountId: merchantId,
    assetId: 'near:native', amountBaseUnits: AMOUNT.toString(), mode: 'instant', cancelDurationNs: null,
    fundingExpiresAtNs: (nowNs + 900_000_000_000n).toString(), permittedPayerAccountId: null, merchantAccountId: merchantId,
    memo: 'Taply G2 POS sale proof', sessionBinding: session };
  return { terms, termsHash: calculateTermsHash(terms) };
}
const now = (await finalBlock()).timestampNs;
const session = { id: randomUUID(), nonce: randomBytes(32).toString('hex'), expiresAtNs: (now + 100_000_000_000n).toString() };
const sale = saleTerms(now, session);
const commitment = calculateSessionCommitment(sale.terms);
const code = comparisonCode(commitment);
const q = await view(C, 'quote_create_request', { terms: sale.terms });
const created = await call(merchant, C, 'create_request', { terms: sale.terms, quoteVersion: q.quoteVersion }, { deposit: BigInt(q.depositYocto), gas: 30n * TGAS });
if (created.failure) throw new Error(`create ${created.failure}`);
const open = await view(C, 'get_request', { id: sale.terms.id });
// Replay: a second sale for the SAME session (new creation nonce) must be refused.
const replay = saleTerms((await finalBlock()).timestampNs, session);
const rq = await view(C, 'quote_create_request', { terms: replay.terms }).catch((e) => ({ error: e.message.slice(0, 200) }));
const replayCreate = rq.error ? { failure: rq.error } : await call(merchant, C, 'create_request', { terms: replay.terms, quoteVersion: rq.quoteVersion },
  { deposit: BigInt(rq.depositYocto), gas: 30n * TGAS });
const before = BigInt((await viewAccount(merchantId)).amount);
const paid = await call(customer, C, 'pay_instant_native', { id: sale.terms.id, expectedTermsHash: sale.termsHash }, { deposit: AMOUNT, gas: 50n * TGAS });
if (paid.failure) throw new Error(`pay ${paid.failure}`);
const final = await view(C, 'get_request', { id: sale.terms.id });
const after = BigInt((await viewAccount(merchantId)).amount);
const { createFetchVerifierRpc, verifyInstantReceipt } = await loadIndependentVerifier();
const verification = [];
for (const provider of PROVIDERS) {
  const result = await verifyInstantReceipt({ rpc: createFetchVerifierRpc(provider), contractId: C, approvedCodeHash: acct.code_hash,
    requestId: sale.terms.id, fundingTransaction: { hash: paid.hash, signerAccountId: customerId }, retryTransactions: [] });
  verification.push({ providerId: provider.providerId, kind: result.kind, reason: result.reason ?? null });
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync(new URL('../../../docs/evidence/testnet-e2e/', import.meta.url), { recursive: true });
const out = new URL(`../../../docs/evidence/testnet-e2e/${stamp}-g2-merchant.json`, import.meta.url);
writeEvidence(out, { kind: 'TAPLY_G2_MERCHANT_BOUND_SALE_AUTOMATED_TESTNET_PROOF', network: 'near-testnet',
  note: 'UNREVIEWED merchant candidate on its own disposable account; automation accounts; no session service involved.',
  contractId: C, codeHash: acct.code_hash, accessKeys: keysLeft, deploySteps: steps, merchantAccountId: merchantId, customerAccountId: customerId,
  requestId: sale.terms.id, termsHash: sale.termsHash, sessionBinding: session, sessionCommitment: commitment, comparisonCode: code,
  contractSessionCommitment: open.sessionCommitment, create: created.hash, openStatus: open.status,
  replaySameSession: { failure: replayCreate.failure ?? null, hash: replayCreate.hash ?? null },
  funding: paid.hash, final, merchantBalanceDelta: after - before, verification });
console.log(JSON.stringify({ contract: C, keysLeft, requestId: sale.terms.id, comparisonCode: code,
  commitmentMatches: open.sessionCommitment === commitment, create: created.hash, fund: paid.hash, final: final.status,
  merchantDelta: (after - before).toString(), replayRefused: String(replayCreate.failure ?? '').slice(0, 140), verification }, null, 1));
