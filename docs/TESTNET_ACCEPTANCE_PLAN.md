# Why signing is off, and the path to private G1 Testnet acceptance

Checked 2026-11-08 on `feature/monday-testnet-sprint`. Signing is **still off**.

## Root cause (exact)

`signingBlockFor()` in `apps/web/src/lib/payments/context.tsx` returns the first unmet condition:

1. payments setup ready (contract + approved code hash configured) — **met**
2. contract `get_config` verified at a fresh final block (code hash, Testnet, no fault build, Instant-only) — **met**
3. `setup.signingFlag` = `FLAGS.instantPay.enabled` ← `NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY` — **`off` → "İşlemler kapalı / Bu sürümde imzalama kapalı"**

Hard-coded off regardless of env: Taply-native wallet signing (`TAPLY_WALLET_SIGNING_ENABLED = false`), direct send (`SEND_SIGNER_AVAILABLE = false`), social login, sponsored gas, milestone. `NEXT_PUBLIC_TAPLY_FLAG_MERCHANT` is not read by any code path (merchant sales use the same Instant Pay gate).

## G1 contract today (read-only preflight, 10/10 PASS)

`node apps/web/scripts/deploy-preflight.mjs post taply-pay-pilot-1.testnet --rpc https://test.rpc.fastnear.com`:
approved code hash `BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B`, one FullAccess key, `testFaultBuild:false`,
near-testnet, Instant-only capabilities, quote v1, storage covered, principal conserved. Nothing signed.

## Capabilities, separately

| | Capability | State | Gate |
| --- | --- | --- | --- |
| A | Wallet connection (external wallet, read-only) | ON | — |
| B | Create a Testnet payment request (`create_request`) | Implemented, OFF | INSTANT_PAY flag |
| C | Sign a Testnet payment (`pay_instant_native`, retry, cancel) | Implemented, OFF | INSTANT_PAY flag + gates below |
| D | Independent verification of payout | ON (read-only) | — |
| E | Live Handshake (G2) | OFF, contract cannot bind sessions | G2 unapproved, F-06 |
| F | Protected Pay (G3) | OFF, not in G1 | escrow review, separate contract |

## Gates still open before MODE 2

1. **F-01** (wallet ambiguous-result fix, commits `9db43fb`, `24cf04a`) — fixed locally, **independent review pending**.
2. Physical iPhone acceptance of the read-only build (owner).
3. Written owner approval to enable MODE 2 for a bounded window.

## MODE 2 proposal (not active)

- Config: `apps/web/env/private-acceptance.env.example` — only `INSTANT_PAY=on` and the tailnet share origin differ from MODE 1.
- Where: only the local build on DESKTOP-SDAI72B behind Tailscale Serve (tailnet-only; access = devices in the owner's tailnet, not a secret URL). Never on Vercel/taplyapp.xyz.
- Unchanged protections: approved code hash checked at a fresh final block before every signature; terms immutable; journal written before the wallet opens; unknown/declined wallet outcomes block a repeat until the chain explains them (F-01); receipt verifier unchanged; Testnet genesis checked on every read; no keys stored.
- Every transaction is approved by the owner in their own wallet. Taply never signs.
- Window: the owner names start/end; afterwards the build is rebuilt with MODE 1.
- Test plan: small amounts (e.g. 0.01 NEAR) between two owner Testnet accounts; record tx hashes in `docs/EVIDENCE.md` only after the verifier shows Verified Paid.

To activate: owner writes "Approve MODE 2 on the tailnet build from <time> to <time>", after F-01 review.
