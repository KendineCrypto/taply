# Phase 7H final integration and release validation

2026-11-06, connected Windows host **DESKTOP-SDAI72B**. No cloud environment.

**G1 Testnet MVP: ready for code review and a read-only judge demonstration;
conditional release candidate for fresh wallet payments.** The existing pilot
payment was independently reverified through archival RPC in this run. Physical
iPhone acceptance and the blocked contract checks below remain outstanding.
**Real G2 Handshake: NO-GO.** This is not production, audit, escrow or Mainnet
acceptance. No deployment, live signing, transaction or funds movement occurred.

## Repository and final candidate

| Item | Observed value |
| --- | --- |
| Origin | `https://github.com/KendineCrypto/taply.git` |
| New worktree | `C:\taply-phase7h-integration` |
| New branch | `feature/phase7h-integration` |
| Exact base | `f3d15acd73faf35b7ff255ffbac6e7d48307b162` (`feature/phase7g-integration`) |
| Core source | `3f0de0d7d7d3497bf150fc437117078c99b0cfe8` (`feature/phase7h-core`) |
| Release source | `13b512d52da0da43727b9233cdca1ec198aa9492` (`feature/phase7h-release`) |
| Core full-history merge | `31e24f5287baa51984e208cf01acef1a790b99a0` |
| Release full-history merge | `c633915ee013ec0a4d02c93cebe2e1ec7de4e151` |
| Final tested implementation SHA | **`d99224bbf02bf749f73d7bb560becc662cd7f911`** |
| Final report-bearing SHA | `git rev-parse feature/phase7h-integration` after the documentation-only commit containing this report; exact resulting SHA is supplied in the final handoff |

Both source SHAs were locally available and descendants of the exact base;
no fetch was needed. Both merges used `--no-ff`, without conflicts or squashing.
A blob-by-blob audit of the merge commit found **all 11 core-changed files and
all 56 release-changed files preserved exactly**, with no omissions. The only
subsequent implementation changes are the four verifier/test files described
below. The report commit changes documentation only, so its implementation tree
is identical to the tested SHA above.

Original source worktrees remained clean and at their supplied SHAs. No existing
branch, `main`, integration source, release branch, tag or remote ref was changed.
This integration is **local only**; no push, GitHub merge or release was performed.

## Web verifier handoff completed

`apps/web/src/lib/verify/rpc.ts` now reads bounded HTTP error bodies for both
the receipt verifier and funding locator, on HTTP 400/404/408/422/500. Before
classifying an error it requires a non-array JSON-RPC 2.0 envelope, the exact
request ID, exclusive result/error fields, an integer numeric error code and a
valid cause shape. Non-2xx result payloads are never accepted as proof.

- Explicit `UNKNOWN_BLOCK`, `GARBAGE_COLLECTED_BLOCK` or `UNKNOWN_CHUNK` maps to
  `UNKNOWN_BLOCK`, then `HISTORY_UNAVAILABLE` in receipt verification. This means
  the configured provider lacks the history; it does not prove payment failure.
- Generic HTTP 408 or `TIMEOUT_ERROR` remains `RPC_UNAVAILABLE`, transient and
  uncertain. A timeout does not establish pruning. Unknown transactions remain
  distinct; malformed/replayed HTTP error envelopes cannot claim missing history.
- Credentials/cache/redirect restrictions, streaming byte limits, UTF-8 checks,
  abort/body timeout handling and separate read-only method allowlists remain.
  No automatic archival fallback or financial retry was introduced.
- Independent settlement logic in `instant-receipt.ts` is unchanged. Funding,
  recipient/amount, transfer/callback graph, code hash, access keys and finality
  must still all verify before the app returns Verified Paid.
- Updated two older tests that intentionally documented the missing handoff.
  Added **68 web regressions** for both transports: explicit history errors,
  generic timeouts, wrong ID/version, mixed result/error, malformed numeric codes
  and causes, non-JSON bodies, resource bounds, malicious funding candidate
  hashes, wrong transfer recipient, and recovery that rereads the complete proof.

This closes the explicit structured-error gap recorded in the source core/release
reports. Their earlier handoff/open-item descriptions are historical. The
timeout-only old-receipt case remains uncertain by design, not an unfixed claim
that can safely be converted to missing history.

## Actual validation

