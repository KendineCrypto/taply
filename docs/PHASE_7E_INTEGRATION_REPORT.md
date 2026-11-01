# Phase 7E integration release candidate

2026-11-02. Local integration in `C:\taply-phase7-integration`, branch
`feature/phase7-integration`. GO for offline integration and an operator-prepared
iPhone ordinary Instant POS test. **NO-GO for real G2 Handshake or production
authentication.** No deployment, wallet operation, blockchain transaction, push,
main merge, live capability activation or existing database access occurred.

## Git safety and merge

Preflight found the requested worktree/branch, a clean index/worktree and both
source branches. All ten required commits existed; the fixture fix is an ancestor
of the core tip. The complete changed-path list was inspected before merging.

| Reference | Observed commit |
| --- | --- |
| Frontend source / integration starting tip | `a92324f3727b86da725ec4283ca7ee7821bd11e9` |
| Core source | `96c1d536c9a926176786752c4ced6b192b797223` |
| Merge base | `dd582bfee7f7592d775363a086c6ba88b39969b7` |
| Non-fast-forward merge | `62d7d6dd031152c0fcb839de48cf478a7163f796` |
| Tested payment safety fixes | `4a76769` |
| Read-only integration and CI | `361543d` |

Merge parents are the two source tips above. `git merge --no-ff --no-commit
feature/phase7-core` had no conflicts. Its 30 changed paths added the API and
handoff documents and fixed the near-client test clock. The merge was committed
only after the merged baseline passed: shared 92, near-client 158, web 616,
API 42 passed / 1 skipped, strict types/lint and the root production build.
Both source refs remain unchanged. The frontend was already the integration
branch's starting point; it did not need a second merge.

Follow-up commits separate payment safety fixes, the read-only integration seam
and this report. Obtain their exact IDs with:

```powershell
git log --first-parent --oneline a92324f3727b86da725ec4283ca7ee7821bd11e9..feature/phase7-integration
```

## Changes and reproduced defects

1. **Timeout was permission to re-sign.** Six new tests failed against the merged
   baseline: missing creation at 120/300/86400 seconds and unexplained pay/cancel/
   payout retry after two minutes all returned `may_reattempt`. Removed that
   reconciliation state and all UI handlers that could mark an unknown attempt
   resolved to re-sign or discard it. Missing creation remains blocked across
   reload; the UI exposes chain status and keeps checking with bounded backoff.
   A proven wallet rejection still permits an explicit attempt. Final chain state
   can explain an operation; age alone cannot. There is currently no operator
   transaction-failure resolver for genuinely lost creations: they deliberately
   stay blocked. Do not clear browser storage to bypass this safeguard.
2. **Distinct sale IDs bypassed the cross-tab creation gate.** A new concurrent
   test reproduced two successful journal reservations for one merchant on one
   contract. Creation now checks unresolved creations under the journal's existing
   cross-tab lock, with account/network/contract isolation. The screen checks the
   current journal before allocating another nonce. After chain reconciliation,
   two sequential sales on the same journal produce distinct nonces/IDs and two
   explicit wallet requests.
3. **Reconciliation provenance.** Stale, offline, pending-finality or pre-attempt
   observations cannot resolve the journal. Full regression exposed two mobile
   fixture tests combining current journal time with a historical observation and
   a wallet-return test with an empty response cast. Observation clocks were
   aligned; the cast was replaced with the real near-client fixture read. Existing
   automatic mobile receipt follow-up and independent Verified Paid assertions
   remain in place and pass.

The shared schemas, contract/ABI/callbacks, wallet signing adapter, approved pilot
identity, feature flags, env examples, dependency manifests, lockfile and
`docs/EVIDENCE.md` are unchanged. No dependency update or database migration.
Existing historical reports are retained; their two-minute re-sign guidance is
superseded by this report and the fail-closed code.

## Backend/frontend boundary

