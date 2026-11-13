// Taply Gift on real NEAR Testnet with disposable faucet accounts.
//
// DEPLOYS ONLY WITH OWNER APPROVAL: if the gift contract account has no code
// yet, this script refuses unless TAPLY_GIFT_DEPLOY_APPROVED=yes. It deploys
// contracts/gift/artifacts/taply-gift.wasm to its OWN fresh account, calls
// new(), then deletes every access key (zero keys: the code can never change
// and nobody can drain it). It never touches the Instant Pay pilot or the
// Protected Pay escrow.
//
// Then it proves, with real transactions:
//   1. create a funded Open Gift (exact deposit = amount + fee),
//   2. a claim signed by the link key for claimant A pays exactly A,
//   3. claimant B (same link, own valid signature) is refused on chain,
//   4. adversarial refusals (creator claim, forged signature, early refund, bad id, wrong deposit),
//   5. optional (TAPLY_GIFT_WAIT_REFUND=1, ~11 minutes): expiry blocks claims, creator refunds.
//
// Usage (after `bash contracts/gift/scripts/build.sh` and `pnpm --filter @taply/near-client build`):
//   TAPLY_GIFT_DEPLOY_APPROVED=yes node packages/near-client/testnet-e2e/gift.mjs
// Output: docs/evidence/testnet-e2e/<stamp>-gift.json
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { baseEncode } from 'near-api-js';
import { assertTestnet, call, loadAccount, rpc, roleAccount, sleep, TGAS, NEAR, view, viewAccount, writeEvidence } from './lib.mjs';
import { newGiftLink, signGiftClaim, encodeGiftSecret } from '../dist/gift.js';

const WASM_PATH = new URL('../../../contracts/gift/artifacts/taply-gift.wasm', import.meta.url);
const AMOUNT = NEAR / 2n; // 0.5 test NEAR
const FEE = 10_000_000_000_000_000_000_000n;
const LIFETIME_S = 600;
const SHARE_ORIGIN = process.env.TAPLY_SHARE_ORIGIN ?? 'https://taplyapp.xyz';

await assertTestnet();
const wasm = readFileSync(WASM_PATH);
const wasmSha256 = createHash('sha256').update(wasm).digest('hex');
const expectedCodeHash = baseEncode(createHash('sha256').update(wasm).digest());
const contractId = process.env.TAPLY_GIFT_CONTRACT ?? await roleAccount('gift-contract');
const steps = {};

let account = await viewAccount(contractId);
if (account.code_hash === '11111111111111111111111111111111') {
  if (process.env.TAPLY_GIFT_DEPLOY_APPROVED !== 'yes') {
    console.error(`REFUSED: ${contractId} has no code. Deploying needs owner approval (TAPLY_GIFT_DEPLOY_APPROVED=yes).`);
    console.error(`Artifact sha256 ${wasmSha256}, NEAR code hash ${expectedCodeHash}.`);
    process.exit(2);
  }
  const owner = loadAccount(contractId);
  const deployed = await owner.deployContract(new Uint8Array(wasm));
  steps.deploy = deployed.transaction_outcome?.id ?? deployed.transaction?.hash;
  const init = await call(owner, contractId, 'new', {}, { gas: 30n * TGAS });
  if (init.failure) throw new Error(`init failed ${init.failure}`);
  steps.init = init.hash;
  const keys = await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: contractId });
  steps.deleteKeys = [];
  for (const k of keys.keys) {
    const r = await owner.deleteKey(k.public_key);
    steps.deleteKeys.push(r.transaction_outcome?.id ?? r.transaction?.hash);
  }
  account = await viewAccount(contractId);
}
if (account.code_hash !== expectedCodeHash) throw new Error(`deployed code hash ${account.code_hash} != local ${expectedCodeHash}`);
const accessKeys = (await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: contractId })).keys;
const config = await view(contractId, 'get_config');

const creatorId = await roleAccount('gift-creator');
const aId = await roleAccount('gift-claimer-a');
const bId = await roleAccount('gift-claimer-b');
const [creator, a, b] = [creatorId, aId, bId].map(loadAccount);
const balance = async (id) => BigInt((await viewAccount(id)).amount);
const gift = (id) => view(contractId, 'get_gift', { gift_id: id });
const refused = (r, code) => ({ hash: r.hash, refused: r.failure !== null && r.failure.includes(code), failure: r.failure });

async function createGift() {
  const link = await newGiftLink(webcrypto);
  const r = await call(creator, contractId, 'create_gift', { gift_id: link.giftId, public_key: link.publicKeyHex, amount: AMOUNT.toString(),
    lifetime_s: LIFETIME_S, message: 'Taply Gift on NEAR Testnet 🎁 first to claim wins', design: 1 }, { deposit: AMOUNT + FEE, gas: 30n * TGAS });
  if (r.failure) throw new Error(`create failed ${r.failure}`);
  return { link, r };
}
const claim = async (who, id, seed) =>
  call(who, contractId, 'claim_gift', { gift_id: id, signature: await signGiftClaim(webcrypto, seed, contractId, id, who.accountId) }, { gas: 50n * TGAS });

// 1. create
const g1 = await createGift();
const created = await gift(g1.link.giftId);