Node **24.22.2**, pnpm **11.5.0**. `pnpm install --frozen-lockfile` exited 0:
336 packages reused, **0 downloaded**, no manifest or lockfile change. This was
the expressly requested dependency install; no Rust or other tool was installed.
No `.env.local` existed for the builds, and no signing flag was enabled.

Commands run from the new worktree root unless otherwise stated:

| Check | Actual result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS, exit 0 |
| `pnpm check` | PASS, exit 0: brand, workspace build including default Next build, strict types, lint, tests |
| Shared tests within `pnpm check` | **92 passed**, 0 failed, 0 skipped |
| Near-client tests within `pnpm check` | **207 passed**, 0 failed, 0 skipped |
| Web tests within `pnpm check` | **849 passed**, 0 failed, **1 skipped** (opt-in live locator); 62 passing files |
| `pnpm --filter @taply/web exec next build --webpack` | PASS, exit 0; 21 static pages generated |
| `node --test --test-isolation=none apps/api/test/*.test.mts` | **67 passed**, 0 failed, **1 skipped** (POSIX permissions; Windows ACL acceptance remains open) |
| `node packages/shared/node_modules/typescript/bin/tsc -p apps/api/tsconfig.json` | PASS |
| `node apps/web/node_modules/eslint/bin/eslint.js --config apps/api/eslint.config.mjs apps/api/src apps/api/test` | PASS |
| `node apps/web/node_modules/typescript/bin/tsc -p packages/near-client/verification-tests/tsconfig.json` | PASS |
| `node apps/web/node_modules/vitest/vitest.mjs run --config packages/near-client/verification-tests/vitest.config.mts` | **13 passed**, 0 failed |
| Targeted `pnpm --filter @taply/web exec vitest run src/lib/verify/__tests__` | **172 passed**, 1 live skip; subset of web totals, not counted twice |
| Brand check | 7 assets byte-identical |
| `git diff --check` | PASS |
| Source-level G2 and mock-isolation regressions | PASS in web suite: `room-reducer-parity.test.ts`, `room-ui.test.tsx`, adapter/flag tests; production refusal tested by API suite |
| Read-only pilot post-deploy preflight | **10/10 PASS**, exit 0 |
| `node --test contracts/payments/test/*.test.mjs` | **1 passed, 1 failed**: native file-URL regression passes; full preflight fails on missing candidate WASM (blocked artifact gate) |

Unique test totals: **1,229 passed, 2 intentional skips, 1 artifact-blocked test
failure**. The 172-test targeted rerun is already inside the web total. The
10 live preflight checks and the historical receipt recheck below are separate
observations, not added to unit-test counts. No runnable JS/TS assertion failure
remains. Existing jsdom media/navigation warnings and Node's module-format
warning are not payment or device proof.

Local logs: `%TEMP%\taply-phase7h-integration-check.log`,
`taply-phase7h-integration-api.log`, `taply-phase7h-integration-webpack.log`.
Logs are not committed. The prior release branch's screenshots/browser matrix
were preserved; **no new browser screenshot or physical-device run is claimed**.

### Rust, WASM and sandbox: BLOCKED

No `cargo`, `rustc` or `rustup` executable was found on PATH, and the user Cargo
executable is absent. Per instruction, no toolchain installation was attempted.
Default and merchant-bound Rust tests, fmt, Clippy, reproducible WASM/hash
comparison and near-workspaces sandbox suites were **not run / BLOCKED**.
Candidate preflight fails `ENOENT` at the correctly resolved Windows path
`contracts/payments/artifacts/merchant-v1/payments.wasm`. No artifact was
fabricated, substituted or silently skipped. A fresh build matching the approved
pilot hash is still not established on this machine.

## Pilot integrity and live read-only observations

The default approved pilot was **not modified or replaced**. Rust sources,
Cargo manifests/lockfile, default/candidate ABI, pilot deployment runbook,
deployment pins and settlement verifier have no diff from the required base.
Contract changes inherited from core are tests only.

Command:
`node apps/web/scripts/deploy-preflight.mjs post taply-pay-pilot-1.testnet --rpc https://test.rpc.fastnear.com`

