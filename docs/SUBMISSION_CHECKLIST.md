# Final submission-readiness checklist

Updated 2026-11-06 on branch `feature/final-integration-review`. Checked boxes
are preparation, not release approval. Nothing here has been merged, tagged,
deployed, signed, paid, posted or submitted. Related:
[release readiness](RELEASE_READINESS.md), [final safety review](FINAL_INTEGRATION_REVIEW.md),
[demo, screenshots and X post](RELEASE_DEMO.md), [judge guide](JUDGE_QUICK_START.md).

## Official requirements (re-read 2026-11-06)

Source: [nearhackathon.com/HACKATHON.md](https://nearhackathon.com/HACKATHON.md).
Recheck on submission day. All times UTC.

| Requirement | Rule | Taply status |
| --- | --- | --- |
| Deadline | Development ends and submissions close **2026-11-14 23:59 UTC**; judging from 2026-11-16 | Open |
| Public repository | Public before the deadline and through judging (Q-014) | Public (checked 2026-11-05); recheck |
| LICENSE file | "Any. MIT is fine. Repo stays public through judging; add a LICENSE file." (Q-014) | **Added 2026-11-08 on feature/monday-testnet-sprint: MIT, (c) 2026 KendineCrypto_, brand excluded (NOTICE)** |
| Eligible history | Code from 2026-10-19 counts (Q-001); dedicated branch or tags plus a README section linking the diff (Q-003) | Repository starts 2026-10-29; judged branch + compare link in README |
| AI / library disclosure | Allowed; list in README (Q-005) | README "How it was built" |
| Testnet | Testnet-only projects are eligible for all tracks (Q-010) | NEAR Testnet only |
| Demo post | Public X post saying it was built at NEAR HACKATHON, tagging @NEARProtocol and #NEARHackathon, with video or screenshots attached | Draft in [RELEASE_DEMO.md](RELEASE_DEMO.md) |
| Local-only demo | "public repo, reproducible README, X post with a video; screenshots are not enough when judges cannot open the demo." (Q-012) | No hosted demo, so **a video is required** |
| Projects per person | At most two, independent, each README names the other (Q-015) | Confirm |
| Editing | No direct edits or resubmission (409); use [request changes](https://nearhackathon.com/request-changes) | — |
| Screening | Claude Code and Codex screen for reproducibility; humans decide (Q-017) | README 5-minute judge path |

## Engineering — done

- [x] F-01 wallet-retry fix (`9db43fb`, `24cf04a`): every uncertain wallet outcome, including a reported decline, stays blocking; legacy journal entries stay blocking after reload; only Taply's own pre-wallet checks are nonblocking; a declined sale creation unblocks only after a verified final read past its expiry.
- [x] `pnpm check` exit 0: 1,226 workspace tests passed, 1 opt-in live skip; focused wallet/payment suites 382 passed.
- [x] G1 isolation check passed; approved pins unchanged (SHA-256 `a13d932f…`, code hash `BrR6bioU…`, 345541 bytes). No contract, package, workflow, API, flag, env-example or lockfile change since the reviewed baseline.
- [x] Final-build screenshots reviewed one by one; every synthetic payment screen shows DEMO; loopback share-link captures excluded; no PNG metadata.
- [x] Gitleaks on the new commits and changed files: no leaks.

## Engineering — open (disclose, do not hide)

- [ ] Normal PR CI on the final commit: workspace, wallet/browser and G1/G2 sandbox jobs actually ran and passed (skipped is not passed).
- [ ] Independent security review of the F-01 fix and the cumulative branch.
- [ ] Physical iPhone acceptance ([procedure](PHASE_7H_INTEGRATION_REPORT.md#exact-physical-iphone-acceptance-test-not-executed)), including that a wallet decline shows "Result unknown" and offers no repeat payment. Android untested.
- [ ] Known UX limit after F-01: a declined payment can be retried only after the request is funded, cancelled or expired (default 15 min); a declined cancel or payout retry stays blocked on that device.
- [ ] Review findings F-02 (main unprotected), F-03 (CI path coverage), F-04 (moderate dev-dependency advisory), F-05 (Handshake reader body limits), F-06 (production auth) remain open.
- [ ] Keep G2, Handshake, Protected Pay, production auth and native signing disabled.

## Owner decisions before publishing

- [ ] **License:** approve MIT ([recommendation](LICENSE_RECOMMENDATION.md)) or another, the copyright holder(s) and year, and brand-asset treatment; then add `LICENSE` in a reviewed commit.
- [ ] **Judged ref:** the Draft PR branch, or merge to `main` after review. Record the exact commit in the submission.
- [ ] **Video:** record the 60-second plan in [RELEASE_DEMO.md](RELEASE_DEMO.md) with DEMO and historical captions.
- [ ] **X post:** edit and publish the draft with the video attached; check it logged-out.
- [ ] **Hosting (optional):** only with read-only flags, HTTPS and a real smoke test; keep up through 2026-11-18, ideally 2026-11-25.

## Submission form — human only

Collect real values privately; never commit them.

- [ ] `projectName` 2–80 chars; `leadName` 2–80 chars.
- [ ] `email` valid, ≤160 chars, at most 2 submissions per email.
- [ ] `size` exactly `1`, `2 - 4`, `4 - 6`, `6 - 8` or `8+`.
- [ ] `tracks` from `defi`, `thesis`, `privacy`, `business`, `swarms`, `security`, `agents`, `realworld`, `games`, `nfts`, `memecoins`, `social`, `open`; recommend `realworld`.
- [ ] `nearAddress` lowercase **mainnet** prize account, 2–64 chars (unrelated to the Testnet app; the human provides it).
- [ ] `projectUrl` public repository URL, ≤300 chars, submitted once.
- [ ] `demoUrl` public X post URL, ≤300 chars, with the video attached.
- [ ] `idea` 20–2000 chars (draft below).
- [ ] `consent` true only after reading verbatim: “I agree that the organizers may use these details to review our submission and contact us about this hackathon.”
- [ ] `requestId` UUID generated once and reused on retries. No other fields; never fill `website`.
- [ ] Save the confirmation. On 409 do not resubmit; corrections go through request changes.

## Idea text — draft (599 characters)

Taply helps merchants and customers distinguish a submitted crypto payment from
a verified recipient payout. Its NEAR Testnet Instant Pay flow uses unique sale
requests, explicit external-wallet approval and independent funding, transfer
and callback receipt verification. The repository contains a recorded real
Testnet payment and a no-funds demo. Any uncertain wallet outcome, including a
reported decline, blocks a repeat payment until the chain explains it. G1
remains conditional pending physical iPhone acceptance and human release
review. Live G2 Handshake and Protected Pay remain disabled.