`apps/web/src/lib/handshake/http-reader.ts` is a thin, independently tested,
**read-only seam**, not installed in live routes or `resolveHandshakeAdapter`.
It requests only snapshots and bounded JSON event pages using same-origin
credentials, no-store, no redirects, a timeout and a non-secret Last-Event-ID
header. Browser origin must match the configured HTTPS origin. Shared strict
schemas reject paid fields, foreign session IDs, malformed JSON and fake events.
Errors expose stable categories, not server prose. It has no login, signing,
token persistence, join, mutation, payment output or polling scheduler.

The API integration test calls this actual frontend reader against
`createCommerceService` in-process, using a disposable empty test SQLite path
and a fixture service-encryption key. Actual production refusal is asserted;
no listener, real wallet key, auth acceptance or chain call is involved.
The demo remains the existing synthetic presenter, import-contained to
`/demo/handshake`, labelled DEMO and unable to fund transactions. No synthetic
auth composition was connected to any browser or network route.

Boundary audit against all five requested handoff documents:

| Area | Integrated behavior / remaining gate |
| --- | --- |
| Models | Shared HandshakeSession/SessionEvent/ApiError; coordination separate from chain state |
| Auth | Wallet connection is not login; real NEP-413 bytes + recent finalized FullAccess association required; production factory hardcodes acceptance false |
| Wallet capability | Existing WalletAdapter has no signMessage; actual target-wallet callback/state/mobile behavior unproven; no new signing adapter |
| Merchant binding | Account-derived discovery only; no signed profile publishing; merchant lookup returns 404, never fabricated authentication/name |
| Session binding | Pilot rejects non-null merchantAccountId/sessionBinding; bound Handshake must refuse, never downgrade silently to ordinary Instant |
| HTTP | Same-origin exact HTTPS, Secure HttpOnly Strict cookies, POST Origin + CSRF and idempotency; no deployed listener/proxy/CORS setup |
| Events | Backend currently returns JSON polling, not SSE; hints require fresh snapshot and chain reads; no event grants Paid |
| Tokens | Auth cookie HttpOnly; future CSRF memory-only; joins require one-use secret in POST body, fragment stripped before use; not wired live |
| Outage | Refusal/unavailable remains unavailable; disconnect does not imply payment failure or permission to retry |
| Persistence | v2 only; host ACLs/key provisioning/recovery and external freshness unresolved |

The old example `NEXT_PUBLIC_TAPLY_API_BASE_URL=http://localhost:8787` is not a
working service or this seam's configuration; it remains unchanged and unused.
No Next API route, production auth UI, live session controls or public API was
added. Host/HTTPS/wallet/database gates cannot be closed by local fixture tests.

## Verification

Pinned installed versions: Node `v24.22.2`, pnpm `11.5.0`. Frozen install exited 0,
lockfile resolution skipped and no lockfile/manifests changed.

Final command results are recorded after completion below. Root checks include
strict TypeScript, brand equality, lint, workspace imports, unit tests and the
contract-independent frontend integrations. API remains outside the workspace
manifests, so its three checks must also run separately. CI now includes those
checks and the explicit Webpack build; no hosted CI run or POSIX execution is
claimed from this Windows run.

| Command / project | Actual final result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Exit 0; no dependency changes |
| `pnpm check` | Exit 0; brand, production build, strict types, lint and all workspace tests passed |
| `@taply/shared` | 92 passed, 0 failed |
| `@taply/near-client` | 158 passed, 0 failed |
| `@taply/web` | 631 passed in 49 files, 0 failed |
| `node --test apps/api/test/*.test.mts` | 44 tests: 43 passed, 0 failed, 1 skipped (POSIX permissions on Windows) |
| API standalone TypeScript and ESLint commands below | Both exit 0, no diagnostics |
| `pnpm --filter @taply/web exec next build --webpack` | Exit 0; Next 16.4.3, compiled in 11.1s, TypeScript 2.4s, generated 21/21 pages |
| Production loopback HTTP smoke | 10/10 listed commerce routes returned 200; `/api/v1/sessions` returned 404 (no live API route); server stopped after smoke |
| Aggregate, excluding repeat/targeted runs | **924 passed, 0 failed, 1 skipped** |

