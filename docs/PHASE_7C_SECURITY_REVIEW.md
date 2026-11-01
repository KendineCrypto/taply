# Phase 7C.1 security review

Date: 2026-11-02 (Europe/Istanbul). Source-level hardening and local adversarial
testing, not an external audit or production approval. Worktree feature/phase7-core.
Production authentication, Merchant/Handshake flags and Testnet G2 remain NO-GO.

## Findings and disposition

| Finding | Impact in an enabled service | Disposition |
| --- | --- | --- |
| Pending NEP-413 verification could finish after logout | Login resurrection after user invalidation | Fixed: retain consumed challenge reservation until completion; logout removes same-account and initiating-session pending authority; login commit checks reservation |
| Stored auth token lacked service origin/contract scope | Reusing a database under different configuration could accept old credentials | Fixed: persisted scope checked on every authenticated lookup |
| Reauthentication did not retire the replaced cookie token | Prior token remained usable until logout/TTL | Fixed: new token and CSRF; prior presented token removed atomically at successful login commit |
| Persisted snapshots had no explicit decoded format envelope | Unsupported layouts could reach domain code as unchecked casts | Fixed: authenticated v2 format/namespace envelope; old/future formats refuse, no automatic migration |
| Live connection could retry after detected data corruption | No persistent quarantine after corrupt reads | Fixed: connection poisoned after missing/undecodable/unsupported state; domain validation errors still roll back normally |
| Default filesystem permissions were delegated entirely to host | Database accessibility to other local users | POSIX private owner/directory/file checks and exclusive 0600 creation added; Windows ACL provisioning remains unresolved |
| Valid backup can resurrect challenge/token/session authority | Replay of consumed challenges, joins and logged-out cookies | Reproduced in tests; unresolved without external freshness authority; gates remain closed |

The logout fence covers already issued challenges for the same account and a
different-account challenge initiated from that logged-in session cookie. A new
login initiated after logout is a new user action and still requires fresh proof.
Unauthenticated pending login cancellation has no logout authority; UI must ignore
abandoned responses. Logout does not claim to revoke every other independent
browser session for the account. Session cookies remain bearer credentials:
theft permits use until expiry/logout; XSS/TLS/host security are deployment gates.

## Persistence security analysis

Encrypted SQLite provides confidentiality/integrity of stored payloads, not
freshness. The tests deliberately close all connections before copying or
restoring snapshots so WAL files do not invalidate the demonstration. They show:
pre-consumption backup -> same auth signature accepted again; pre-logout backup ->
same cookie accepted again; pre-join backup -> same join token pairs another payer.
These passing tests assert the vulnerability, not rollback resistance.

An independent trusted component is required for automatic rollback detection.
It must maintain a non-restorable deployment epoch and linearizable monotonic
revision plus authenticated payload digest per persisted namespace (or one global
transaction sequence), outside this database/key backup failure domain. Every
operation, including another worker, must validate the anchor and serialize its
updates with CAS/fencing; startup-only checks are insufficient. Cross-system
commit/recovery must refuse all uncertain pending states. A counter, timestamp,
hash or random epoch inside the same restorable DB does not meet this requirement.
No such component/protocol has been implemented or tested here.

Safe operational response to uncertain restore: stop every worker, quarantine the
old DB/WAL/SHM and backups, retire the old storage key from the serving environment,
provision a new independent service key and new empty path, invalidate all
auth/challenge/Handshake authority, and keep capability gates closed through
review. This sacrifices coordination continuity; it never changes on-chain funds.
Changing a key on the same existing encrypted DB is not supported: it refuses.
There is no transparent live key rotation or active-active recovery mechanism.
Never use initialize=true as an automatic recovery fallback.

Storage format now uses taply.storage.v2 for authenticated data and decoded
envelope. Phase 7C v1 snapshots intentionally refuse, including initialize=true;
there is no migration runner. A future migration needs an offline, backed-up,
version-specific schema validator, retention/replay tests and explicit recovery
approval. Do not reinterpret v1 or discard replay records as a migration shortcut.
There were no real service databases migrated in this task.

All workers use BEGIN IMMEDIATE, bounded lock timeout, WAL and synchronous=FULL.
Existing independent-worker tests show no lost updates. Abrupt child-process exit
after an uncommitted SQL write rolls back; committed writes survive exit before
close. These tests are not power-loss, disk-full, fsync failure or ambiguous COMMIT
fault-injection proof. Uncertain commit/rollback poisons a connection. Corruption,
wrong key, missing DB and unsupported formats refuse rather than initialize.
Synchronous encrypted snapshot rewriting limits throughput and can block the event
loop; load/SLA acceptance and a better indexed store remain future work.

