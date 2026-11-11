# Submission-readiness checklist

Updated 2026-11-10. Checked boxes are completed engineering facts, not a
submission. Nothing has been posted or submitted. Related:
[submission package](HACKATHON_SUBMISSION_PACKAGE.md),
[nightly release report](NIGHTLY_RELEASE_REPORT_2026-11-09.md),
[demo plan](RELEASE_DEMO.md), [judge guide](JUDGE_QUICK_START.md).
History: the 2026-11-06 version of this file is in Git.

## Official requirements (re-read 2026-11-09)

| Requirement | Rule | Taply status |
| --- | --- | --- |
| Deadline | 2026-11-14 23:59 UTC; judging from 2026-11-16 | Open |
| Public repository | Public through judging (Q-014) | Public (checked 2026-11-09) |
| LICENSE file | Any license; add a LICENSE file (Q-014) | **Done**: MIT, (c) 2026 KendineCrypto_; brand excluded in NOTICE |
| Eligible history | Code from 2026-10-19 counts; README section linking the diff (Q-001, Q-003) | Repository starts 2026-10-29; README "Hackathon" section |
| AI / library disclosure | List in README (Q-005) | README "How it was built" |
| Testnet | Eligible for all tracks (Q-010) | NEAR Testnet only |
| Demo | Public repo + reproducible README + X post with video; a hosted demo is a plus (Q-012) | **Hosted**: https://taplyapp.xyz; video still to attach |
| X post | Says built at NEAR HACKATHON, tags @NEARProtocol and #NEARHackathon, video or screenshots | Draft ready, not posted |
| Projects per person | Max two, READMEs name each other (Q-015) | Owner to confirm |

## Engineering — done

- [x] Public site live on https://taplyapp.xyz (HTTPS, `www` → apex, English default, Turkish persists), NEAR Testnet with **payments on** (owner decision).
- [x] Production source = `release/taplyapp` (fast-forwarded from `main`); Vercel builds production only from that branch.
- [x] Onboarding: external wallet or `username.testnet` Taply Wallet with a 12-word phrase; proven on production 2026-11-09.
- [x] Real browser payments on production: NEAR and test USDC, and a request created in the app and paid from a second browser, all `FINAL_PAID` (2026-11-09).
- [x] Pay a NEAR request with USDC / USDT / NST / LNC / PEM via Ref/Rhea Testnet.
- [x] Live Handshake on production with Upstash Redis; two-browser run 2026-11-10 (joined, disconnect/reconnect, third phone refused, `FINAL_PAID`).
- [x] Taply Wallet stays unlocked until **Lock now** (max 30 days); balance refreshes after payments (2026-11-10).
- [x] Read-only G1 contract preflight 10/10 PASS on 2026-11-09.
- [x] README, judge guide, submission package and screenshots updated for 2026-11-10.
- [x] 2026-11-11, on the current production build: Protected Pay refund and release (PR #27), 14/14 escrow attacks refused on the live contract, handshake + NEAR/USDC pay + QR scan + live **Verified Paid** + second payment refused ([regression](evidence/production-regression-2026-11-11/)).
- [x] 2026-11-11: contradictory docs fixed (contract READMEs, RELEASE_DEMO, archival notices on dated reports); [VERIFICATION_MATRIX.md](VERIFICATION_MATRIX.md) added; CI now runs the real-Redis tests and also runs on docs changes.

## Open (disclose, do not hide)

- [ ] Taply Wallet has no independent security review (on for Testnet by owner decision; disclosed in README).
- [ ] The owner tested all flows by hand on 2026-11-10 (reported as passing); an external browser-wallet (Meteor) payment is not yet stored as evidence. Android untested on a physical device.
- [ ] F-02 (`main` has no branch protection; owner setting), F-03 (CI path coverage: docs and README now trigger `workspace-check`; contract workflows still run only on contract paths or by hand), F-06 (production auth for the `apps/api` room service) remain open. F-04 has no production impact (`pnpm audit --prod` clean). F-05 fixed.
- [ ] Keep contract-bound merchant sessions, merchant sale signing and sponsored gas off. Protected Pay is on for Testnet since 2026-11-11 (owner decision; escrow contract not audited).

## Owner actions

- [ ] Record or confirm the 60-second video; check it against "What is live today" in the submission package.
- [ ] Publish the X post (+ reply) and check it logged-out.
- [ ] Fill the form privately (name, email, team size, mainnet prize account) and submit once.
- [ ] Keep taplyapp.xyz up through 2026-11-18 (ideally 2026-11-25).
