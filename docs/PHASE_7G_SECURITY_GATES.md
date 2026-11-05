# Phase 7G CORE security gates

Base: `5999d0c2bee67839e1ba55546b0021b22f2d0ce4`. Work is isolated on
`feature/phase7g-core`. Production authentication and live G2 remain disabled.

| G2 acceptance requirement | Required evidence / authority |
| --- | --- |
| Merchant controls receiver | NEP-413 proof plus fresh finalized FullAccess association; direct creator-signed contract creation |
| Unique authorized sale | Creator-scoped nonce / deterministic ID; permanent replay tombstone |
| Immutable merchant/session terms | Frozen v1 terms/hash/commitment; merchant equals creator equals receiver |
| Independent customer terms | Approved deployment hash, Testnet genesis, same finalized block reads |
| Independent equal code | Each client computes frozen v1 commitment/code from independently read terms |
| Explicit bilateral review | Authenticated separate participants review the exact hash; review is coordination only |
| Explicit funding | Customer wallet approval, exact native principal/hash; never requested automatically |
| Safe settlement | Existing reserved in-flight transfer and private nonce-checked callback |
| Chain payment status | Finalized chain read; server events and clocks confer no payment authority |
| Verified Paid | Independent funding/transfer/callback receipt graph proof, beyond contract status |

Implementation decision: an opt-in `merchant-bound-v1` contract build will be
versioned separately from the default pilot build. No frozen wire schema, hash
domain, payout method or callback ABI is changed. No upgrade of the existing
pilot is authorized. A new deployment identity/hash must be reviewed separately.

The approved deployment remains `taply-pay-pilot-1.testnet`, code hash
`BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B`. Recorded pilot WASM SHA-256:
`a13d932f3b4cadbb4a6580d447a8142f8c704656998659fb3ccebde6ddacb0d2`.
These are historical pins, not a fresh chain observation.

Activation gates: separately reviewed deployment and upgrade authority, real wallet
NEP-413/mobile evidence, signed merchant discovery, trusted HTTPS/cookies/host
permissions, independent non-restorable freshness infrastructure, recovery and
resource acceptance, frontend integration and actual two-device receipt evidence.
Passing local tests cannot close these operational gates.

## Final disposition

| Gate | Local evidence / disposition |
| --- | --- |
| Merchant authorization and immutable v1 commitment | Candidate unit/adversarial tests pass; default contract stays unbound-only |
| One request per sale | Permanent creator-scoped session-ID tombstone plus creator nonce/request record |
| Native settlement/conservation | Existing state machine reused; default and bound unit suites pass; candidate sandbox execution blocked |
| Independently matched session/terms | Two separate client transports, pinned final reads, substitutions/forgery tests pass |
| Wallet capability/signature/account association | Pure preparation and backend crypto/rotation fixtures pass; actual wallet compatibility unproven |
| Backup rollback | External CAS model detects restore; existing production synchronous store remains vulnerable and unintegrated |
| Multiple processes | Controlled independent processes acknowledge one token consumption via shared authority model; no production provider |
| Realtime hints | Atomic backend snapshots/cursors retained; bounded SSE and client cursor/auth-generation checks pass |
| Verified Paid | Still requires independent receipt proof; no room/read/preparation helper can confer it |
| Default artifact integrity | Pre-existing cloud artifacts preserved byte-for-byte; they were not the historical approved pilot build |
| Full quality gate | Strict types/lint/tests pass separately; pnpm check frontend build blocked fetching Google Fonts |
| Contract runtime gate | Sandbox dependency downloaded with TLS verification; node startup blocked by NOFILE 16384 vs required 65535 |

Offline coordination/compatibility/freshness-model integration: **GO for labelled
synthetic, in-process testing**. Candidate contract runtime acceptance: **NO-GO
until sandbox succeeds**. Actual Testnet G2 and production authentication:
**NO-GO**. No feature flag, deployment or production composition was enabled.

External freshness is a new isolated `taply.fenced-state.v1` envelope, not a
silent change/migration of `taply.storage.v2` auth/room payloads. The coordinator
reads local+external head, computes a pure synchronous decision, advances the
external digest/revision with CAS, commits local CAS, then confirms the external
head before acknowledging. A crash/unknown result between those steps fences
further work. No recovery reset is provided. The actual deployment must supply
an authenticated, linearizable, monotonic authority outside all database/key/
backup/admin rollback domains, durable fencing, independent availability and
reviewed epoch recovery. All existing auth/session operations must be integrated
with the async protocol before claiming remediation. A second SQLite file on the
same host is not a production freshness authority. The tests use a controlled
external model only; existing rollback-vulnerability tests intentionally remain.

Remaining known risks: callback-success-recording failure can leave a correctly
paid transfer permanently in flight; no automatic retry/refund is safe. Existing
15-minute auth cookies do not continuously revalidate revoked FullAccess keys.
RPC evidence uses configured-provider trust, not consensus/light-client proof.
Host power-loss, disk-full, ambiguous commit, ACL/key provisioning, resource/load,
TLS/mobile callbacks and two physical devices remain operational acceptance work.

Exact next operator steps: repair the sandbox host resource limit and rerun all
candidate/default sandbox tests; restore approved Google Fonts access or have the
frontend owner review font self-hosting; review this branch and candidate bytes;
provision/review external freshness and async integration; obtain real-wallet and
HTTPS/host evidence. Then separately approve any new account creation, funding,
deploy/init, real wallet signature or payment transaction. Each live action needs
its own concrete reviewed proposal; none is authorized by this implementation.
