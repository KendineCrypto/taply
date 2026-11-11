# Automated adversarial review — escrow, NEP-141 and merchant candidates (2026-11-09)

**This is an AI code review by the agent that wrote most of this code. It is NOT a human or external audit.**
Treat every "no finding" as "not found by this review", not as "safe".

Scope: `contracts/payments-protected` (G3 escrow + NEP-141 path, commit after `42924c2`),
`contracts/test-token`, and the deployed use of `contracts/payments-merchant` (feature `merchant-bound-v1`).
Method: line review of every state transition against `docs/PAYMENT_STATE_MACHINE.md`, mutation checks,
unit (30), sandbox on a real local node (3 + 4) and real Testnet runs (see `RELEASE_EVIDENCE_INDEX.md`).

## Findings

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| R-1 | Medium (funds stuck, no loss) | Payout callback read the promise result with `max_len = 0`. A successful token `ft_transfer` that returns any bytes would read as "unknown" and keep the obligation in flight forever. | **Fixed**: token payouts accept up to 256 bytes; native stays 0. Test `token_payout_success_with_a_return_value_is_still_success`. The deployed Testnet candidate `taply-e2e-6cdaf61b` predates the fix (the standard test token returns nothing, so its evidence is unaffected); redeploy for any further QA. |
| R-2 | High (by design, open gate) | Transfer succeeds but its callback fails (e.g. gas): obligation stays `*_IN_FLIGHT`, no retry, no admin override. No double spend, but funds can be stranded. | **Open** — same policy as G1 (freeze §10.1). Needs an agreed reconciliation design before real funds. 2026-11-11: analysis + an EXPERIMENTAL, unreviewed, undeployed candidate (hardening and observability only): [R2_CALLBACK_RECOVERY.md](R2_CALLBACK_RECOVERY.md). Verdict: **not fixed**; under Taply's "final only after confirmed delivery" semantics a contract cannot learn the outcome when the callback fails. Deployed contracts unchanged. |
| R-3 | Low | Each token payout attaches 1 yoctoNEAR from the contract's own balance; the liquidity guard does not reserve it. Exhaustion would need ~10^19 payouts and fails closed. | Accepted. |
| R-4 | Info (trust assumption) | The allowlisted token is trusted to report `sender_id`/`amount` honestly and to refund on `ft_on_transfer` panic (NEP-141 `ft_resolve_transfer`). A malicious allowlisted token could fake funding. | Accepted: allowlist fixed at init, only reviewed tokens may be listed. Testnet uses Taply's own TEST token. |
| R-5 | Info | `release_protected` is permissionless after the cutoff (freeze §4). A third party can only pay the recipient what is owed, at their own gas cost. | Accepted. |
| R-6 | Info | Token liquidity cannot be read synchronously; conservation is per-token accounting only. | Accepted; documented. |

## Checked and holding

- Only the allowlisted token named in the signed terms can fund (`WRONG_ASSET` for any other caller); fake token refused and fully returned on a real node.
- Exact amount; strict `msg` (unknown fields, payee injection, non-JSON refused); every refusal panics so the token returns everything.
- Native funding refuses token requests and vice versa (`WRONG_ASSET` / `WRONG_MODE`).
- Branch chosen once before any promise; failed refund never becomes a release; retries only by the beneficiary, same destination, fresh nonce, callback bound to id + nonce + kind.
- Cutoff: cancel strictly before, release at/after, chain time only (real Testnet: early release and late cancel refused).
- Funded once; duplicate funding refused (native) or fully returned (token).
- Conservation `received = paid + refunded + locked + inFlight + failedHeld` per asset on every transition (unit + Testnet accounting).
- Contract accounts on Testnet have **0 access keys** after init: no redeploy, no drain.
- G1 pilot source untouched (`check-isolation.mjs`), deployed hash unchanged (`BrR6bioU…`).

## Backward compatibility

- `@taply/shared` v1.1 only widens `assetId` and `failureCode`; native terms hash exactly as before (frozen vectors pass); `instant-pay-sandbox` (G1 + merchant suites, wire check) passes on the new schema.
- G1 builders and the web G1 view now explicitly refuse token terms.
- Journal gains new methods; old journal entries still parse (enum widened only).
- Not reviewed here: `apps/api` session service (Codex Phase 7C reviews apply).
