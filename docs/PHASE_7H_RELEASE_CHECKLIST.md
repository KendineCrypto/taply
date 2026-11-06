# Phase 7H release and submission checklist

Prepared 2026-11-06 on `feature/phase7h-release` (local only). Every box below
is either something an agent verified (marked **verified**, with the command or
file) or a **human decision / human action**. Nothing here has been pushed,
merged, tagged, deployed, posted or submitted.

Deadline: development and submission end **2026-11-14 23:59 UTC**
(`HACKATHON.md`, re-read the live copy at https://nearhackathon.com/HACKATHON.md
on submission day; rules may change). Judging starts 2026-11-16. One
submission per project, and it cannot be edited.

## A. Code and build (agent-verifiable, re-run on the final commit)

- [x] **verified** Base commit `f3d15ac` matched `origin/feature/phase7g-integration`.
- [x] **verified** `pnpm install --frozen-lockfile` leaves no tracked change.
- [x] **verified** `pnpm check` exit 0 (results in `PHASE_7H_RELEASE_REPORT.md`).
- [x] **verified** `pnpm --filter @taply/web exec next build --webpack` exit 0.
- [ ] **human** Re-run both on the exact commit that will be tagged, on a clean
      clone, and paste the totals into the report.
- [ ] **human / Codex** Rust checks on a machine with Rust 1.95.0 +
      `wasm32-unknown-unknown` (still BLOCKED on this Windows machine; commands in
      `docs/PHASE_7G_INTEGRATION_REPORT.md` "Exact next steps" 1). At minimum:
      `cargo test --locked --lib` and the default-build SHA-256 equal to the
      approved `a13d932f…` / code hash `BrR6bioU…`.

## B. Safety gates that must stay as they are for submission

- [x] **verified** Feature defaults (`apps/web/src/lib/flags/features.ts`):
      Instant Pay signing, Merchant, Handshake, Protected Pay OFF;
      social login, milestone, sponsored gas hard-disabled (no env override).
- [x] **verified** `.env.example` unchanged; `.env.local` is git-ignored
      (`apps/web/.gitignore`) and not tracked (`git ls-files`).
- [x] **verified** No private keys or tokens in tracked files (pattern scan in
      the report; the only 88-character `ed25519:` strings are transaction and
      block **signatures** in recorded Testnet fixtures).
- [x] **verified** Live Handshake is not reachable: no route imports the room
      reader/reducer (source-scan test `room-reducer-parity.test.ts`); the
      Handshake flag is off; `/demo/handshake` is DEMO-stamped.
- [x] **verified** No false Verified Paid in pruned-history, RPC-down, slow-RPC
      and receipt-read-failure runs (browser QA, report section 5).
- [ ] **human** Do not enable `NEXT_PUBLIC_TAPLY_FLAG_HANDSHAKE`,
      `..._MERCHANT` or `..._PROTECTED_PAY` on any public deployment.
- [ ] **human** Decide whether a public demo enables
      `NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY=on` (see the deployment plan in the
      report, section 8). Default recommendation: **off** on the public URL,
      **on** only on the operator's recording build.

## C. LICENSE (Q-014: any license, add a LICENSE file)

- [ ] **human decision** Choose a license. Recommendation for approval:
      **MIT** (short, permissive, named as fine in Q-014, matches the npm
      ecosystem). Choose **Apache-2.0** instead if an explicit patent grant
      matters. Note: brand assets in `brand/` may need a separate notice if the
      owner does not want the logo covered by the code license.
- [ ] **human / agent after decision** Add `LICENSE` at the repository root with
      the owner's name and year 2026; add `"license"` to the root
      `package.json` only if the owner wants it (root manifest is lead-owned).

## D. Branch and tag judges will review (Q-003)

`main` is at `86bd54b` and does **not** contain Phases 4–7H. The README tells
judges to check out the reviewed branch or tag.

- [ ] **human** Review `feature/phase7h-release` (this branch, on top of
      `feature/phase7g-integration` @ `f3d15ac`).
