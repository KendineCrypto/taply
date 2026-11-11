# Product completion matrix

Updated 2026-11-11. Production `taplyapp.xyz` = `release/taplyapp` = `main`.
States: LIVE · QA VERIFIED · CODE COMPLETE · PARTIAL · DEMO ONLY · BLOCKED · NOT IMPLEMENTED.
"Testnet-verified" below means real NEAR Testnet transactions with disposable automation accounts (see [RELEASE_EVIDENCE_INDEX.md](RELEASE_EVIDENCE_INDEX.md)); it is not an owner physical-wallet acceptance run.

| Area | State | Evidence / gap |
| --- | --- | --- |
| Wallet connect, finalized balance, receive address + QR | LIVE | Production; owner iPhone check |
| Taply native wallet (create/restore/sign) | LIVE on Testnet (no independent security review) | Signs payments, curated swaps and Protected Pay calls, each rebuilt from chain reads and shown in the confirmation dialog |
| Direct NEAR send | LIVE with Taply Wallet | Reviewed in the confirmation dialog; settled from a final chain read |
| G1 request → pay → payout → receipt | LIVE on taplyapp.xyz | Production browser runs 2026-11-09 and 2026-11-11 (NEAR and USDC, also Android Chrome emulation) + 2026-11-01 owner pilot |
| Independent receipt verifier | LIVE · fallback CODE COMPLETE | Whole-proof FastNEAR archival fallback fixes "Could not reach the RPC" (browser-tested locally); needs deploy |
| Merchant register / store QR / POS UI | LIVE (UI) · sale signing OFF | Production |
| Merchant-bound contract (G2, session binding) | QA VERIFIED (Testnet, automation), UNREVIEWED | Real bound sale, comparison code, replay refused, Verified |
| Live two-device Handshake service | LIVE on taplyapp.xyz (coordination only) | Upstash Redis on Vercel; two-browser production run 2026-11-10 |
| Protected Pay contract (G3) | LIVE on Testnet (not audited) | `taply-e2e-ce38a238.testnet`, pinned by code hash, 0 access keys; real refund + real release + 4 refusals; sandbox 3/3 |
| Protected Pay web | LIVE on taplyapp.xyz (2026-11-11) | Two Taply Wallets in a real browser on production: refund and release, share QR, also under Android Chrome emulation ([evidence](evidence/production-protected-pay-2026-11-11/)). Native NEAR; cancel window 1 minute to 1 hour |
| NEP-141 contract path | QA VERIFIED (Testnet, automation), UNREVIEWED | TEST-ONLY token; instant exact deltas, duplicate returned, protected refund; sandbox 4/4 incl. fake token, unregistered recipient |
| NEP-141 web | CODE COMPLETE for Protected requests (flag off) | Asset selector, verified symbols/decimals, ft_transfer_call journal; token Instant UI on the candidate NOT IMPLEMENTED |
| Shared schema v1.1 (`nep141:` assets) | CODE COMPLETE | Backward compatible, native hashes unchanged, CI green |
| Cross-token pay (pay A, receive B) | QA VERIFIED (Testnet automation) for USDC and USDT → NEAR; behind the Instant Pay flag | The merchant creates a normal NEAR request and picks nothing extra; the payer picks NEAR, USDC, USDT, NST, LNC or PEM (curated Ref/Rhea Testnet pools, test tokens with no real value), converts to native NEAR, then pays the unchanged NEAR request. USDC and USDT runs: FINAL_PAID, merchant delta exactly the requested NEAR. NEAR Intents itself has no Testnet. |
| Contacts | LIVE (local) · Protected payer picker CODE COMPLETE | |
| Split Pay | LIVE (preparation; settles via G1 requests) | Group "done" only when every share verified |
| Recurring templates | LIVE (preparation; no auto-charge) | |
| Verified Requests | PARTIAL | Code-hash/contract/terms checks + receipt verifier exist; no dedicated compact indicator yet |
| Social login, sponsored gas | NOT IMPLEMENTED (hard-disabled) | No verified Testnet provider in this sprint |
| Milestone Pay, disputes, NFC | NOT IMPLEMENTED | QR remains the tested path |
| DEMO journey | DEMO ONLY | Labelled synthetic |