The production smoke used `next start --hostname 127.0.0.1 --port 3217` and HTTP
GETs only, without a browser wallet, client effects or chain calls. It establishes
route availability, not rendered mobile QA or TLS compatibility. The ten paths
were merchant hub/register/setup, checkout/merchant.testnet, scan, request/new,
pay/receipt with a synthetic 64-hex ID, an unavailable session UUID and demo/handshake.

The initial adapter test draft imported backend `.mts` files into the stricter web
compiler and failed its type boundary. Moving that cross-service test to the API
suite restored independent project compilation; no compiler option or assertion
was relaxed. The first full post-fix run caught the three fixture mismatches
described above (624 passed / 3 failed); the final full run passed 631/631.
Existing jsdom navigation/media/scrollTo and performance-advice warnings remain
non-failing. Node's direct import of the frontend TS seam in the API test emits a
module-type detection warning; no package/runtime dependency was changed to hide it.

Local raw command logs are in `$env:TEMP`: `taply-7e-install.log`,
`taply-7e-baseline.log`, `taply-7e-repro.log`, `taply-7e-race-repro.log`,
`taply-7e-verified-check.log`, `taply-7e-verified-api.log`, and
`taply-7e-webpack.log`. These are local artifacts, not hosted CI evidence.

Regression coverage uses real components, shared types and existing near-client
read/signing preparation code with synthetic wallets/RPC evidence. It is local
integration evidence, not a new Testnet or physical-device proof.

| Required journey | Executed coverage (under apps/web/src unless API named) |
| --- | --- |
| 1. Merchant discovery URL | lib/merchant/__tests__/discovery.test.ts; components/merchant/__tests__/checkout.test.tsx |
| 2. Account isolation | merchant.test.tsx account switch/isolation; journal-lock.test.ts concurrent account scopes; API http-security/auth-hardening tests |
| 3. Unique signed sale | merchant.test.tsx exact ordinary Instant terms and explicit prompt |
| 4. Sale QR parsing | payment-screen.test.tsx QR/share equality; scan-input.test.ts and checkout paste integration |
| 5. Malicious QR | qr-security.test.ts 46 adversarial cases; scanner tests |
| 6. Wallet rejection | payment-screen.test.tsx; create-request.test.tsx; payments-core.test.ts |
| 7. Unknown wallet result | unknown-outcome.test.ts; payment-screen.test.tsx; journal-lock.test.ts |
| 8. Reload/recovery | create-request.test.tsx five-minute unknown stays blocked; wallet-return.test.ts; mobile-receipt.test.tsx |
| 9. Contract Paid / Verified Paid | payment-screen.test.tsx terminal facts; mobile-receipt.test.tsx and independent verifier suites |
| 10. Service unavailable | handshake/http-reader.test.ts; API frontend-boundary.test.mts actual production refusal |
| 11. Unauthenticated endpoints | API http-security.test.mts, commerce-http.test.mts and frontend-boundary.test.mts |
| 12. Demo isolation | handshake.test.ts import containment; handshake-ui.test.tsx DEMO/no payment |
| 13. Event cannot mark Paid | http-reader.test.ts strict rejection; handshake.test.ts no paid output; API sessions/commerce HTTP forgery tests |
| 14. Disabled real Handshake | handshake.test.ts default-off resolver and shipped refusal; handshake-ui.test.tsx unavailable route |
| 15. Sequential distinct sales | merchant.test.tsx two actual prepared signatures on same journal after confirmation; journal-lock.test.ts cross-tab reservation |

## Commerce flow and routes

