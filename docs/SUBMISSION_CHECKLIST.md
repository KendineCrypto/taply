# Phase 7I submission checklist

Prepared 2026-11-06. [Release verdict and CI](RELEASE_READINESS.md).
Checked boxes below describe preparation only, not release approval.

## Completed preparation

- [x] Exact requested base verified; isolated `feature/release-candidate` worktree created.
- [x] README claims audited; no-funds [judge guide](JUDGE_QUICK_START.md) prepared.
- [x] [60-second shot list and X draft](RELEASE_DEMO.md) prepared, not published.
- [x] Local software checks and normal contract CI evidence recorded.
- [x] PR stack and remote CI inspected read-only.
- [x] Current official rules retrieved on 2026-11-06; MIT recommended, no LICENSE added.

## Engineering and review before an accepted release

- [x] F-01 wallet-retry fix committed locally (`9db43fb`, `24cf04a`); `pnpm check` exit 0, 1,226 workspace tests passed, 1 opt-in skip.
- [ ] Independent review of the F-01 fix, plus a real-device check that a wallet decline shows "Result unknown" and offers no repeat payment.
- [x] Final-build screenshots captured offline in `apps/web/docs/screenshots/final/` (DEMO/synthetic states only).

- [ ] Review the exact documentation commit and all inherited implementation.
- [x] Normal G1 CI reproduces the unchanged approved WASM hash and size.
- [x] Normal G1/G2 candidate Rust, WASM, Clippy/fmt, sandbox and wire-schema CI passed; exact run and artifact references recorded in release readiness.
- [x] Separate candidate CI built its artifact and passed offline preflight; this is not deployment approval.
- [ ] Arrange independent security review; keep G2, production auth, merchant candidate and escrow disabled.
- [ ] Complete the [physical iPhone acceptance procedure](PHASE_7H_INTEGRATION_REPORT.md#exact-physical-iphone-acceptance-test-not-executed), including separate approval before any fresh Testnet payment.
- [ ] Record model/iOS/Safari/wallet versions, commit, redirect/reload/reopen behavior and independent recipient proof. Android remains untested.
- [ ] Decide whether only the conditional read-only candidate is presented while gates remain open; never relabel it fully accepted.
- [ ] Re-run frozen install, workspace, standalone API/verifier and artifact checks on the final reviewed commit. Preserve failures and intentional skips.
- [ ] Review CI path coverage and branch protection; rerun required checks on the final combined tree, including isolation.
- [ ] Review the proposed stack integration sequence before any push, merge or tag.

## License and public materials — owner decisions

- [ ] Approve [MIT recommendation and attribution review](LICENSE_RECOMMENDATION.md) or another license, exact copyright holder(s), year and brand-asset treatment.
- [ ] After approval, add LICENSE and review third-party dependency/font/asset notices; MIT for original code does not replace third-party licenses.
- [ ] Choose the exact judged branch or tag; publish only after approval and add an immutable README link plus eligible-history/diff reference.
- [ ] Confirm repository is public and stays public through judging.
- [ ] Record video with synthetic/historical disclosures; human edits and publishes the X post with @NEARProtocol and #NEARHackathon.
- [ ] Verify the public X URL and attached video without login. Local-only demos require a video under Q-012.
- [ ] Optional hosting decision: HTTPS, read-only flags, wallet-compatible headers, no credentials in browser config, actual smoke test. If hosted, keep available through Nov 18, ideally Nov 25.
- [ ] Recheck public evidence/screenshot links from the final judged ref; no local paths, credentials or private hostnames in media.

## Submission — human only, nothing sent here

Live [official instructions](https://nearhackathon.com/HACKATHON.md) checked
2026-11-06: deadline **2026-11-14 23:59 UTC**. Recheck on submission day.
Testnet-only eligibility is Q-010; Q-014 requires a LICENSE file and permits MIT.
A saved submission cannot be edited directly; organizer-reviewed changes use
[request changes](https://nearhackathon.com/request-changes).

Collect the human's real values privately; never commit personal-data payloads:

- [ ] `projectName`: 2–80 characters; `leadName`: 2–80 characters.
- [ ] `email`: valid, at most 160 characters; confirm this project was not already submitted.
- [ ] `size`: exactly `1`, `2 - 4`, `4 - 6`, `6 - 8` or `8+`.
- [ ] `tracks`: valid unique IDs; recommend `realworld`, human confirms.
- [ ] `nearAddress`: human-provided valid mainnet prize account, 2–64 characters. It is unrelated to the Testnet app; do not create it for them.
- [ ] `projectUrl`: public repository, at most 300 characters, submitted once.
- [ ] `demoUrl`: public X demo post URL, at most 300 characters.
- [ ] `idea`: 20–2000 characters; human confirms shipped scope, NEAR's role and limitations.
- [ ] If another independent project is submitted by this lead, both READMEs disclose it (Q-015; at most two projects/person).
- [ ] Read and obtain consent verbatim: “I agree that the organizers may use these details to review our submission and contact us about this hackathon.”
- [ ] Generate `requestId` once for the approved submission and retain it for retries.
- [ ] Validate exactly eleven fields in total, including `requestId` and `consent`; payload at most 12,000 bytes, no extra `website` field.
- [ ] Show the complete payload privately for explicit final approval. Human submits via form or a separately authorized API action.
- [ ] Save the 201 confirmation. On 409 do not evade uniqueness; on 403 stop; on uncertain network/503 reuse the same requestId. Corrections go to the organizer change-request process.

## Suggested idea text — draft, not a submission

Taply helps merchants and customers distinguish a submitted crypto payment from
a verified recipient payout. Its NEAR Testnet Instant Pay flow uses unique sale
requests, explicit external-wallet approval and independent funding, transfer
and callback receipt verification. The repository contains a recorded real
Testnet payment and a no-funds demo. Any uncertain wallet outcome, including a
reported decline, blocks a repeat payment until the chain explains it. G1
remains conditional pending physical iPhone acceptance and human release
review. Live G2 Handshake and Protected Pay remain disabled.