At final block `HaQ7xrDoMNHpgnjoY5rHkE2ozZKThUNBBYcgVcZSs6u`, all ten checks
passed: approved code hash
`BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B`, correct Testnet identity,
non-fault build, one retained FullAccess key, quote version 1, funded storage and
principal conservation. `instantNative:true`; protectedPay, handshake,
merchantProfiles, nep141 and sponsoredGas all **false**. A retained FullAccess
key remains an upgrade/trust risk; the check does not remove that authority.

The existing independent verifier was loaded using
`packages/near-client/scripts/reproduce-instant-proof.mjs`'s
`loadIndependentVerifier` helper and called with only the saved public pilot
request and funding reference. A fetch allowlist allowed only status/block/query/
EXPERIMENTAL_tx_status. There was no provider switching inside either proof.

| Provider / UTC check | Result |
| --- | --- |
| FastNEAR, `2026-11-06T09:24:04.668Z` | `not_verified`, transient `RPC_UNAVAILABLE`, transaction-status read did not complete; no success/pruning inference |
| `https://archival-rpc.testnet.near.org`, `2026-11-06T09:24:42.194Z` | **verified**, `FINAL_PAID`, `verified_final`, execution finality FINAL; 12 read-only RPC responses |

Archival proof identifies the existing payment, not a new one:

- Request `9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502`.
- Funding/settlement tx `CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su`.
- Payer `taply-pilot-funder-1101.testnet`; recipient `taplytest.testnet`;
  principal `100000000000000000000000` yoctoNEAR, nonce `1`.
- Successful funding receipt `Zyj9hfcEsqZQ4DiDDqyZaVYsEqCkv4ppkshVms9Y1uJ`.
- Successful transfer receipt `3kLbAxp9Q4XC1DCr7BNF6Vcy6XPYmNJyTHADA9R9MTv4`.
- Successful callback receipt `3FZ4Eu6JYy9LHikK42hx5E6ZAsrTgcnZ3i4CN7hQgvJp`.
- Final state block `C8RwC42Sebyfrz6MfZHhcg3nQ6cJQv1oQRhnMqunJ8KD`, height
  `276468918`; configured-RPC trust, not consensus/light-client verification.

## Safety and remaining blockers

- Production `createCommerceService` still hardcodes
  `authenticationAccepted:false`. Handshake, merchant-candidate, protected-pay
  and Instant signing defaults remain OFF; no feature or signing gate changed.
  Live routes do not wire the room reader/reducer. Mocks remain demo-only.
- Secret scan of 713 tracked files before adding the new test/report found no
  high-confidence private-key/token hits, no sensitive artifact paths and no
  `.env.local`. All 290 long Ed25519 values were classified as public
  signatures/validator approvals in existing fixtures. New test/report content
  contains synthetic data or public chain identifiers, not credentials.
- **Rollback/freshness remains a G2 blocker:** valid encrypted backups can
  resurrect production auth/join authority. The external CAS model is tested,
  but no independent production freshness service or async integration exists.
- **NEP-413 remains gated:** real wallet/mobile callback behavior, recovery,
  HTTPS/cookie/host ACL acceptance and continuous key-revocation handling are
  unproven. No new login or wallet provisioning was enabled.
- **Candidate/escrow remain NO-GO:** missing sandbox/runtime acceptance,
  reproducible artifacts, security approval and separately approved deployment.
- Public RPC rate limits, historical pruning and timeouts can prevent proof;
  current contract Paid is not Verified Paid. There is no automatic retry payment
  or automatic archival provider fallback. Retry-required payouts still need
  explicit references beyond the merchant funding locator's supported path.
- Physical iPhone acceptance was not run; Android remains untested. Source
  release report's browser evidence is historical and does not close this gate.
- CSP remains absent; host HSTS/HTTPS must be reviewed and wallet popup/iframe
  compatibility tested before adding policy. Preflight's failure diagnostics
  still do not always expose HTTP throttling clearly (fail-closed).
- LICENSE, reviewed submission branch/tag, public demo/video, human submission
  and consent remain open. No claim of production readiness or external audit.

## Exact physical iPhone acceptance test (NOT EXECUTED)

Record the tested commit, iPhone model, iOS/Safari version, wallet name/version,
HTTPS origin, RPC endpoint, language and timestamps. Use a real iPhone with
Safari, plus a second independent merchant device/account. Never collect seeds.

### Read-only acceptance first

