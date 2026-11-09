# Product completion matrix

Updated 2026-11-09 (branch `claude/kind-cerf-c4n261`). Production `taplyapp.xyz` = `release/taplyapp` @ `22765d7` (unchanged).
States: LIVE · QA VERIFIED · CODE COMPLETE · PARTIAL · DEMO ONLY · BLOCKED · NOT IMPLEMENTED.
"Testnet-verified" below means real NEAR Testnet transactions with disposable automation accounts (see [RELEASE_EVIDENCE_INDEX.md](RELEASE_EVIDENCE_INDEX.md)); it is not an owner physical-wallet acceptance run.

| Area | State | Evidence / gap |
| --- | --- | --- |
| Wallet connect, finalized balance, receive address + QR | LIVE | Production; owner iPhone check |
| Taply native wallet (create/restore/sign) | PARTIAL (disabled) | Code exists; signing kept off, not re-audited this sprint |
| Direct NEAR send | PARTIAL (disabled) | Review flow exists; public signing off |
| G1 request → pay → payout → receipt | QA VERIFIED (Testnet, automation) · signing OFF in prod | Fresh proof 2026-11-09 (Verified on 2 providers) + 2026-11-01 owner pilot; owner wallet acceptance BLOCKED (owner-only) |
| Independent receipt verifier | LIVE · fallback CODE COMPLETE | Whole-proof FastNEAR archival fallback fixes "Could not reach the RPC" (browser-tested locally); needs deploy |
| Merchant register / store QR / POS UI | LIVE (UI) · sale signing OFF | Production |
| Merchant-bound contract (G2, session binding) | QA VERIFIED (Testnet, automation), UNREVIEWED | Real bound sale, comparison code, replay refused, Verified |
| Live two-device Handshake service | BLOCKED | `apps/api` is encrypted-SQLite, no listener; needs a host with persistent storage + F-06 auth review. Vercel serverless cannot host it durably |
| Protected Pay contract (G3) | QA VERIFIED (Testnet, automation), UNREVIEWED | Real refund + real release + 4 refusals; sandbox 3/3; locked accounts |
| Protected Pay web | CODE COMPLETE (flag off) · local QA against live Testnet contract | Consent, LOCKED-NOT-PAID, countdown, cancel/release/retry, journal, error states; needs human escrow review + QA deployment |
| NEP-141 contract path | QA VERIFIED (Testnet, automation), UNREVIEWED | TEST-ONLY token; instant exact deltas, duplicate returned, protected refund; sandbox 4/4 incl. fake token, unregistered recipient |
| NEP-141 web | CODE COMPLETE for Protected requests (flag off) | Asset selector, verified symbols/decimals, ft_transfer_call journal; token Instant UI on the candidate NOT IMPLEMENTED |
| Shared schema v1.1 (`nep141:` assets) | CODE COMPLETE | Backward compatible, native hashes unchanged, CI green |
| Cross-token pay (pay A, receive B) | NOT IMPLEMENTED | No verified Testnet swap/intents route; no fake rates shipped |
| Contacts | LIVE (local) · Protected payer picker CODE COMPLETE | |
| Split Pay | LIVE (preparation; settles via G1 requests) | Group "done" only when every share verified |
| Recurring templates | LIVE (preparation; no auto-charge) | |
| Verified Requests | PARTIAL | Code-hash/contract/terms checks + receipt verifier exist; no dedicated compact indicator yet |
| Social login, sponsored gas | NOT IMPLEMENTED (hard-disabled) | No verified Testnet provider in this sprint |
| Milestone Pay, disputes, NFC | NOT IMPLEMENTED | QR remains the tested path |
| DEMO journey | DEMO ONLY | Labelled synthetic |
