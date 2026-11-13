# Taply Gift

NEAR Testnet only. No real funds. The gift contract has **not** had a human or external security review.

Taply Gift wraps NEAR in a digital envelope. There are two kinds:

| | Personal Gift | Open Gift |
| --- | --- | --- |
| What moves | A plain NEAR transfer from the Taply Wallet to one account | A deposit into the separate gift contract (`contracts/gift`) |
| When the recipient has the money | As soon as the transfer is final. Opening the envelope is not needed | Only after a claim transaction wins on chain **and** the payout is confirmed |
| Link | `/gift/p#g=<payload>`: sender, recipient, amount, tx hash, message, design | `/gift/<id>#k=<link secret>` |
| What the gift page checks | That exact transfer at a FINAL block (`verifyDirectTransfer`) | `get_gift` at a FINAL block, with the contract code hash pinned |
| State | Live behind `gift` (on, kill switch `NEXT_PUBLIC_TAPLY_FLAG_GIFT=off`) | **Off.** Needs `giftClaimable=on` plus a deployed contract id and code hash. Not deployed yet |

Taply never calls a Personal Gift escrow or claimable, and it never shows an Open Gift as received before the chain says so.

## Open Gift: contract design

Source: `contracts/gift/src/lib.rs`, near-sdk 5.30.0 and Rust 1.95.0 (the same pins as Protected Pay).

### The link key

The creator's browser generates two things:
- a random 128-bit gift id;
- a one-off ed25519 key pair, the "link key".

Only the public key goes on chain. The 32-byte secret seed lives in the URL **fragment** (`#k=`), which browsers never send to a server.

To claim, the claimant's browser signs this message with the link key:

`taply-gift-claim:v1:<contract id>:<gift id>:<claimant account>`

The contract then:
- verifies the signature with `env::ed25519_verify` against the stored public key;
- takes the claimant from `predecessor_account_id()`;
- pays only that account.

What this gives:
- Someone who only watches the chain cannot claim. They see the public key, never the seed.
- A signature seen in someone else's claim cannot be reused. It is bound to that claimant's account.
- The payout destination cannot be swapped. It is always the account that signed the claim.
- Anyone who has the link **can** claim, bots included. We do not claim otherwise.

### State machine

```
             create_gift (exact deposit = amount + 0.01 NEAR fee)
                          │
                      AVAILABLE ── block time ≥ expiry ──► (EXPIRED, derived in views)
          claim_gift      │                                     │ refund_gift (creator only)
 (before expiry, link     │                                     ▼
  signature, not creator) ▼                                 REFUNDED
                       CLAIMED(beneficiary = claimant)    (beneficiary = creator)
                          │  payout: PENDING ──callback──► CONFIRMED
                          │                  └─callback──► FAILED ── retry_payout (beneficiary only) ──► PENDING
                          │  callback never runs: stays PENDING forever, never re-paid
```

- **Exactly one winner.** The first accepted `claim_gift` changes the record from `AVAILABLE` to `CLAIMED` in the same receipt that schedules the transfer (debit first). Receipts for one contract run one after another, so every later claim fails with `ALREADY_SETTLED`.
- **Claim and refund never race.** Before expiry only a claim can succeed. At or after expiry only the creator's refund can. At the exact expiry nanosecond the refund wins.
- **Payout goes to the signer only.** This is "design B" in [R2_REACHABILITY.md](R2_REACHABILITY.md), a pull pattern. The destination signed the transaction, so a native transfer to it fails only if that account deletes itself.
- **The callback only records; it never pays.** `on_payout` is private and bound to the gift id and a payout nonce. It records `CONFIRMED` or `FAILED` and never transfers. It writes a record of the same size.
- **Unknown stays unknown.** If the callback cannot run, the payout stays `PENDING`. Then:
  - there is no retry, refund or second claim;
  - there is no admin;
  - the payout is not counted as paid (`claimedPaid` excludes it).

  The UI says "not recorded yet" and that Taply never sends again automatically. This is the R-2 class. Here it cannot cause a double payout, and with no callback dependency for the funds themselves, the claimant already holds the NEAR if the transfer landed.