1. After separately approved HTTPS hosting, build this reviewed candidate with
   the approved pilot ID/hash, Testnet RPC and **Instant signing OFF**. Keep
   Handshake, merchant-candidate and Protected Pay OFF. Run the read-only
   preflight above. No deployment/signing is authorized by this report.
2. In iPhone Safari portrait (then landscape), open `/`, `/merchant`, `/demo`
   and `/demo/handshake`. Check readable layout, no horizontal overflow,
   comfortable tap targets, Testnet labels and DEMO labels only on demos.
3. Open `/pay/9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502`.
   Both independent devices must read **0.1 NEAR**, Pay to **taplytest.testnet**,
   sale code **KED 5E9**, Paid per contract. No signing button with signing OFF.
4. Open `/receipt/<same-id>?ftx=CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su`.
   Missing-history errors must explain history unavailability; generic timeout
   must remain uncertain. Neither may show a new Verified Paid result. On a
   separately configured archival read build, both devices must independently
   verify the full proof. Check VoiceOver announces the receipt outcome once.
5. Turn on Airplane Mode, request a fresh read, then restore connectivity and
   use the single retry control. Expect honest unavailable/stale status, then
   independent recovery; never an additional payment request. Repeat with tab
   background/foreground and reload. Test a malformed/foreign `ftx` link: no
   verified result. Switch/disconnect wallet accounts: no authority leaks.
6. Open `/scan` over HTTPS, deny then allow camera permission; test scan/typed
   link fallback. `/s/00000000-0000-4000-8000-000000000001` must remain unavailable
   for live Handshake. Capture screenshots and redacted console/network evidence.

### Fresh two-device payment: separate explicit human approval required

7. Only after approval for a Testnet signing build and one test payment, enable
   ordinary **Instant Pay only**, preserving all other closed gates. Use two
   distinct external Testnet wallets with a human-selected small amount.
8. Merchant creates one new sale, reviews exact terms and manually approves
   `create_request`. Confirm a unique request ID and per-sale QR. Customer's
   iPhone scans it and independently reads matching amount, recipient and sale
   code. Check wallet rejection once before any successful funding.
9. Customer explicitly confirms and manually signs exactly one
   `pay_instant_native`. Test the wallet redirect back to Safari and a reload.
   The merchant receives no customer verification link: it independently
   observes settlement and locates the funding transaction. Deposit/submission
   alone must never become Verified Paid.
10. Both devices independently reach Verified Paid only after successful transfer
    and callback proof. Save actual transaction hash, request ID, proof JSON,
    recipient payout receipt and final block references. Repeat a read/refresh
    and reopen the paid QR: no second funding approval or duplicate payout.
    On timeout, reconcile the same request/hash; **do not pay again**.

Acceptance passes only with recorded real-device evidence and independent proof;
software tests or a desktop viewport cannot substitute for these steps.

## Review and submission handoff

1. Review the exact integration HEAD and this report; obtain separate approval
   before pushing, opening a PR, merging or tagging. Existing branches stay
   untouched. Do not treat the earlier core publication approval as integration
   publication approval.
2. Run the blocked contract checks on an approved Rust 1.95.0 + wasm environment,
   including default artifact equality with the approved pilot. This does not
   authorize deploying or upgrading any contract. Keep candidate/escrow disabled.
3. Complete the iPhone acceptance above. Decide public read-only demo hosting
   separately; this run did not deploy anything.
4. Owner chooses LICENSE and copyright attribution (and brand-asset treatment).
   Do not silently choose a license or change root metadata.
5. Choose the reviewed submission branch/tag explicitly after approval. `main`
   was not updated. Replace README's placeholder only after that choice; retain
   this report's limitations and distinguish archived proof from fresh payment.
6. Record an honest demo video using the source release report's shot list.
   A fresh signing/payment recording needs approval; otherwise label archived
   pilot footage and DEMO scenes. Do not present live G2 or escrow as shipped.
7. Human reviews current official hackathon rules/deadline at
   `https://nearhackathon.com/HACKATHON.md`, publishes the required demo/social
   material, reviews submission payload and consent, then explicitly authorizes
   submission. No posting, application, personal-data payload or submission was
   performed here. The prior release checklist remains a planning reference;
   revalidate time-sensitive requirements before using it.
