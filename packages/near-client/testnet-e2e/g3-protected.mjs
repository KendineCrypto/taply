// Protected Pay (G3 CANDIDATE) on real NEAR Testnet with disposable automation
// accounts: deploy the candidate WASM to its OWN fresh account, initialise it,
// delete the account's full-access key (code can no longer change), then prove a
// real refund and a real release plus adversarial refusals.
// Never touches the G1 pilot. Output: docs/evidence/testnet-e2e/<stamp>-g3-protected.json
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { assertTestnet, buildTerms, call, finalBlock, loadAccount, rpc, roleAccount, sleep, TGAS, view, viewAccount, writeEvidence } from './lib.mjs';
import { baseEncode } from 'near-api-js';

const WASM_PATH = new URL('../../../contracts/payments-protected/artifacts/payments-protected.wasm', import.meta.url);
const PRINCIPAL = 20_000_000_000_000_000_000_000n; // 0.02 test NEAR
const DURATION = 60_000_000_000n; // 60 s, the shortest allowed window
const CONSENT = 'taply.protected-consent.v1';

await assertTestnet();
const wasm = readFileSync(WASM_PATH);
const wasmSha256 = createHash('sha256').update(wasm).digest('hex');
const expectedCodeHash = baseEncode(createHash('sha256').update(wasm).digest());

const contractId = process.env.TAPLY_G3_CONTRACT ?? await roleAccount('g3-contract');
const recipientId = await roleAccount('g3-recipient');
const payerId = await roleAccount('g3-payer');
const strangerId = await roleAccount('g1-payer');
const [recipient, payer, stranger] = [recipientId, payerId, strangerId].map(loadAccount);
const steps = {};

let account = await viewAccount(contractId);
if (account.code_hash === '11111111111111111111111111111111') {
  const owner = loadAccount(contractId);
  const deployed = await owner.deployContract(new Uint8Array(wasm));
  steps.deploy = deployed.transaction_outcome?.id ?? deployed.transaction?.hash;
  const init = await call(owner, contractId, 'new', {}, { gas: 30n * TGAS });
  if (init.failure) throw new Error(`init failed ${init.failure}`);
  steps.init = init.hash;
  // Lock the account: with no full-access key left, nobody can redeploy or drain it.
  const keys = await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: contractId });
  for (const k of keys.keys) {
    const r = await owner.deleteKey(k.public_key);
    steps.deleteKey = r.transaction_outcome?.id ?? r.transaction?.hash;
  }
  account = await viewAccount(contractId);
}
if (account.code_hash !== expectedCodeHash) throw new Error(`deployed code hash ${account.code_hash} != local ${expectedCodeHash}`);
const accessKeys = (await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: contractId })).keys;
const config = await view(contractId, 'get_config');

async function createAndLock(memo) {
  const block = await finalBlock();
  const { terms, termsHash } = buildTerms({ contractId, creator: recipientId, amount: PRINCIPAL, mode: 'protected',
    cancelDurationNs: DURATION.toString(), nowNs: block.timestampNs, memo });
  const quote = await view(contractId, 'quote_create_request', { terms });
  const created = await call(recipient, contractId, 'create_request', { terms, quoteVersion: quote.quoteVersion },
    { deposit: BigInt(quote.depositYocto), gas: 30n * TGAS });
  if (created.failure) throw new Error(`create failed ${created.failure}`);
  const locked = await call(payer, contractId, 'fund_protected_native',
    { id: terms.id, expectedTermsHash: termsHash, acceptedCancelDurationNs: DURATION.toString(), consentVersion: CONSENT },
    { deposit: PRINCIPAL, gas: 20n * TGAS });
  if (locked.failure) throw new Error(`fund failed ${locked.failure}`);
  return { terms, termsHash, created, locked, view: await view(contractId, 'get_request', { id: terms.id }) };
}
/** Transfers the outcome delivered to `to` from the contract (receipt-level proof). */
function transfersTo(outcome, to) {
  return outcome.receipts
    .filter((r) => r.receiver_id === to && r.predecessor_id === contractId)
    .flatMap((r) => (r.receipt.Action?.actions ?? []).filter((a) => a.Transfer).map((a) => ({ receiptId: r.receipt_id, deposit: a.Transfer.deposit })));
}

