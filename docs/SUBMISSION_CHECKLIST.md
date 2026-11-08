# Submission-readiness checklist

Updated 2026-11-09. Checked boxes are completed engineering facts, not a
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

- [x] Public read-only site live on https://taplyapp.xyz (HTTPS, `www` → apex, English default, Turkish persists).
- [x] Production source = `release/taplyapp`; Vercel builds production only from that branch.
- [x] No "Preview" wording on the public site; signing-off says "Payments not enabled yet" (EN/TR regression test).
- [x] CI fixed on the release head (API tests could not load the Handshake reader); workspace, wallet-browser and contract sandbox workflows run on the exact head. Run IDs in the nightly report.
- [x] Read-only G1 contract preflight 10/10 PASS on 2026-11-09.
- [x] Re-audit of the F-01 wallet-retry fix by Claude Code on 2026-11-09 (nightly report §3). This is an AI code review, not a human or external security review.
- [x] Production browser smoke; browsers, viewports and counts in the nightly report.
- [x] README, judge guide, release readiness, evidence ledger and demo plan updated for 2026-11-09.

## Open (disclose, do not hide)

- [ ] **Fresh owner-signed G1 acceptance** on the protected QA build before public signing ([plan](TESTNET_ACCEPTANCE_PLAN.md)).
- [ ] Physical-device wallet decline / return check on that build. Android untested.
- [ ] F-02 (`main` has no branch protection), F-03 (CI path coverage), F-06 (production auth for G2) remain open. F-04 has no production impact (`pnpm audit --prod` clean). F-05 fixed.
- [ ] Keep G2 Handshake, Protected Pay, merchant signing, production auth and native signing disabled.

## Owner actions

- [ ] Record or confirm the 60-second video; check it against "What is real today" in the submission package.
- [ ] Publish the X post (+ reply) and check it logged-out.
- [ ] Fill the form privately (name, email, team size, mainnet prize account) and submit once.
- [ ] Keep taplyapp.xyz up through 2026-11-18 (ideally 2026-11-25).
