# Product completion matrix

Updated 2026-11-09 (cloud session, branch `claude/kind-cerf-c4n261`).
"Prod" = https://taplyapp.xyz (`release/taplyapp` @ `b67b278`, docs-only `22765d7` on main).
Evidence levels (freeze proof hierarchy): docs/mock < unit tests < sandbox < live Testnet < reproducible E2E.

| Area | Code state | Highest evidence | Prod | Blocking gate |
| --- | --- | --- | --- | --- |
| Wallet connect, balance, receive QR | Done | Live (owner iPhone 2026-11-09) | On (read-only) | — |
| G1 request creation + Instant Pay + receipt verifier | Done | Live Testnet 2026-11-01 (`CrzQ57Jx…`) | Signing **off** | Fresh owner-signed acceptance on QA build |
| Merchant register / store QR / POS UI | Done (UI) | Unit + browser QA | UI on, sale signing off | G1 signing + G2 |
| Live Handshake (two phones) | Service + UI exist; demo synthetic | Unit tests, DEMO | Off | G2: F-06 production auth, merchant contract candidate review |
| Merchant-bound contract (`contracts/payments-merchant`) | Candidate | Unit + sandbox in CI | Not deployed | Lead review |
| **Protected Pay contract** (`contracts/payments-protected`) | **Candidate (this session)** | **24 unit tests; all 8 Protected states parse with the frozen shared schema** | Not deployed | Human escrow review, sandbox measurement, live refund + release |
| **Protected Pay near-client builders + reader** | **Candidate (this session)** | 9 unit tests on real contract outputs | Not used by prod | Same as above |
| **Protected Pay web flow** (`/protected/new`, `/protected/[id]`) | **Done behind flag (this session)**: consent, LOCKED-NOT-PAID, countdown, cancel/release/retry, journal + wallet-return | 27 component/logic tests | Off (`security_gate`; no contract configured) | Same as above + a QA build with a fresh Testnet deployment |
| NEP-141 tokens | Not implemented; [change request](NEP141_CHANGE_REQUEST.md) written | Docs only | Off | Lead approval of shared asset schema, then contract + sandbox fake-token tests |
| Contacts | Done, local-only | Unit tests | On | — |
| Split Pay | Preparation tool (one request per share) | Unit tests | On | Needs G1 signing to settle |
| Recurring templates | Preparation tool, no auto-charge | Unit tests | On | — |
| Taply-native wallet, social login, sponsored gas | Disabled | — | Off (hard) | Separate security gates |
| Milestone Pay | Disabled | — | Off (hard) | No reviewed dispute model |

Update this table in the same commit as any change of state.