External Testnet wallet -> `/merchant` -> `/merchant/register` -> amount/reference
-> exact recipient/amount/bond/gas review -> one ordinary `create_request` through
the existing signer -> sale-specific `/pay/<id>` QR -> customer immutable chain
review -> explicit wallet approval -> contract payout/callback -> FINAL_PAID ->
independent receipt verification. Merchant/session bindings stay null for this
ordinary pilot flow. QR scan is navigation only; it cannot create or pay.

Routes: `/merchant`, `/merchant/register`, `/merchant/setup`,
`/checkout/<accountId>`, `/scan`, `/request/new`, `/pay/<id>`,
`/receipt/<id>?ftx=<fundingHash>`, `/s/<sessionId>` (unavailable),
`/demo/handshake` (synthetic only). Store QR requires an approved shareable HTTPS
origin; local HTTP/IP origins do not generate a shareable QR.

Second-sale UX now checks until an authoritative result explains the first sale,
including beyond two minutes. A missing request remains unknown. An account
switch discards the visible stale review; another account's creation does not
block this one. Request expiry is chain-derived, rejection remains distinct from
unknown, and no server/session response supplies finality. The merchant may see
**Paid per contract**; **Verified Paid** needs the customer's funding-hash receipt
link and successful independent verification. No indexer discovers that hash yet.

## Security gates and storage recovery

Pinned pilot identity is preserved in source:
`taply-pay-pilot-1.testnet`, code hash
`BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B`.
Historical production WASM SHA-256 in EVIDENCE is
`a13d932f3b4cadbb4a6580d447a8142f8c704656998659fb3ccebde6ddacb0d2`.
These are existing recorded identities, **not fresh chain observations** in 7E.
No contract build/test was needed or run because no Rust or contract behavior
changed. Existing contract callback-stall/upgrade-authority risks remain.

All financial flag definitions and operator env files are untouched. The external
Instant gate still requires approved configuration/fresh contract verification;
native Taply Wallet signing is hardcoded OFF. Protected Pay and live Handshake
remain OFF; production merchant authentication is closed. No customer private
keys, real service keys or private journals were accessed. API source has no
request logger; host/reverse-proxy logging remains an operational responsibility.

**Encrypted SQLite is not rollback-resistant.** Under active non-rollback state,
durable consumption/logout/scope/race tests refuse replay. Restoring a valid old
encrypted backup can resurrect consumed challenges, logged-out sessions and join
authority; tests explicitly reproduce this vulnerability. Production authentication
remains NO-GO pending a reviewed external freshness/fencing design and recovery.

Storage v2 rejects v1/future/corrupt snapshots, including initialization attempts
against old state. There is no automatic migration. No existing data was opened,
deleted, overwritten or migrated in 7E. Clean start requires a separately reviewed
new empty path and independently provisioned service key, private DB/WAL/SHM/key
permissions and explicit operator initialization. Routine startup must use
initialize=false. Never initialize automatically after an error.

After an uncertain restore, stop all workers, preserve/quarantine old DB/WAL/SHM
and backups, retire the serving key, and follow reviewed invalidating recovery
with a new key and new empty path. Invalidate all auth/challenge/join authority;
keep gates closed through review. Do not reopen a restored snapshot as current
authority or rotate a key in-place. Windows NTFS ACLs, power-loss/disk-full/
ambiguous-COMMIT behavior, resource/load acceptance and multi-host recovery remain
unproven. Do not remove the Windows-skipped POSIX permission assertion.

## Reproduction and startup

From a clean checkout, with the pinned runtime/tools already installed:

```powershell
Set-Location C:\taply-phase7-integration
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm check
node packages/shared/node_modules/typescript/bin/tsc -p apps/api/tsconfig.json
node apps/web/node_modules/eslint/bin/eslint.js --config apps/api/eslint.config.mjs apps/api/src apps/api/test
node --test apps/api/test/*.test.mts
pnpm --filter @taply/web exec next build --webpack
pnpm --filter @taply/web exec next start --hostname 127.0.0.1 --port 3000
```

