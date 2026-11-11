// Protected Pay escrow on the LIVE Testnet contract (the one taplyapp.xyz uses):
// adversarial calls that must be refused, using fresh disposable faucet accounts.
// Complements docs/evidence/testnet-e2e/2026-11-09T08-34-40-964Z-g3-protected.json
// (wrong canceller, early release, late cancel, double release on this contract).
//  - second funding of a LOCKED request (same payer, and a stranger)
//  - funding with the wrong amount, wrong terms hash or a different cancel window
//  - paying a Protected request through the instant-pay method
//  - a stranger cancels; the recipient releases before the cutoff
//  - the payer cancels twice; anyone releases after the refund
// Every refused call must leave the request unchanged and move no principal.
// Usage: TAPLY_E2E_KEY_DIR=<fresh dir outside the repo> node protected-adversarial.mjs <lib.mjs path> <out.json>
const [libPath, outPath] = process.argv.slice(2);
const { assertTestnet, buildTerms, call, finalBlock, loadAccount, roleAccount, TGAS, view, viewAccount, writeEvidence } = await import(libPath);

const CONTRACT = 'taply-e2e-ce38a238.testnet';
const CODE_HASH = '963iSEB8XFKeUMY1gmj5bCuA2JMVD55ksjdLfCwiPA84';
const PRINCIPAL = 20_000_000_000_000_000_000_000n; // 0.02 test NEAR
const DURATION = 300_000_000_000n; // 5 minutes: the cutoff is never reached in this run
const CONSENT = 'taply.protected-consent.v1';

await assertTestnet();
const account = await viewAccount(CONTRACT);
if (account.code_hash !== CODE_HASH) throw new Error(`code hash ${account.code_hash} is not the pinned ${CODE_HASH}`);
const recipientId = await roleAccount('adv-recipient');
const payerId = await roleAccount('adv-payer');
const strangerId = await roleAccount('adv-stranger');
const [recipient, payer, stranger] = [recipientId, payerId, strangerId].map(loadAccount);
const log = [];
const step = (s) => { log.push({ atMs: Date.now(), step: s }); console.log('·', s); };

async function create(memo) {
  const block = await finalBlock();
  const { terms, termsHash } = buildTerms({ contractId: CONTRACT, creator: recipientId, amount: PRINCIPAL, mode: 'protected',
    cancelDurationNs: DURATION.toString(), nowNs: block.timestampNs, memo });
  const quote = await view(CONTRACT, 'quote_create_request', { terms });
  const created = await call(recipient, CONTRACT, 'create_request', { terms, quoteVersion: quote.quoteVersion },
    { deposit: BigInt(quote.depositYocto), gas: 30n * TGAS });
  if (created.failure) throw new Error(`create failed ${created.failure}`);
  return { terms, termsHash, created: created.hash };
}
const fund = (who, r, over = {}) => call(who, CONTRACT, 'fund_protected_native',
  { id: r.terms.id, expectedTermsHash: over.termsHash ?? r.termsHash, acceptedCancelDurationNs: (over.duration ?? DURATION).toString(), consentVersion: CONSENT },
  { deposit: over.deposit ?? PRINCIPAL, gas: 20n * TGAS });
const cancel = (who, r) => call(who, CONTRACT, 'cancel_protected', { id: r.terms.id, expectedTermsHash: r.termsHash }, { deposit: 1n, gas: 50n * TGAS });
const release = (who, r) => call(who, CONTRACT, 'release_protected', { id: r.terms.id }, { deposit: 1n, gas: 50n * TGAS });
const snapshot = async (r) => { const v = await view(CONTRACT, 'get_request', { id: r.terms.id }); return { status: v.status, revision: v.revision, payer: v.payerAccountId }; };

const checks = [];
async function mustFail(name, r, attempt) {
  const before = await snapshot(r);
  const res = await attempt();
  const after = await snapshot(r);
  const ok = res.failure !== null && res.failure !== undefined && JSON.stringify(before) === JSON.stringify(after);
  checks.push({ name, refused: ok, tx: res.hash, failure: res.failure ?? null, before, after });
  step(`${ok ? 'REFUSED' : 'NOT REFUSED'} ${name}: ${res.failure ?? 'succeeded'}`);
}

const accountingBefore = await view(CONTRACT, 'get_accounting');

// A. Funding guards on an OPEN request.
const a = await create('Taply adversarial A');
step(`created A ${a.terms.id}`);
await mustFail('fund with 1 yocto less than the amount', a, () => fund(payer, a, { deposit: PRINCIPAL - 1n }));
await mustFail('fund with 1 yocto more than the amount', a, () => fund(payer, a, { deposit: PRINCIPAL + 1n }));
await mustFail('fund with a wrong terms hash', a, () => fund(payer, a, { termsHash: '0'.repeat(64) }));
await mustFail('fund accepting a different cancel window', a, () => fund(payer, a, { duration: DURATION - 1n }));
await mustFail('instant-pay a Protected request (bypass the escrow)', a, () => call(payer, CONTRACT, 'pay_instant_native',
  { id: a.terms.id, expectedTermsHash: a.termsHash }, { deposit: PRINCIPAL, gas: 50n * TGAS }));
const locked = await fund(payer, a);
if (locked.failure) throw new Error(`honest fund failed ${locked.failure}`);
step(`A locked by payer: ${(await snapshot(a)).status}`);

// B. A LOCKED request: second funding and unauthorized settlement.
await mustFail('second funding by the same payer', a, () => fund(payer, a));
await mustFail('second funding by a stranger', a, () => fund(stranger, a));
await mustFail('stranger cancels', a, () => cancel(stranger, a));
await mustFail('recipient cancels', a, () => cancel(recipient, a));
await mustFail('recipient releases before the cutoff', a, () => release(recipient, a));
await mustFail('stranger releases before the cutoff', a, () => release(stranger, a));

// C. Refund, then everything after it.
const refunded = await cancel(payer, a);
if (refunded.failure) throw new Error(`honest cancel failed ${refunded.failure}`);
const afterRefund = await view(CONTRACT, 'get_request', { id: a.terms.id });
step(`A after payer cancel: ${afterRefund.status}`);
await mustFail('payer cancels twice', a, () => cancel(payer, a));
await mustFail('release after the refund', a, () => release(stranger, a));
await mustFail('fund again after the refund', a, () => fund(payer, a));

const accountingAfter = await view(CONTRACT, 'get_accounting');
const result = {
  kind: 'TAPLY_PROTECTED_PAY_ADVERSARIAL_LIVE_CONTRACT', network: 'near-testnet', atUtc: new Date().toISOString(),
  note: 'Disposable faucet accounts. Calls go straight to the escrow contract that taplyapp.xyz uses (no browser).',
  contractId: CONTRACT, codeHash: account.code_hash, recipientAccountId: recipientId, payerAccountId: payerId, strangerAccountId: strangerId,
  requestId: a.terms.id, createTx: a.created, honestLockTx: locked.hash, honestCancelTx: refunded.hash,
  finalStatus: afterRefund.status, refund: afterRefund.latestOperation,
  checks, allRefused: checks.every((c) => c.refused), accountingBefore, accountingAfter, steps: log,
};
writeEvidence(outPath, result);
console.log(JSON.stringify({ allRefused: result.allRefused, finalStatus: result.finalStatus, refused: checks.filter((c) => c.refused).length, total: checks.length }));
if (!result.allRefused || afterRefund.status !== 'CANCELLED_REFUNDED') process.exit(1);
