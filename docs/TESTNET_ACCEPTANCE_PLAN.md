# G1 Testnet signing: acceptance gate (updated 2026-11-09)

> **Archived status report.** This file records what was true on the date in its
> title or sections and is kept unchanged as history. It is not the current status.
> Current status (2026-11-11): payments are signed on taplyapp.xyz, the live two-phone
> Handshake and Protected Pay (Testnet escrow, not audited) are on. Authoritative:
> [README](../README.md) and [VERIFICATION_MATRIX.md](VERIFICATION_MATRIX.md).

Public signing on https://taplyapp.xyz is **off**. It is turned on only after
the run below produces real evidence. Nothing in this file has been executed
with a wallet yet.

## Why signing is off (exact)

`signingBlockFor()` in `apps/web/src/lib/payments/context.tsx` returns the first unmet condition:

1. payments setup ready (contract + approved code hash configured): met
2. contract `get_config` verified at a fresh final block (code hash, Testnet, no fault build, Instant-only): met
3. `NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY`: **`off` in Production** → "Payments not enabled yet"

Always off regardless of env: Taply-native wallet signing, direct send, social
login, sponsored gas, milestone. Merchant sales use the same Instant Pay gate;
`NEXT_PUBLIC_TAPLY_FLAG_MERCHANT` stays off and is a separate decision.

## Where to test: protected QA build

| | |
| --- | --- |
| URL | https://taply-git-qa-g1-signing-kendinecryptos-projects.vercel.app |
| Access | Vercel login with an account in the `kendinecryptos-projects` team (both phones) |
| Source | Git branch `qa/g1-signing` (same code as the release) |
| Difference from production | Only `NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY=on` (Vercel Preview variable scoped to this branch). Merchant, Handshake, Protected Pay: off |
| Checked 2026-11-09 | The request review offers an enabled "Create request in wallet" button with the cost disclosed. It was **not** clicked |

Share links on this build use its own (protected) address, so the paying phone
must also be logged in to Vercel.

## Run (owner, about 20 minutes, 2 Testnet accounts, ≤ 0.05 Testnet NEAR)

Account A = recipient, account B = payer, each in its own external wallet
(Meteor, HERE or MyNearWallet). Never use a mainnet account.

1. Phone 1, account A: open the QA URL → Connect wallet → **Request** → `0.01`
   → Continue. Check amount, recipient, deadline and fee → **Create request in
   wallet** → approve in the wallet. Expect the request page and its QR.
2. Phone 2, account B: scan the QR. Expect the same amount, recipient and sale
   code read from chain. Tap **Approve in wallet** → **decline** in the wallet.
   Expect "Result unknown"-style status and **no** offer to pay again.
3. Wait until the request expires (15 min) or create a fresh request (step 1),
   then pay it from phone 2 and **approve** in the wallet. Expect Payment
   observed → Paid per contract → **Verified Paid** (open the receipt).
4. Phone 1: the same request reaches Paid per contract / Verified Paid without
   any link from phone 2.
5. Reload both phones and reopen the app from the home screen: statuses persist,
   no duplicate payment is possible.
6. Copy the receipt evidence JSON from the receipt page.

## Evidence required before public signing

- Request ID, creation tx hash, funding tx hash (from the explorer), and the
  receipt JSON showing `verified_final` / Verified Paid.
- Screenshots of: the review with cost, the decline result (no repeat offer),
  Verified Paid on both phones.
- Read-only preflight 10/10 PASS on the same day:
  `node apps/web/scripts/deploy-preflight.mjs post taply-pay-pilot-1.testnet --rpc https://test.rpc.fastnear.com`.
- CI green on the release head (workspace, wallet-browser, instant-pay-sandbox).

## Turning it on in production (after the evidence, with written owner approval)

1. Vercel → Production variable `NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY=on`
   (only this one; merchant stays off).
2. Redeploy `release/taplyapp` (a push or a redeploy of the current production
   build; `NEXT_PUBLIC_*` values are baked at build time).
3. On https://taplyapp.xyz repeat steps 1 and 3 once with 0.01 NEAR: this proves
   the wallet return to the production origin.
4. **Rollback:** set the variable back to `off` and redeploy, or use Vercel
   Instant Rollback to the previous production deployment (no rebuild).

Do not enable Protected Pay, Handshake, merchant signing or native wallet signing as part of this.

## Earlier gates

- F-01 (wallet ambiguous-result fix, `9db43fb`, `24cf04a`): re-audited in code
  on 2026-11-09 (AI review, see the nightly report). Human/external review is
  still recommended; the device run above covers the user-visible behaviour.
- The 2026-11-08 MODE 2 proposal (local build behind Tailscale) is replaced by
  the protected QA build above.
