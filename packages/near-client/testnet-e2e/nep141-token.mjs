// NEP-141 token payments on real NEAR Testnet with disposable automation accounts.
// Deploys Taply's TEST-ONLY token (no value) and the token-enabled payments
// candidate to their OWN fresh accounts, locks both (full-access keys deleted),
// then proves a token Instant payment, a refused duplicate and a Protected refund.
// Output: docs/evidence/testnet-e2e/<stamp>-nep141.json (public data only).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { baseEncode } from 'near-api-js';
import { assertTestnet, buildTerms, call, finalBlock, loadAccount, rpc, roleAccount, TGAS, view, viewAccount, writeEvidence } from './lib.mjs';

const ART = '../../../contracts/payments-protected/artifacts/';
const AMOUNT = 2_500_000n; // 2.5 tUSD-TEST (6 decimals)
const STORAGE = 12_500_000_000_000_000_000_000n; // 0.0125 NEAR, above the token's storage minimum
const codeHash = (bytes) => baseEncode(createHash('sha256').update(bytes).digest());
await assertTestnet();

async function deployLocked(role, file, initArgs) {
  const id = await roleAccount(role);
  const wasm = readFileSync(new URL(ART + file, import.meta.url));
  let acct = await viewAccount(id);
  const steps = {};
  if (acct.code_hash === '11111111111111111111111111111111') {
    const owner = loadAccount(id);
    const d = await owner.deployContract(new Uint8Array(wasm));
    steps.deploy = d.transaction_outcome?.id;
    const init = await call(owner, id, 'new', initArgs, { gas: 50n * TGAS });
    if (init.failure) throw new Error(`${role} init ${init.failure}`);
    steps.init = init.hash;
    for (const k of (await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: id })).keys) {
      steps.deleteKey = (await owner.deleteKey(k.public_key)).transaction_outcome?.id;
    }
    acct = await viewAccount(id);
  }
  if (acct.code_hash !== codeHash(wasm)) throw new Error(`${role} code hash mismatch`);
  const keys = (await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: id })).keys.length;
  return { accountId: id, codeHash: acct.code_hash, wasmSha256: createHash('sha256').update(wasm).digest('hex'), accessKeys: keys, steps };
}

const payerId = await roleAccount('nep141-payer');
const recipientId = await roleAccount('nep141-recipient');
const payer = loadAccount(payerId);
const recipient = loadAccount(recipientId);
const token = await deployLocked('nep141-token', 'taply_test_token.wasm', { owner_id: payerId, total_supply: '1000000000' });
const contract = await deployLocked('nep141-contract', 'payments-protected.wasm',
  { tokens: [{ accountId: token.accountId, decimals: 6, symbol: 'tUSD-TEST' }] });
const C = contract.accountId, T = token.accountId, ASSET = `nep141:${T}`;
const metadata = await view(T, 'ft_metadata');
const config = await view(C, 'get_config');

const registrations = {};
for (const who of [C, recipientId]) {
  if ((await view(T, 'storage_balance_of', { account_id: who })) === null) {
    const r = await call(payer, T, 'storage_deposit', { account_id: who, registration_only: true }, { deposit: STORAGE, gas: 10n * TGAS });
    if (r.failure) throw new Error(`storage_deposit ${r.failure}`);
    registrations[who] = r.hash;
  }
}
const bal = async (who) => BigInt(await view(T, 'ft_balance_of', { account_id: who }));

async function createRequest(mode, memo) {
  const { terms, termsHash } = buildTerms({ contractId: C, creator: recipientId, amount: AMOUNT, mode, assetId: ASSET, memo,
    cancelDurationNs: mode === 'protected' ? '60000000000' : null, nowNs: (await finalBlock()).timestampNs });
  const q = await view(C, 'quote_create_request', { terms });
  const r = await call(recipient, C, 'create_request', { terms, quoteVersion: q.quoteVersion }, { deposit: BigInt(q.depositYocto), gas: 30n * TGAS });
  if (r.failure) throw new Error(`create ${r.failure}`);
  return { terms, termsHash, create: r.hash };
}
const pay = (msg) => call(payer, T, 'ft_transfer_call', { receiver_id: C, amount: AMOUNT.toString(), memo: null, msg: JSON.stringify(msg) },
  { deposit: 1n, gas: 100n * TGAS });