// 4. adversarial before the real claim
const adversarial = {};
adversarial.creatorClaim = refused(await claim(creator, g1.link.giftId, g1.link.seed), 'CREATOR_CANNOT_CLAIM');
adversarial.forgedSignature = refused(await call(b, contractId, 'claim_gift', { gift_id: g1.link.giftId,
  signature: await signGiftClaim(webcrypto, g1.link.seed, contractId, g1.link.giftId, aId) }, { gas: 50n * TGAS }), 'BAD_CLAIM_SIGNATURE');
adversarial.earlyRefund = refused(await call(creator, contractId, 'refund_gift', { gift_id: g1.link.giftId }, { gas: 50n * TGAS }), 'NOT_EXPIRED');
adversarial.badId = refused(await call(b, contractId, 'claim_gift', { gift_id: '../../etc', signature: '00' }, { gas: 50n * TGAS }), 'INVALID_GIFT_ID');
adversarial.wrongDeposit = refused(await call(creator, contractId, 'create_gift', { gift_id: 'f'.repeat(32), public_key: g1.link.publicKeyHex,
  amount: AMOUNT.toString(), lifetime_s: LIFETIME_S, message: '', design: 0 }, { deposit: AMOUNT, gas: 30n * TGAS }), 'WRONG_DEPOSIT');

// 2. winning claim by A, balance checked after FINAL + refunds settle
await sleep(3000);
const aBefore = await balance(aId);
const won = await claim(a, g1.link.giftId, g1.link.seed);
if (won.failure) throw new Error(`claim failed ${won.failure}`);
await sleep(4000);
const aAfter = await balance(aId);
const claimedView = await gift(g1.link.giftId);

// 3. B with the same link and a valid signature for B
const lost = refused(await claim(b, g1.link.giftId, g1.link.seed), 'ALREADY_SETTLED');
const repeat = refused(await claim(a, g1.link.giftId, g1.link.seed), 'ALREADY_SETTLED');

// 5. optional expiry + refund
let refund = null;
if (process.env.TAPLY_GIFT_WAIT_REFUND === '1') {
  const g2 = await createGift();
  const v = await gift(g2.link.giftId);
  const until = BigInt(v.expiresAtNs);
  for (;;) {
    const block = await rpc('block', { finality: 'final' });
    if (BigInt(block.header.timestamp_nanosec) >= until) break;
    await sleep(15_000);
  }
  const late = refused(await claim(a, g2.link.giftId, g2.link.seed), 'GIFT_EXPIRED');
  const stranger = refused(await call(b, contractId, 'refund_gift', { gift_id: g2.link.giftId }, { gas: 50n * TGAS }), 'CREATOR_ONLY');
  const cBefore = await balance(creatorId);
  const r = await call(creator, contractId, 'refund_gift', { gift_id: g2.link.giftId }, { gas: 50n * TGAS });
  await sleep(4000);
  refund = { create: g2.r.hash, giftId: g2.link.giftId, lateClaim: late, strangerRefund: stranger, refund: { hash: r.hash, failure: r.failure },
    creatorDeltaYocto: (await balance(creatorId)) - cBefore, view: await gift(g2.link.giftId) };
}

const evidence = {
  network: 'near-testnet', contractId, wasmSha256, codeHash: account.code_hash, accessKeys: accessKeys.length, steps, config,
  accounts: { creator: creatorId, claimerA: aId, claimerB: bId },
  gift: { id: g1.link.giftId, create: g1.r.hash, createGasBurnt: g1.r.gasBurnt, created,
    shareUrlShape: `${SHARE_ORIGIN}/gift/${g1.link.giftId}#k=<43-char link secret, not recorded>` },
  adversarial,
  claim: { hash: won.hash, gasBurnt: won.gasBurnt, claimant: aId, claimantDeltaYocto: aAfter - aBefore, view: claimedView },
  secondClaimRefused: lost, repeatClaimRefused: repeat,
  refund,
  accounting: await view(contractId, 'get_accounting'),
  checks: {
    zeroAccessKeys: accessKeys.length === 0,
    exactlyOneWinner: claimedView.status === 'CLAIMED' && claimedView.beneficiary === aId,
    payoutConfirmedOnChain: claimedView.payout === 'CONFIRMED',
    claimantReceivedAmountMinusGas: aAfter - aBefore > AMOUNT - NEAR / 100n && aAfter - aBefore <= AMOUNT,
    secondClaimRefused: lost.refused, repeatClaimRefused: repeat.refused,
    adversarialAllRefused: Object.values(adversarial).every((x) => x.refused),
  },
};
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const path = new URL(`../../../docs/evidence/testnet-e2e/${stamp}-gift.json`, import.meta.url).pathname;
writeEvidence(path, evidence);
console.log(JSON.stringify(evidence.checks, null, 2));
console.log(`evidence: ${path}`);
// A fresh demo link for a manual browser run (printed, never written to evidence).
if (process.env.TAPLY_GIFT_PRINT_DEMO_LINK === '1') {
  const demo = await createGift();
  console.log(`demo link: ${SHARE_ORIGIN}/gift/${demo.link.giftId}#k=${encodeGiftSecret(demo.link.seed)}`);
}