- **Retry needs a confirmed failure.** `retry_payout` works only after the chain recorded `FAILED`, which means the funds provably came back. Only the same beneficiary can call it, it pays that beneficiary, and it uses a fresh nonce. The liquidity check refuses it until the failed transfer's refund has arrived.
- **No admin surface.** There is no owner, withdraw, upgrade or migrate method; a unit test checks the method list. The deployment plan deletes every access key.
- **Accounting.** The contract checks on every change that `deposited = held + inFlight + failedHeld + claimedPaid + refunded`.
  - Before any outgoing transfer, the balance must cover storage, every held principal, every failed principal and the outgoing amount.
  - This check runs before anything is written.
- **Storage.**
  - The fee is a flat, non-refundable 0.01 NEAR per gift.
  - At creation the contract checks that the fee covers the record plus its largest possible settlement.
  - The measured worst case (64-character accounts, 280-byte message) is **589 bytes**, or 0.00589 NEAR.
  - Callbacks and retries never grow storage.
- **Inputs.** All arithmetic on amounts and timestamps is checked (`checked_add`, `checked_sub`, `checked_mul`) and `overflow-checks = true`. The contract enforces:
  - gift id: exactly 32 lowercase hex characters;
  - public key and signature: exact-length hex;
  - amount: 0.01 to 100 NEAR;
  - lifetime: 10 minutes to 30 days;
  - message: at most 280 bytes, no control characters except newline;
  - design: 0 to 7;
  - attached deposit on claim, refund and retry: zero;
  - prepaid gas: at least 30 TGas.

### Lifetime shown in the app

The options are 1 hour, 24 hours (default) and 7 days. The app explains the rule in plain words: until the window ends, only a claim can take the gift, not even the sender. If nobody claims it, the sender can take it back afterwards.

## Wallet integration

- **Taply Wallet.** `packages/near-client/src/wallet-backend.ts` (`checkedGift`) signs a gift call only if it equals the call rebuilt from a FINAL, code-hash-anchored read of the configured gift contract.
  - For a claim, it also verifies the link signature for **this** signer before signing.
  - It refuses a `create_gift` whose id already exists.
  - It never signs `retry_payout` for a `PENDING` payout.
  - The confirmation dialog names the action ("Fund an Open Gift", "Claim a gift (paid to you)") and shows the sender, contract, attached NEAR and fee.
- **External wallets (NEAR Connect).** They get the same exact call through the existing adapter. A declined or unclear result is never treated as "nothing sent". Every gift call is idempotent on chain, so repeating an unknown attempt can never move money twice:
  - a create reuses its pre-chosen id, so a second funding fails with `GIFT_ID_TAKEN`;
  - a second claim or refund fails with `ALREADY_SETTLED`.
- **Personal Gift.** It reuses Taply Wallet `prepareSend` and `sendNear`: reviewed backend, confirmation dialog, FINAL outcome. External wallets have no direct-transfer signer in Taply (`SEND_SIGNER_AVAILABLE = false`), so Personal Gift needs Taply Wallet and says so.
- There is no new seed phrase or password system, and Mainnet signing stays off.

## Web routes

- `/gift/new`: five steps (type, amount, envelope and message, review, share). Reached from the central **Tap** sheet, entry **Send a Gift**.
- `/gift/[id]`: the envelope (CSS and SVG; reduced motion gives a cross-fade), Unwrap (visual only), Claim (a separate transaction), the live state, countdown, winner and payout.
  - States: available, connecting, awaiting wallet, claim submitted, claim pending on chain, claimed, payout failed (retry), already claimed, expired (creator: take it back), refund pending, refunded, verification unavailable, not found.
- `/gift/[id]/receipt`: facts at a final block, with the contract and code hash.
- `/gift/p`: the Personal Gift envelope and its transfer check. The message is labelled as coming from the link.
- Sharing: copy, **Share on X** (an `x.com/intent/tweet` web intent with correctly encoded text and URL; nothing is posted automatically and Taply has no X API access), native share and QR.

## Tests (real results, 2026-11-13)

| Suite | Result |
| --- | --- |
| Contract unit tests (`cargo test --locked --lib`) | **23 passed**: the 14 required categories, plus a cross-implementation vector (Web Crypto signature verified by the contract) |
| Sandbox, real local NEAR node (`contracts/gift/sandbox`) | **5 passed**: exact payout; 3 rounds of 4 concurrent claimants with exactly one winner each; expiry and creator-only refund; bad inputs roll back; TEST-ONLY fault build shows an unknown payout stays `PENDING` and is never re-paid. Log: [`docs/evidence/gift-sandbox-2026-11-13/`](evidence/gift-sandbox-2026-11-13/) |
| near-client (`pnpm --filter @taply/near-client test`) | **265 passed**, 12 of them new for gifts (builders, reader, link key, transfer check, wallet allowlist) |
| Web (`pnpm --filter @taply/web check`) | **1,245 passed**, 1 skipped (live-RPC test), 28 of them new for gifts |
| Browser visual QA (Playwright, 360, 390 and 430 px, reduced motion) | Screens render, no horizontal overflow. **Synthetic RPC**: [`docs/evidence/gift-ui-2026-11-13/`](evidence/gift-ui-2026-11-13/) |
| Real NEAR Testnet | **Not run yet.** Needs owner approval to deploy (below) |

