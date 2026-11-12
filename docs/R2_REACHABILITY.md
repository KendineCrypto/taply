# R-2: can it be eliminated? Reachability and design options (2026-11-12)

**Verdict: R-2 is still OPEN. It is not fixed.**

- **Deployed contracts:** in the push-plus-callback design that both deployed contracts use, R-2 cannot be eliminated. Once its callback fails, a NEAR contract cannot learn what happened to a transfer.
- **Reachability:** we found no user input that makes either deployed callback fail. The evidence is below.
- **Elimination:** a beneficiary-claim design would remove R-2 as a class for native NEAR. It changes what "paid" means and needs a new contract, a new deployment and a human review. None of that has been done.

Nothing here changes a contract, a deployment or production.

## 1. What R-2 is

The payout and refund paths do two things:
- they schedule `Transfer` to the beneficiary;
- they then schedule `.then(on_native_transfer_complete)` on the contract itself.

NEAR gives the transfer's result only to that callback receipt. If the callback fails, its state changes are rolled back. The record stays `*_IN_FLIGHT` for good, and no retry is offered, because the transfer may already have happened. No host function can read a past receipt's outcome, block hash or state root.

What R-2 can and cannot do:
- It cannot cause a double payout.
- It can strand funds.
- The app never shows a stranded record as paid ([test](../apps/web/src/lib/payments/__tests__/r2-no-false-paid.test.ts)).

## 2. Can the deployed callback fail? Every failure path

Both deployed callbacks were read line by line:
- `contracts/payments/src/lib.rs:215-262`: Instant Pay pilot, code hash `BrR6bioU…`.
- `contracts/payments-protected/src/lib.rs:413-480`: escrow, code hash `963iSEB8…`.

| Failure path | Can a user reach it? | Why |
| --- | --- | --- |
| Out of gas | No (measured) | Every callback gets a fixed 15 TGas (`CALLBACK_GAS`, line 10 / 14). Real Testnet receipts burned **2.13 TGas** (pilot) and **2.27 TGas** (escrow), so about 7× headroom. The callback does fixed-size work: one record read and write, and one log line. |
| `STORAGE_GROWTH_FORBIDDEN` / storage staking | No | `save()` refuses any size change (pilot line 377, escrow line 774). Records and the contract state are fixed-size. Every outgoing transfer first passes `check_liquidity(outgoing)`, which requires balance ≥ storage + held obligations + outgoing (pilot line 310, escrow line 676). |
| `STALE_CALLBACK` / `REQUEST_NOT_FOUND` | No | Records are never deleted. While a record is in flight, nothing else can change its status or nonce: retry needs `Failed`, cancel and release need `Locked`. |
| `UNKNOWN_PROMISE_RESULT` | No for native NEAR | A native `Transfer` returns empty bytes (`max_len 0`). For token payouts, `max_len` is 256 bytes. |
| `CONSERVATION_FAILURE`, overflow | No | The accounting moves the same amount between buckets. u128 amounts cannot overflow at Testnet scale. |
| `sandbox-fail-callback` panic | No | It is a compile-time feature that exists only in the test WASM. The deployed code reports `testFaultBuild: false`. |

What can still trigger R-2:
1. A NEAR protocol change that raises gas costs more than 7×, or raises the storage price. The storage price has stayed the same since genesis.
2. A runtime bug.
3. For **token** payouts from the escrow only: the allowlisted token returning more than 256 bytes. That token is a fixed, trusted allowlist entry (R-4).
4. For the "transfer failed" variant: the destination is always an account that signed for this request (the creator for a payout, the payer for a refund). A native transfer to it fails only if that account deleted itself first. The sandbox reproduced this with a deleted account (`gone.test.near`).

The sandbox reproduced R-2 **only** with the test-only fault build (`docs/evidence/r2-sandbox-2026-11-11/` on the PR #31 branch).

**Classification:**

| Aspect | Rating |
| --- | --- |
| Impact | High (funds stranded) |
| Reachable by a user | No known path |
| Status | Open, because elimination is not demonstrated |

Measured receipts (public, NEAR Testnet):

| Contract | Transaction | Callback gas burned / attached |
| --- | --- | --- |
| `taply-pay-pilot-1.testnet` | `7Ajta5TugRqXEWHqMEN8d34hnxQ6doGxqXwerpKNX2qz` (signer `taply-e2e-fed53747.testnet`) | 2.127 / 15 TGas |
| `taply-e2e-ce38a238.testnet` | `ELTFZt55Dqmi18b9aoaNpuKm6pnu1y4YAVhdLdvejeVL` (signer `taply-client-a093b9.testnet`, `cancel_protected`) | 2.266 / 15 TGas |

## 3. The three designs

| Design | Removes the unknown outcome? | Keeps the "paid = recipient received it" meaning? | Cost |
| --- | --- | --- | --- |
| **A. Direct settlement (deployed), hardened** | **No.** Hardening lowers how often it can happen, never to zero | Yes | Already done: fixed gas, no storage growth, liquidity guard. PR #31 adds settlement/delivery observability. Not deployed. |
| **B. Beneficiary claim (pull)** | **Yes for native NEAR.** Payment credits the beneficiary's claimable balance in the same receipt, with no cross-contract call. Withdrawal is `withdraw()` by the beneficiary to **itself**, debit first, **no callback**. The destination signed the call, so the transfer can fail only if it deletes itself in the next block. That harms no one else and cannot pay twice | **No.** The merchant is "credited, withdrawable", not "received", until it withdraws. That is a product decision, and the earlier review rejected redefining `FINAL_PAID`. A new state (`CREDITED`) would be needed | New contract, deployment, web states and evidence. Tokens need a `storage_balance_of` pre-check, then `ft_transfer` without a callback. About 4–6 days plus review |
| **C. Independently provable reconciliation** | Yes, in theory | Yes | A contract cannot verify its own past receipts. It would need an on-chain NEAR light client fed with validator-signed light-client blocks (`ed25519_verify` exists) to check `light_client_proof` outcome proofs. That is weeks of work, heavy on gas, and a large audit surface. A trusted resolver instead (owner or multisig) adds a trust assumption and is not independent |

### Rejected

- **Settle first (`FINAL_PAID` before confirmation).** This was v1 of PR #31. A real sandbox run produced a false `FINAL_PAID` when the transfer failed and the callback failed. Evidence: `docs/evidence/r2-sandbox-2026-11-11/v1-rejected-settle-first/` on the PR #31 branch.
- **Re-paying a stuck record on request.** If the first transfer actually landed, this pays twice. Forbidden.
- **Beneficiary attestation ("I received it").** It is safe for the success case, because a beneficiary who lies only hurts itself. It cannot settle the failed case. It is a possible partial measure, not a fix.

## 4. Recommendation

1. **Before 2026-11-14:** change no contract. Keep R-2 open and present it with the reachability evidence above. The app already never shows it as paid.
2. **After the hackathon:** decide whether "credited and withdrawable" is an acceptable meaning of paid for merchants. Processors such as Stripe work this way: balance first, then payout.
   - If yes: build design B as a new contract, with sandbox tests for withdraw-to-self, withdraw after self-deletion and the token pre-check. Then review it, then migrate.
   - If no: R-2 stays an accepted residual of design A, or waits for design C.