POSIX checks require current owner and no group/other directory/file permissions;
new files are exclusively created with mode 0600. Immediate symlink paths refuse.
This host is Windows: the POSIX permission test is skipped, and NTFS ACLs are NOT
configured/proven. Before any host test, a human operator must establish/inspect
private directory inheritance and DB/WAL/SHM/key ACLs for the service identity.
No ACLs or existing private files were modified here. Dedicated storage key stays
outside the DB directory and source; best-effort buffer zeroing on close does not
prove process-memory erasure. Protect crash dumps and operator tooling.

Reference: SQLite describes backups as snapshots and documents WAL's same-host
requirements: [backup API](https://www.sqlite.org/backup.html),
[WAL](https://www.sqlite.org/wal.html). Encryption does not add anti-replay to them.

## Endpoint authorization review

auth/challenges: exact origin, account syntax, durable peer/account rates,
browser-bound CSPRNG challenge, strict bounded JSON. Does not authenticate.
auth/verify: exact origin/browser binding, exact signed account/state/message,
cryptographic proof plus finalized FullAccess association, single consumption,
commit-time logout fence, fresh session/CSRF. Supplied public key alone cannot log in.
auth/me: authenticated scoped, unexpired cookie; returns CSRF only same-origin.
auth/logout: cookie + origin + CSRF; removes token/pending login authority.

sessions/create: account comes only from auth; no caller role/merchant accepted.
bind: merchant-only, immutable canonical chain request, repeated authorization
after RPC and transactional state checks. join: separate one-use secret and
independent authenticated payer, canonical payer restriction. review: participant
and exact hash, never a payment authorization. close: merchant-only coordination.
presence: participant-only lease. snapshot/events: participant-only reads, no token
or finality proof. Shared strict schemas protect snapshots/events.

Merchant read returns MERCHANT_NOT_FOUND; profile publication remains unsupported.
Unknown endpoints refuse; there is no profile/write or arbitrary settlement API.
Production composition hardcodes authenticationAccepted=false and refuses even
pre-existing authenticated cookies. No body/header/query feature override exists.

Negative matrix tests cover unauthenticated and logged-out cookies, bad/missing
CSRF, missing/foreign Origin, duplicate cookies, preflight/CORS refusal, role/paid
field injection on all mutation paths, outsider merchant actions, wrong hash,
cross-session snapshot/event reads, join replay, forged auth account, wrong browser
binding and challenge replay. Existing tests cover body size/duplicate JSON,
rate limits and RPC mismatch/outage. No logger/console call exists in apps/api/src;
HTTP errors are localized stable codes with empty sanitized details. Reverse-proxy
logs/analytics are outside this code and must redact cookies/bodies/fragments.

## Wallet compatibility and frontend handoff

See [POS integration guide](PHASE_7C_POS_INTEGRATION.md) for exact HTTP setup,
typed examples, disabled behavior and a future human-run wallet matrix. Installed
@hot-labs/near-connect 0.12.0 exposes signMessage types with no state/callback input
and no returned state. The checked-in Taply WalletAdapter has no signMessage.
No assumption is made about Claude's independently built files/branch.
SDK support declarations and local signatures do not prove any physical wallet.
No signature prompts, key access/revocation/rotation or live RPC calls were made.
Production wallet capability is still unaccepted.

## Executed validation

Node v24.22.2, pnpm 11.5.0 on Windows. Commands and results for this review:

```text
node --test apps/api/test/*.test.mts
  tests 43; pass 42; fail 0; skipped 1 (POSIX-only permissions on Windows)
node packages/shared/node_modules/typescript/bin/tsc -p apps/api/tsconfig.json
  exit 0, no diagnostics
node apps/web/node_modules/eslint/bin/eslint.js --config apps/api/eslint.config.mjs apps/api/src apps/api/test
  exit 0, no diagnostics
pnpm check
  exit 0; brand/build/typecheck/lint passed
  shared: tests 92, pass 92, fail 0
  near-client: tests 158, pass 158, fail 0
  web: Test Files 39 passed; Tests 515 passed
```

Total executed across commands: 807 passed, zero failed, one skipped. Web test
output includes jsdom's existing "Not implemented: Window's scrollTo() method"
warning and environment performance advice; neither failed the check.

No dependencies, shared/root manifests, lockfile, apps/web or contract changes.
No Rust tests run: contracts unchanged. Existing and new API adversarial cases run
together; API is still outside recursive pnpm check and must remain a separate CI
command until authorized workspace integration. Final verdict: GO for in-process
synthetic HTTP-handler integration; local network/physical-device HTTP test only
after trusted HTTPS launcher/ACL/recovery setup review; NO-GO for production auth
or actual Testnet G2.
