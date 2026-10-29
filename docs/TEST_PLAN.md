# Taply v0.4 test matrix & judge reproducibility

## Required tool layers
1. `cargo fmt`, Clippy + Rust unit tests for contract (adapt to pinned toolchain).
2. near-workspaces/sandbox integration exercising actual promise callback behavior (compatible tool versions must be verified).
3. Testnet funded real accounts and live transfer assertions; keep Testnet account ids/tx hashes in `docs/EVIDENCE.md` after run.
4. API contract schema, auth/rate limiting and mocked unreliable RPC tests.
5. Browser E2E tests Playwright on 360x780, 390x844 and desktop, two independent wallet sessions. Mark browser-only simulated tests visibly separate from blockchain E2E.
6. CI gates + one command (`pnpm test` or documented equivalent). Publish commands, expected results and actual results separately.

## Core acceptance cases
T01 create request with correct amount/token/receiver, signed by requester.
T02 a second Testnet wallet signs and pays exact native NEAR amount.
T03 exact callback payout success flips `PAYOUT_IN_FLIGHT -> FINAL_PAID` and creates valid receipt.
T04 duplicate pay rejected, no extra payout.
T05 payer wrong token/amount/recipient rejected or returned safely.
T06 request expired/unfunded cancelled, cannot accept payment.
T07 merchant permanent QR creates UNIQUE requests; receipt ID cannot be reused.
T08 two independent devices share exact session commitment/code; tampering forces mismatch.
T09 malicious session backend emits fake `paid` -> clients only show final after independent chain verification.
T10 Protected both participants accept mode and cutoff prior to funding.
T11 Protected funds show LOCKED/NOT FINAL and merchant final balance unchanged.
T12 protected payer cancels before cutoff -> refund callback -> CANCELLED_REFUNDED, no merchant payout.
T13 cancel at/after cutoff rejected on-chain, even if browser clock says time left.
T14 release before cutoff rejected; after cutoff authorized release -> callback -> FINAL_PAID.
T15 race simultaneous cancel/release -> only one outgoing transfer; conserved funds.
T16 refund promise fails -> recoverable obligation, no wrong final receipt; safe retry.
T17 payout promise fails -> recoverable obligation, no wrong final receipt; safe retry.
T18 callback replay, wrong predecessor, forged FT-on-transfer and operation nonce mismatch rejected.
T19 relayer/sponsored tx abuse blocked and no allowance to arbitrary contract calls (only if enabled).
T20 disabled social login cannot appear as live Testnet-wallet method. If enabled, OAuth identity controls real Testnet account; restore and logout tests.
T21 Contacts duplicate names and address changes cannot silently change signed recipient.
T22 Split Pay integer remainder sum exact; all children settle before group complete.
T23 Recurring scheduler duplicate occurrence cannot auto-charge payer.
T24 approve/decline, wrong network, insufficient funds/gas, offline, unknown tx result UX truthful.

## Demo fixture setup
Provide sample Testnet merchant Alice and payer Bob, native NEAR amounts small and adequately gas-funded. Never commit private account keys. All demo receipts must link to actually observed explorer outcomes; testnet identifiers treated as public. For impossible live OAuth or token integration, document limitation and use fallback rather than simulation labelled real.

## Audit checklist
For each table feature write Status = NOT IMPLEMENTED / MOCK ONLY / TESTNET VERIFIED / DISABLED; test command, evidence URL, code path, known limitations. AI judge must verify source itself rather than trust prose. No empty or invented green checkmarks.