Open `http://127.0.0.1:3000/demo/handshake` for the synthetic walkthrough.
`pnpm --filter @taply/web dev` is the development alternative. A fresh checkout's
defaults disable financial signing and have no approved deployment configured.
Use only the operator's separately approved existing pilot configuration for
device testing; do not overwrite it with `.env.example` or change flags as part
of this task. Next public settings are build-time values: rebuild after an
independently approved configuration change. No API startup command exists: the
backend exports Fetch handlers and intentionally supplies no network listener.

For an operator-managed local HTTPS reverse proxy, the web server may be bound
to that proxy's loopback upstream as above. Both phones must trust/reach the
existing approved hostname. Same-origin Secure cookies and host ACL/recovery
review are prerequisites before any future API host test; HTTP localhost and an
alternate `:8787` origin do not satisfy them. This task did not configure hosting.

## Physical-device checklist and decision

No new iPhone/Android run was performed. Existing user-reported iPhone Instant
success is retained in `apps/web/docs/PHASE_6C_MOBILE_PILOT.md`; its missing
archived mobile receipt proof remains missing. Historical CLI receipt evidence
in `docs/EVIDENCE.md` was not altered or substituted for a mobile payment.

- [ ] Confirm iOS/browser/wallet versions, Testnet account, HTTPS reachability and approved existing build configuration on both phones.
- [ ] Merchant -> New sale -> exact amount/reference/account review -> one wallet prompt -> return to sale QR.
- [ ] Customer scans discovery QR: no amount, no automatic wallet prompt; scans sale QR: immutable chain terms and explicit approval.
- [ ] Verify customer FINAL_PAID independently with funding/payout/callback proof; share the verification link to merchant/desktop.
- [ ] Confirm merchant distinguishes Paid per contract from Verified Paid without the funding hash.
- [ ] Complete a second distinct sale with the same journal; verify nonce/ID differ and pending confirmation clears without reload.
- [ ] Decline once; switch accounts during review; expire a request; confirm no unintended signing or false paid state.
- [ ] Simulate an unresolved wallet outcome/reload: after two minutes only status/reconciliation, no re-sign/discard/new-sale escape.
- [ ] Check camera shutdown, notched safe areas, large text, VoiceOver, both orientations, EN/TR and reduced motion.
- [ ] Archive actual receipt JSON, public IDs/hashes and device versions only after observation; no signatures/tokens/private material.

**iPhone Merchant POS:** software candidate ready for this separately operated
ordinary Instant test, conditional on existing approved wallet/HTTPS/config;
physical-device acceptance is still pending. No signing/hosting permission is
implied by this report. **Real G2 Handshake: NO.** Blocking gates: reviewed
session-capable contract/adapter, NEP-413 wallet compatibility, signed profiles,
HTTPS/proxy/ACL/key/recovery setup, rollback freshness protection and independent
two-device live evidence. Protected Pay stays disabled and unproven.

## Rollback without data loss

No service/deployment/database change needs operational rollback. Preserve all
operator env files, encrypted databases, WAL/SHM/backups and browser journals.
Never restore an older auth snapshot or clear unknown attempts to make a rollback
appear healthy. Do not reset/force checkout or move either source branch.

For a code rollback, first require a clean worktree, create a separate rollback
branch, inspect the first-parent log above and revert follow-up commits newest
first with `git revert --no-commit <commit>`. Then use
`git revert --no-commit -m 1 62d7d6dd031152c0fcb839de48cf478a7163f796`
to undo only the core merge. Review/test the resulting diff before committing;
no push/main merge is implied. The old frontend contains the known timeout and
cross-tab defects, so do not serve that rollback without retaining/reapplying
the payment safety fixes. Keep production auth/live G2 closed throughout.