/** Token movements in a FINAL outcome: ft_transfer receipts the contract sent to the token. */
const ftTransfers = (outcome) => outcome.receipts.filter((r) => r.receiver_id === T && r.predecessor_id === C)
  .flatMap((r) => (r.receipt.Action?.actions ?? []).filter((a) => a.FunctionCall?.method_name === 'ft_transfer')
    .map((a) => ({ receiptId: r.receipt_id, args: JSON.parse(Buffer.from(a.FunctionCall.args, 'base64').toString()) })));

// --- Instant token payment -------------------------------------------------------
const i = await createRequest('instant', 'Taply NEP-141 instant proof');
const before = { payer: await bal(payerId), recipient: await bal(recipientId), contract: await bal(C) };
const paid = await pay({ id: i.terms.id, expectedTermsHash: i.termsHash, action: 'pay_instant' });
if (paid.failure) throw new Error(`ft_transfer_call ${paid.failure}`);
const iFinal = await view(C, 'get_request', { id: i.terms.id });
const after = { payer: await bal(payerId), recipient: await bal(recipientId), contract: await bal(C) };
const dup = await pay({ id: i.terms.id, expectedTermsHash: i.termsHash, action: 'pay_instant' });
const afterDup = await bal(payerId);

// --- Protected token refund --------------------------------------------------------
const p = await createRequest('protected', 'Taply NEP-141 protected refund proof');
const pBefore = await bal(payerId);
const locked = await pay({ id: p.terms.id, expectedTermsHash: p.termsHash, action: 'fund_protected',
  acceptedCancelDurationNs: '60000000000', consentVersion: 'taply.protected-consent.v1' });
if (locked.failure) throw new Error(`fund_protected ${locked.failure}`);
const lockedView = await view(C, 'get_request', { id: p.terms.id });
const contractHeld = await bal(C);
const cancel = await call(payer, C, 'cancel_protected', { id: p.terms.id, expectedTermsHash: p.termsHash }, { deposit: 1n, gas: 50n * TGAS });
if (cancel.failure) throw new Error(`cancel ${cancel.failure}`);
const pFinal = await view(C, 'get_request', { id: p.terms.id });
const pAfter = await bal(payerId);
const accounting = await view(C, 'get_accounting');

const result = {
  instant: { status: iFinal.status, payerDelta: after.payer - before.payer, recipientDelta: after.recipient - before.recipient,
    contractDelta: after.contract - before.contract, duplicateRefunded: afterDup === after.payer },
  protectedRefund: { lockedStatus: lockedView.status, contractHeldWhileLocked: contractHeld, status: pFinal.status, payerNetDelta: pAfter - pBefore },
};
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync(new URL('../../../docs/evidence/testnet-e2e/', import.meta.url), { recursive: true });
const out = new URL(`../../../docs/evidence/testnet-e2e/${stamp}-nep141.json`, import.meta.url);
writeEvidence(out, {
  kind: 'TAPLY_NEP141_CANDIDATE_AUTOMATED_TESTNET_PROOF', network: 'near-testnet',
  note: 'TEST-ONLY token with no value; UNREVIEWED candidate contract; disposable automation accounts, not owner wallets.',
  token: { ...token, metadata }, contract: { ...contract, config }, payerAccountId: payerId, recipientAccountId: recipientId,
  storageRegistrations: registrations, amountBaseUnits: AMOUNT,
  instantFlow: { requestId: i.terms.id, create: i.create, ftTransferCall: paid.hash, ftTransferCallGasBurnt: paid.gasBurnt, final: iFinal,
    payoutFtTransfers: ftTransfers(paid.outcome), balancesBefore: before, balancesAfter: after,
    duplicate: { hash: dup.hash, payerBalanceAfter: afterDup } },
  protectedRefundFlow: { requestId: p.terms.id, create: p.create, ftTransferCall: locked.hash, lockedView, contractHeldWhileLocked: contractHeld,
    cancel: cancel.hash, refundFtTransfers: ftTransfers(cancel.outcome), final: pFinal, payerBalanceBefore: pBefore, payerBalanceAfter: pAfter },
  accounting, result,
});
console.log(JSON.stringify({ token: T, contract: C, keys: [token.accessKeys, contract.accessKeys], ...result, evidence: out.pathname },
  (_, v) => (typeof v === 'bigint' ? v.toString() : v), 1));