Measured gas, from the sandbox:

| Call | Gas burnt |
| --- | --- |
| `create_gift` | 2.13 TGas |
| `claim_gift`, including transfer and callback | 5.75 TGas |
| `refund_gift` | 5.51 TGas |
| A refused claim | 1.68 TGas |

Attached gas is 30 TGas for create and 50 TGas for claim, refund and retry. The callback is fixed at 10 TGas.

## Testnet deployment plan (needs owner GO)

| Item | Value |
| --- | --- |
| Contract account | A fresh faucet account created by the script (`taply-e2e-<8 hex>.testnet`, role `gift-contract`), or the owner's choice through `TAPLY_GIFT_CONTRACT`. Never the pilot or the escrow |
| Artifact | `contracts/gift/artifacts/taply-gift.wasm` (`bash contracts/gift/scripts/build.sh`), 260,538 bytes |
| sha256 | `613c505033740407f77fdd5d5426528f6d4e5a6bb2e16c9eda41ae014ac47a60` |
| NEAR code hash | `7YZtXjTS7qLDzGY5oAL99agv8ZzKbaKpFyP98htUt21u` (rebuilt twice in this container, identical) |
| Storage | About 2.61 NEAR locked for the code on the contract account (the faucet gives 10 test NEAR), plus at most 0.00589 NEAR per gift, covered by the 0.01 NEAR fee |
| Steps | (1) `TAPLY_GIFT_DEPLOY_APPROVED=yes node packages/near-client/testnet-e2e/gift.mjs`: deploy, `new()`, delete **all** access keys, check the code hash, then run create, winning claim, refused second claim and the adversarial refusals. Evidence goes to `docs/evidence/testnet-e2e/<stamp>-gift.json`. (2) Optional `TAPLY_GIFT_WAIT_REFUND=1` (about 11 minutes) for expiry and refund. (3) Set `NEXT_PUBLIC_TAPLY_FLAG_GIFT_CLAIMABLE=on`, `NEXT_PUBLIC_TAPLY_GIFT_CONTRACT_ID` and `NEXT_PUBLIC_TAPLY_GIFT_CODE_HASH` on a preview build, then do the three-browser demo |
| Rollback | Unset the flag (`NEXT_PUBLIC_TAPLY_FLAG_GIFT_CLAIMABLE=off`). The contract cannot be changed or drained, and existing gifts can still be claimed or refunded on chain |

### Security limitations

1. **No human or external review.** `get_config` reports `UNREVIEWED_NOT_FOR_REAL_FUNDS` and the UI repeats it.
2. **Unknown payout outcome (R-2 class).** If `on_payout` cannot run, the record stays `PENDING` forever. That means no double payout, but `claimedPaid` stays understated and the UI shows "not recorded yet". We found no input that makes the callback fail: fixed 10 TGas against about 1–2 TGas of work, no storage growth, and only the beneficiary's self-deletion makes the transfer fail. Shown only with the TEST-ONLY fault build.
3. **Anyone with the link can claim, bots included.** The link must be shared deliberately. Posting it on X makes it public by design.
4. **Open Gift messages are public on chain** (the UI says so). A Personal Gift message travels in the link fragment and is not verified by the chain (the UI says so).
5. **The gift fee is not refunded** (0.01 NEAR, which keeps the record checkable).
6. **The creator's device keeps the link secret in localStorage** so the link can be shared again. It lets other people claim; it never lets the creator claim.
7. **Configured-RPC trust model**, the same as the rest of Taply (not a light client).

### Recommendation: **GO for a NEAR Testnet deployment** with test NEAR only

The financial invariants are covered by unit tests, sandbox tests on a real node and adversarial cases. The design has no administrative drain and no automatic re-payment. Keep the Open Gift flag off on taplyapp.xyz until the Testnet evidence above exists and the owner reviews it.

Not for Mainnet or real funds.
