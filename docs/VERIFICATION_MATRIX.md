# Feature verification matrix

Updated **2026-11-11**. Source: `main` = `release/taplyapp` = `ce5e9e9` at the time of
writing. NEAR **Testnet** only for every row. Nothing here is audited.

How to read the proof columns:

- **CI proof**: offline tests that run in GitHub Actions on every change
  (`workspace-check`: `pnpm check` + API tests + production build; contract
  workflows for Rust). Passing CI does **not** mean the live site was tested.
- **Real Testnet proof**: real NEAR Testnet transactions, from a script or a
  local browser build. Not proof that the public site works.
- **Production browser proof**: a real Chromium run against **https://taplyapp.xyz**
  (`"base": "https://taplyapp.xyz"` in the result file), disposable faucet accounts.
- *not proven* means no evidence of that kind exists; it does not mean it fails.

Production build identity: taplyapp.xyz does not expose its Git commit. On
2026-11-11 the served JavaScript contained strings that only exist from PR #26/#27
onward (escrow contract ID and code hash, new Protected Pay copy, the "Preparing the
QR code" text from PR #24). That is a **content match**, not a commit-SHA proof.

| Feature | Source | Production status | CI proof | Real Testnet proof | Production browser proof | Limitations |
| --- | --- | --- | --- | --- | --- | --- |
| Username wallet (`name.testnet`, faucet, 12 words) | `apps/web/src/components/wallet/taply/`, `packages/near-client/src/wallet-vault.ts` | Live | vault, phrase and onboarding tests | [onboarding](evidence/onboarding-2026-11-09/result.json) | [2026-11-09](evidence/production-2026-11-09-onboarding/phrase-result.json); also created fresh in every 2026-11-11 run below | Key lives in the browser; no independent wallet review |
| Restore from 12 words | same | Live | phrase/restore tests | [phrase import](evidence/onboarding-2026-11-09/phrase-result.json) | [2026-11-09](evidence/production-2026-11-09-onboarding/phrase-result.json) | — |
| Stay unlocked until **Lock now** (max 30 days) | `apps/web/src/lib/wallet/session-store.ts` | Live | session-store tests | [local build](evidence/taply-wallet-stay-unlocked-2026-11-10/stay-unlocked-result.json) | *not proven* (local build only) | Unlocked device or a page script can ask it to sign; every tx still shows the dialog |
| Signed request creation | `apps/web/src/components/payments/`, `contracts/payments` | Live | create-request tests | [pilot + scripts](EVIDENCE.md) | [2026-11-09](evidence/production-taply-wallet-2026-11-09/create-request-result.json), [2026-11-11](evidence/production-regression-2026-11-11/handshake/result.json) | — |
| Merchant QR drawn once, opened by Taply's scanner | `apps/web/src/components/live/LiveSession.tsx`, `lib/payments/pay-link.ts` | Live | live-merchant-qr, scan-input, qr-scanner tests | [local build](evidence/qr-stable-2026-11-10/result.json) | [2026-11-10](evidence/production-qr-stable-2026-11-10/result.json), [2026-11-11](evidence/production-regression-2026-11-11/qr-scan/result.json) | QR appears 3–5 s after creation; falls back to the plain pay link after 5 s |
| Live Handshake (join, same sale code, reviewing, disconnect/reconnect, third phone refused) | `apps/web/src/server/handshake/`, `components/live/` | Live | 3 component tests; 6 real-Redis tests (run in CI from this PR on) | [local build + real Redis](evidence/live-handshake-2026-11-10/result.json) | [2026-11-10](evidence/production-live-handshake-2026-11-10/result.json), [2026-11-11](evidence/production-regression-2026-11-11/handshake/result.json) | Coordination only: never decides "paid"; sale code is not merchant authentication |
| Native NEAR payment with explicit wallet confirmation | `components/payments/PaymentScreen.tsx`, `packages/near-client/src/wallet-backend.ts` | Live | payment-screen, signer tests | [pilot 2026-11-01](evidence/instant-pay-2026-11-01-receipt.json) | [2026-11-09](evidence/production-taply-wallet-2026-11-09/result.json), [2026-11-11](evidence/production-regression-2026-11-11/pay-near-usdc/result.json) | — |
| Pay a NEAR request with USDC (or USDT, NST, LNC, PEM) | `components/payments/TokenPay.tsx`, `packages/near-client/src/ref-swap.ts` | Live | token-pay, swap-shape tests | [USDC](evidence/testnet-e2e/2026-11-09T17-43-37-563Z-usdc-pay.json), [USDT](evidence/testnet-e2e/2026-11-09T18-19-47-447Z-usdt-pay.json) | [2026-11-09](evidence/production-taply-wallet-2026-11-09/result.json), [2026-11-11](evidence/production-regression-2026-11-11/pay-near-usdc/result.json) (USDC only) | Two approvals, not atomic; test tokens; NST/LNC/PEM not browser-tested |
| Exact merchant payout | contract `pay_instant_native` | Live | contract sandbox (`instant-pay-sandbox`) | all payment runs | 2026-11-11: contract payout record = requested amount in every run; balance deltas match except one USDC run, where the merchant's own transaction refund landed after the script's reading ([explained block by block](evidence/production-regression-2026-11-11/pay-near-usdc/usdc-delta-explained.json)) | — |
| Verified Paid (receipt verifier, live check) | `apps/web/src/lib/verify/` | Live | verifier tests | [pilot receipt](evidence/instant-pay-2026-11-01-receipt.json) | [2026-11-11](evidence/production-regression-2026-11-11/verified-paid/result.json): live check, not the archived record | Needs the funding tx hash on the device, or an archival RPC to find it (rate-limited) |
| No second payment | contract `NOT_OPEN`; UI | Live | payment-screen tests | — | [2026-11-11](evidence/production-regression-2026-11-11/verified-paid/result.json): no Approve after reload; direct second `pay_instant_native` refused `NOT_OPEN` | — |
| Declined signature, RPC busy (429), unclear wallet result | `lib/payments/submit.ts`, `components/payments/` | Live | payment-screen, receipt-rate-limit, freshness tests | — | *not proven* in a production browser | External wallets: a decline blocks a retry until the chain explains it (default 15 min) |
| Balance refresh after paying | `components/wallet/taply/TaplyWalletProvider.tsx` | Live | wallet UI tests | [local build](evidence/taply-wallet-balance-2026-11-10/balance-refresh-result.json) | [2026-11-10](evidence/production-balance-2026-11-10/balance-refresh-result.json) | — |
| Protected Pay: lock, LOCKED - NOT PAID, refund before cutoff, release after | `apps/web/src/components/protected/`, `contracts/payments-protected` | Live (escrow **not audited**) | protected tests; `protected-pay-candidate` workflow | [scripted refund/release + 4 refusals](evidence/testnet-e2e/2026-11-09T08-34-40-964Z-g3-protected.json), [local browser](evidence/protected-pay-taply-wallet-2026-11-11/result.json) | [2026-11-11](evidence/production-protected-pay-2026-11-11/result.json) (re-read from chain on 2026-11-11: `CANCELLED_REFUNDED` / `FINAL_PAID`) | R-2 open; unreviewed escrow; test NEAR only |
| Protected Pay attacks refused on the live escrow contract | `contracts/payments-protected` | Live | contract unit + sandbox | [14/14 refused](evidence/protected-adversarial-2026-11-11/result.json): wrong amount, wrong terms hash, other window, instant-pay bypass, second funding, stranger/recipient cancel, early release, double cancel, release/fund after refund | n/a (contract calls, no UI) | — |
| Protected Pay receipt screen | `components/protected/` | Live | protected-screen tests | [local browser](evidence/protected-pay-receipt-2026-11-11/result.json) | *not proven* (local build only) | — |
| Android Chrome | — | Live | — | — | [Pixel 7 emulation](evidence/production-android-emulation-2026-11-11/result.json), [Protected](evidence/production-protected-pay-2026-11-11/android-emulation/result.json) | Emulation, not a physical phone |
| External browser wallet (Meteor, HERE…) | `apps/web/src/lib/wallet/near-connect.ts` | Live | adapter tests | [pilot 2026-11-01 (owner wallet)](EVIDENCE.md) | *not proven* (needs a human with a wallet extension) | — |
| Merchant register / store QR (`/merchant`, `/checkout/<account>`) | `components/merchant/` | Live (UI); merchant sale signing **off** | merchant tests | — | — | Discovery only |
| Contacts, Split Pay, Recurring templates | `components/split/`, `lib/` | Live (on device) | tools tests | Split settles through normal requests | — | Nothing runs automatically |
| Contract-bound merchant sessions (G2) | `contracts/payments-merchant` | **Off** | `instant-pay-sandbox` | [bound sale](evidence/testnet-e2e/2026-11-09T07-59-39-406Z-g2-merchant.json) | — | Unreviewed candidate |
| Social login, sponsored gas | — | **Not implemented** | — | — | — | — |

## Tests on 2026-11-11

| Suite | Where | Result |
| --- | --- | --- |
| `pnpm check` + API tests + production Webpack build | GitHub `workspace-check`, push of `ce5e9e9` | passed ([run](https://github.com/KendineCrypto/taply/actions/runs/42977577079)); without `redis-server` on the runner: web 1,201 passed + 7 skipped, API 70 + 2 skipped |
| Same `pnpm check` locally with `redis-server` (`ce5e9e9` + this PR's docs/comment changes) | Local, 2026-11-11 | shared 93, near-client 253, web 1,207 passed + 1 skipped (the live-RPC test); exit 0 |
| Web tests that need `redis-server` (6) and API tests that need it (2) | Skipped on GitHub before this PR (no `redis-server` on the runner); run locally on 2026-11-11 | web 6/6 and API 72/72 (0 skipped) passed locally; `workspace-check` installs `redis-server` from this PR on |
| Web live-RPC test (locate the pilot funding tx) | Opt-in (`TAPLY_LIVE_RPC`) | **BLOCKED** on 2026-11-11: the regular RPC no longer holds 1 Nov blocks (`history_unavailable`) and both archival RPCs answered `429` |
| `packages/near-client` `test:integration` (not part of `pnpm check`) | Local, live Testnet | 3/3 passed |
| `instant-pay-sandbox` (Rust fmt, unit, clippy, WASM, sandbox, wire, isolation) | GitHub, `workflow_dispatch` on `ce5e9e9` | passed ([run](https://github.com/KendineCrypto/taply/actions/runs/42978498729)) |
| `protected-pay-candidate` (escrow fmt, unit, clippy, WASM, wire, G1 isolation) | GitHub, `workflow_dispatch` on `ce5e9e9` | passed ([run](https://github.com/KendineCrypto/taply/actions/runs/42978502767)) |
| `wallet-browser-check` | GitHub, `workflow_dispatch` on `ce5e9e9` | passed ([run](https://github.com/KendineCrypto/taply/actions/runs/42978507164)) |

Test counts are not a coverage claim.

## Open risks

- **R-2 (High, open):** a payout or refund transfer that succeeds while its
  callback fails stays `*_IN_FLIGHT` with no retry and no admin override. No
  double spend, but funds can be stuck. Applies to the Instant Pay pilot and the
  escrow contract. Not fixed; needs a reviewed reconciliation design before real
  funds. See [SECURITY_REVIEW_2026-11-09.md](SECURITY_REVIEW_2026-11-09.md).
- No human or external security audit of any contract or of Taply Wallet.
- The pilot contract keeps a full-access key; the receipt verifier refuses a
  receipt if the contract's keys changed during the payment window.
