# Taply v0.4 14-day parallel implementation and release gates

**Do not trade away correctness for breadth.** Nov 1–14 2026 remains the main delivery schedule, but official `HACKATHON.md` Q-001 permits eligible code from **19 Oct 2026**; it does not impose a November 1 coding embargo. Backend/Protocol Phase 0 is authorized now. Each implementation slice closes with a local branch commit and actual test evidence; publication remains subject to lead approval.

| Day | Claude-owned UI | Codex-owned chain/API | Lead acceptance |
|---|---|---|---|
| 1 | Brand assets, PWA shell, typed mock screens | Choose pinned NEAR Rust SDK, contract escrow ADRs | freeze shared schemas & contract API |
| 2 | Wallet / connect/send/receive | Native Testnet request create/read/cancel | unit tests with mock chain |
| 3 | Pay link + QR + review/decline | Native pay state machine + async payout callback | amount/recipient/expiry tests |
| 4 | Chain state views + receipt components | Integration Testnet deploy and actual payout | **G1 real Instant Pay tx** |
| 5 | Merchant QR / customer join | Merchant account binding + unique checkout intent | static QR not paid QR |
| 6 | Handshake dual-screen UI + compare code | Authenticated session service/SSE + secure nonce | **G2 live two-device Handshake** |
| 7 | Protected consent + locked/NOT PAID | Escrow fund/cancel cutoff rules, balance conservation | approve contract security model |
| 8 | Cancel / release / retry UX | Promise callbacks, recoverable failure tests | **G3 Protected refund on Testnet** |
| 9 | Verified paid/refunded receipts | Final payout proof and Testnet release | **G3b release and proof** |
| 10 | Full checkout E2E UX and error states | Race/adversarial tests, chain watcher, idempotent retry | zero false-paid / replays |
| 11 | Contacts and Split Pay (only if gates pass) | token standard or optional feature P1 | G4 core regression |
| 12 | Social login if genuinely Testnet-compatible; else wallet fallback polish | fee sponsor feasibility and limits; recurring templates as time allows | security review and feature freeze |
| 13 | iPhone/Android mobile polish, accessibility | reproducible deployment scripts, e2e smoke | fresh device test |
| 14 | 60s accurate demo, screenshots | CI, tx proof, README, issue known gaps | public repo/X and submission |

## Stage priorities
G1: actual native NEAR wallet -> request -> signed on-chain settlement -> verified FINAL_PAID; **mandatory**.
G2: unique merchant QR checkout + two live client views; **mandatory**.
G3: funded escrow -> actual cancelled refund AND separately release -> actual paid on Testnet; **stretch requiring stringent security review; cannot call completed until both pass**.
G4: chain proof/receipt + robust adversarial and UX; **mandatory**.
G5: Invisible Wallet & sponsor gas if provably Testnet usable; Contacts, Split Pay, NEP-141, Recurring optional; Milestone Pay/proximity future.

## Scope cut rule
If G1 delayed, stop all other features. If G3 unsafe or unverified, disable Protected Pay in UI and demo, ship Handshake + Instant with honest documentation. Milestone Pay is never shipped as escrow simply by adding another label. Require security review before deployment.