// --- A. Refund: payer cancels inside the window --------------------------------
const a = await createAndLock('Taply G3 refund proof');
const wrongCancel = await call(recipient, contractId, 'cancel_protected', { id: a.terms.id, expectedTermsHash: a.termsHash }, { deposit: 1n, gas: 50n * TGAS });
const earlyRelease = await call(stranger, contractId, 'release_protected', { id: a.terms.id }, { deposit: 1n, gas: 50n * TGAS });
const cancel = await call(payer, contractId, 'cancel_protected', { id: a.terms.id, expectedTermsHash: a.termsHash }, { deposit: 1n, gas: 50n * TGAS });
const refunded = await view(contractId, 'get_request', { id: a.terms.id });

// --- B. Release: window ends, a third account releases to the recipient ----------
const b = await createAndLock('Taply G3 release proof');
const cutoff = BigInt(b.view.cancelUntilNs);
while ((await finalBlock()).timestampNs < cutoff) await sleep(3000);
const lateCancel = await call(payer, contractId, 'cancel_protected', { id: b.terms.id, expectedTermsHash: b.termsHash }, { deposit: 1n, gas: 50n * TGAS });
const release = await call(stranger, contractId, 'release_protected', { id: b.terms.id }, { deposit: 1n, gas: 50n * TGAS });
const released = await view(contractId, 'get_request', { id: b.terms.id });
const doubleRelease = await call(stranger, contractId, 'release_protected', { id: b.terms.id }, { deposit: 1n, gas: 50n * TGAS });
const accounting = await view(contractId, 'get_accounting');

const summary = {
  refund: { status: refunded.status, refundTransfers: transfersTo(cancel.outcome, payerId) },
  release: { status: released.status, payoutTransfers: transfersTo(release.outcome, recipientId) },
  refusals: { recipientCancel: wrongCancel.failure, earlyRelease: earlyRelease.failure, lateCancel: lateCancel.failure, doubleRelease: doubleRelease.failure },
};
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync(new URL('../../../docs/evidence/testnet-e2e/', import.meta.url), { recursive: true });
const out = new URL(`../../../docs/evidence/testnet-e2e/${stamp}-g3-protected.json`, import.meta.url);
writeEvidence(out, {
  kind: 'TAPLY_G3_PROTECTED_CANDIDATE_AUTOMATED_TESTNET_PROOF', network: 'near-testnet',
  note: 'UNREVIEWED candidate contract on its own disposable account; automation accounts, not owner wallets.',
  contractId, deployedCodeHash: account.code_hash, wasmSha256, accessKeysAfterLock: accessKeys, config, deploySteps: steps,
  recipientAccountId: recipientId, payerAccountId: payerId, releaserAccountId: strangerId, principalYocto: PRINCIPAL, cancelDurationNs: DURATION,
  refundFlow: { requestId: a.terms.id, create: a.created.hash, fund: a.locked.hash, lockedView: a.view, cancel: cancel.hash, cancelGasBurnt: cancel.gasBurnt,
    final: refunded, refundTransfers: summary.refund.refundTransfers,
    refusals: { recipientCancel: { hash: wrongCancel.hash, failure: wrongCancel.failure }, earlyRelease: { hash: earlyRelease.hash, failure: earlyRelease.failure } } },
  releaseFlow: { requestId: b.terms.id, create: b.created.hash, fund: b.locked.hash, lockedView: b.view, release: release.hash, releaseGasBurnt: release.gasBurnt,
    final: released, payoutTransfers: summary.release.payoutTransfers,
    refusals: { lateCancel: { hash: lateCancel.hash, failure: lateCancel.failure }, doubleRelease: { hash: doubleRelease.hash, failure: doubleRelease.failure } } },
  accounting,
});
console.log(JSON.stringify({ contractId, codeHash: account.code_hash, keysLeft: accessKeys.length, ...summary, evidence: out.pathname }, null, 1));