- [ ] **human** Push it and open a PR toward the integration line, then into
      `main` (only the human pushes; `HACKATHON.md` "Never without the human's
      explicit confirmation").
- [ ] **human** After merge, tag the exact judged commit, e.g.
      `git tag -a hackathon-submission -m "NEAR HACKATHON submission"` and push
      the tag. All commits are inside the eligible window (repository starts
      `db10264`, 2026-10-29; window opens 2026-10-19, Q-001), so no
      `pre-hackathon` baseline tag is required; say so in the README.
- [ ] **human** Replace `<reviewed submission branch or tag>` in the README
      Quick start with the real tag name, in the same commit or a follow-up.
- [ ] **human** Repository stays public through judging (checked public
      2026-11-05).

## E. Public demo (Q-012: hosted demo is a plus; keep it up to 2026-11-18, ideally 2026-11-25)

- [ ] **human decision** Host or not. A local-only demo is allowed if the README
      is reproducible and the X post has a video.
- [ ] **human** If hosting, follow report section 8 exactly: HTTPS origin,
      build-time env, flags, RPC choice, smoke test, take-down date.
- [ ] **human** Put the URL at the top of the README only after the smoke test
      passes on two phones.
- [ ] **human** Keep the deployment up until at least 2026-11-18 23:59 UTC.

## F. Demo video and X post (required)

- [ ] **human** Record the 60-second film from report section 9 (script and
      exact shot list). Every on-screen claim must match the "What is real"
      table; Handshake only with the DEMO stamp visible, or not at all.
- [ ] **human** Approve one fresh Testnet sale for the recording (two external
      Testnet wallets, about 0.01–0.1 Testnet NEAR). New transaction hashes come
      from the app's receipt **Technical proof**, never typed by hand.
- [ ] **human** Optionally append the new funding/receipt hashes to
      `docs/EVIDENCE.md` with the verifier JSON.
- [ ] **human** Write and publish the X post yourself: says it was built at NEAR
      HACKATHON, attaches the video, tags @NEARProtocol and #NEARHackathon
      (`HACKATHON.md` step 2 and DEMO_AND_JUDGING). Keep the post link.

## G. Submission (one attempt; only the human sends it)

Collect, never guess (`HACKATHON.md` "What the human decides"):

- [ ] Project name (2–80 chars)
- [ ] Team lead's name (2–80 chars)
- [ ] Contact email (≤160 chars)
- [ ] Team size: `1`, `2 - 4`, `4 - 6`, `6 - 8` or `8+` exactly
- [ ] Tracks: best fit **`realworld`** (merchant payments); add others only if
      they genuinely fit
- [ ] Mainnet NEAR payout account (created by the team; never by an agent)
- [ ] `projectUrl`: public repository URL (each repository once)
- [ ] `demoUrl`: the public X post URL
- [ ] `idea`: 20–2000 chars. Draft in report section 10; human edits
- [ ] Consent read verbatim: "I agree that the organizers may use these details
      to review our submission and contact us about this hackathon."
- [ ] If the lead submits a second, independent project, both READMEs name the
      other (Q-015)
- [ ] Generate `requestId` once (`node -e 'console.log(crypto.randomUUID())'`);
      reuse it on a retry after a network error or 503
- [ ] Print the full JSON payload, get an explicit yes, then POST to
      `https://nearhackathon.com/api/applications` (or use the form). Never add
      a `website` field. Do not commit the payload (personal data)
- [ ] 201 = saved. 409 = already submitted; do not change URL or email to get
      around it. Mistakes go through https://nearhackathon.com/request-changes

## H. Final README pass (on the tagged commit)

- [ ] Above the fold: what works, Testnet contract, proof links, what is
      disabled, and the hosted URL (if any).
- [ ] Every "Testnet verified" row links to `docs/EVIDENCE.md`.
- [ ] Screenshot links resolve (`apps/web/docs/screenshots/phase7h/`).
- [ ] No claim that G2 / live Handshake / Protected Pay is live, audited or
      production-ready.
