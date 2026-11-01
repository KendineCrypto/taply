# Phase 7C commerce service handoff

Status: offline backend integration GO; production auth and actual G2 pilot NO-GO.
No deployment, listener, wallet operation, chain transaction or live G2 evidence.
No dependencies, root manifests, lockfile, shared schemas, frontend or pilot
contract changed. Node v24.22.2 / pnpm 11.5.0.

## What is real and tested

`nep413.mts` implements exact u32 NEP-413 tag 2147484061, Borsh UTF-8 strings,
fixed 32-byte nonce, optional original callback URL, SHA256 and Node Ed25519
signature verification. Canonical base64 lengths and Ed25519 base58 key bytes
are checked. Every server challenge field is bound in the exact signed JSON
message, including account, Testnet network, purpose, origin, recipient, expiry,
state and contract. Returned account/state must match the stored challenge.
Only `merchant-login` purpose is supported; login is not a profile signature.

Reference: [official NEP-413](https://github.com/near/NEPs/blob/master/neps/nep-0413.md).
Its published hi/myapp.com/callback example is checked against literal Borsh
bytes. No complete official signature vector was found in that standard; tests
add independently generated disposable off-chain Ed25519 fixtures and mutations.
These are not existing wallet keys and are never persisted.

Finalized association uses the existing near-client public chain reader: fixed
Testnet RPC, genesis/network check, final block, exact account/public-key query,
FullAccess permission, matching hash/height. FunctionCall, null permission,
missing keys, stale (>120 seconds), future (>30 seconds), wrong network/block
or RPC failure refuse authentication. Reads are configured-RPC trust, not a light
client. Public key alone is never proof. Association is established at login;
15-minute sessions do not continuously revalidate key removal. Production key
revocation policy review remains necessary before activation.

Verifier supports original callback URL bytes when explicitly stored, restricted
to `{origin}/auth/callback`. Current challenge endpoint omits callbackUrl; it
does not guess a browser wallet's default. Frontend must validate actual target
wallet behavior and add reviewed explicit callback support if required.

## Persistence guarantees and limits

`storage.mts` uses built-in node:sqlite DatabaseSync (installed API smoke-tested),
BEGIN IMMEDIATE, WAL and synchronous=FULL. Encrypted namespace snapshots use
AES-256-GCM with random 12-byte nonce and version/namespace authenticated data.
Auth and Handshake occupy separate rows. Serialized state is limited to 8 MiB
per namespace. Every operation obtains a write transaction before reading;
independent worker connections were tested for no lost updates. Callback failure
rolls back; uncertain COMMIT/rollback invalidates that connection. Missing DB on
restart or wrong-key/corrupt data never initializes silently. Initialization is
an explicit trusted-operator argument and must not be used for routine recovery.

Caller supplies a dedicated 32-byte service encryption key, never a wallet key.
Keep it outside the DB directory, protect directory/WAL/SHM/key with host ACLs,
and exclude these from source/backups/logs. Encryption includes idempotent create
responses containing join secrets. Auth cookies are stored only as SHA256 hashes.
SQLite host access controls and storage-key provisioning are deployment duties;
they are not configured by this library. No production-safe hosting claim is made.

Trade-off: simple bounded single-host service without added dependencies, but
synchronous full-snapshot writes serialize throughput. Do not place the DB on a
network filesystem or claim multi-host HA. Pinned Node/V8 serialization and format
version require a reviewed migration for runtime/schema changes. Node's SQLite
API stability must be reviewed when upgrading the pinned runtime.
Reference: [Node SQLite documentation](https://nodejs.org/docs/latest-v24.x/api/sqlite.html).

Auth challenges expire at 120 seconds and are durably consumed before crypto/RPC.
Failed verification burns the challenge, including RPC failure. Browser binding
mismatch cannot consume another browser's challenge. Opaque auth tokens and CSRF
secrets use 32-byte CSPRNG; absolute auth TTL is 900 seconds. Logout deletes the
hashed token; expiration/cleanup survive reopen. Handshake state, consumed join
authority, review identities, idempotency and bounded 64-event history persist.
Original session retention/bounds from Phase 7 still apply. Presence is a lease,
so a crash can leave a last-known online hint until its 30-second expiry.

Encrypted storage cannot detect restoring an older valid backup. After uncertain
restore, do not reopen it as current authority: quarantine it, rotate the service
storage key and initialize a new empty store through an approved recovery process,
invalidating all auth/challenge/join authority. External monotonic backup rollback
detection is future work. Normal SQLite restart and worker concurrency are tested;
power-loss/COMMIT fault injection is not. Independent clients still verify chain
terms; persistence cannot authorize money.

## HTTP handlers and activation boundary

`createCommerceHandler` is the tested Fetch Request/Response adapter with injected
domain dependencies. `createCommerceService(path,key,origin,initialize=false)` is
the production composition: real verifier + durable stores + pinned pilot reader,
with authenticationAccepted hardcoded false. No environment/client switch enables
it. Thus production challenge/login/protected routes explicitly refuse, including
stored sessions. The legacy refusal-only `http.mts::handle` remains unchanged.
Tests accept the composition capability only with disposable fixture dependencies;
never wire those dependencies into a public app or reuse test databases.

No network listener, TLS termination, proxy/IP trust configuration or HTTP hosting
is supplied/deployed. Adapter caller must provide a trusted peer identifier; never
copy an untrusted forwarding header into trustedClientId. Each request is rate
limited at 60/minute per peer and authenticated account; challenges at 5/minute
per account. Rate state is durable and capped at 2000 scopes. Bodies are strict
duplicate-aware JSON, maximum 8192 bytes, with a two-second read timeout. Session
resource caps remain enforced. Slow/unknown errors refuse service.

All URLs must match exact configured HTTPS origin; queries/fragments are rejected.
POST requires exact Origin; mismatching Origin or cross-site Fetch Metadata fails.
Cookies use __Host- prefix, Path=/, Secure, HttpOnly and SameSite=Strict; no Domain.
Every authenticated POST also needs X-CSRF-Token. Login challenge/verification use
exact Origin plus a separate HttpOnly browser-binding cookie and signed state.
No CORS allowance, bearer URL tokens, raw error logging or secret logging exists.
Every response has no-store, no-referrer and nosniff. No request logger is installed.

## Exact implemented interface (enabled only in accepted test composition)

All paths below are under `/api/v1`; JSON rejects unknown/duplicate fields.

| Method/path | Request | Success body |
| --- | --- | --- |
| POST auth/challenges | {accountId} | Challenge object described below |
| POST auth/verify | {challengeId,signed:{accountId,publicKey,signature,state}} | {accountId,csrfToken,network:"near-testnet"} |
| GET auth/me | session cookie | {accountId,csrfToken,network:"near-testnet"} |
| POST auth/logout | {}, CSRF | {loggedOut:true}, cookie cleared |
| GET merchants/:accountId | exact account ID | currently 404 MERCHANT_NOT_FOUND |
| POST sessions | {}, CSRF, Idempotency-Key | {session,joinToken} |
| POST sessions/:id/bind | {intentId,termsHash}, CSRF, Idempotency-Key | shared HandshakeSession |
| POST sessions/:id/join | {joinToken}, CSRF, Idempotency-Key | shared HandshakeSession |
| POST sessions/:id/review | {termsHash}, CSRF, Idempotency-Key | shared HandshakeSession |
| POST sessions/:id/presence | {connected:boolean}, CSRF | shared HandshakeSession |
| POST sessions/:id/close | {}, CSRF | shared HandshakeSession |
| GET sessions/:id | authenticated participant cookie | shared HandshakeSession |
| GET sessions/:id/events | cookie, optional Last-Event-ID decimal header | {reset:boolean,events:SessionEvent[]} |

Challenge body has id, accountId, network:"near-testnet", purpose:"merchant-login",
origin, recipient, nonceBase64, state, expiresAtMs and message. It sets the
__Host-taply-browser cookie for 120 seconds. Wallet signMessage uses the exact
returned message, recipient and decoded 32-byte nonce. It must not reconstruct
message JSON. Verify sets __Host-taply-session for 900 seconds and clears browser
cookie. Signed result must not be put in query parameters. Numeric expiresAtMs
is an off-chain auth lifetime, not a chain amount/timestamp schema change.

Example accepted test composition flow:

```text
POST auth/challenges {"accountId":"alice.testnet"} with exact Origin
wallet.signMessage({message:c.message,recipient:c.recipient,nonce:decodeBase64(c.nonceBase64)})
POST auth/verify {"challengeId":c.id,"signed":walletResult} with browser cookie
POST sessions {} with session cookie, X-CSRF-Token and Idempotency-Key
merchant signs a NEW compatible on-chain request outside this service
POST sessions/:id/bind {"intentId":"...","termsHash":"..."}
customer independently logs in; POST join {"joinToken":"..."}
each client independently reads chain terms and calculates shared comparison code
each POST review {"termsHash":"..."}; read snapshots/events as hints
```

The on-chain step above is unavailable on the approved pilot. Production's
readCanonicalRequest always refuses bound usage; no downgrade to ordinary Instant
Pay. Merchant profiles have no signed publishing implementation and return no
fabricated identity. Unimplemented routes/refused capabilities return 503
VERIFICATION_UNAVAILABLE; missing profiles return 404. Stable ApiError envelopes
use errors.CODE translation keys, sanitized details, 401 for auth, 403 for
CSRF/authorization, 429 rate limit and 400 invalid input. Errors involving unknown
payment execution use WAIT_AND_RECONCILE, never permission to pay again.

Events use bounded authenticated JSON polling, not SSE. There are no long-lived
subscriptions/buffers. Last-Event-ID is a non-secret cursor header; reset requires
snapshot refetch. UI must deduplicate/reorder by eventId and fetch chain proof.
No endpoint can return VerifiedReceipt or mark a payment Paid from session state.

## Exact verification evidence and remaining gates

Executed: `node --test apps/api/test/*.test.mts` — 35/35 passed; API strict
typecheck and ESLint passed using the existing installed tooling. Commands:

```text
node packages/shared/node_modules/typescript/bin/tsc -p apps/api/tsconfig.json
node apps/web/node_modules/eslint/bin/eslint.js --config apps/api/eslint.config.mjs apps/api/src apps/api/test
pnpm check
```

Full pnpm check exited 0: brand/build/typecheck/lint; shared 92/92, near-client
158/158, web 515/515. API runs separately because no workspace/root manifests were
changed. Total observed: 800 passing tests across these commands. No Rust tests
required/run: no contract code changed. No dependencies/lockfile modifications.

The two-client test adapts shared fixture A to Instant mode and this generated
session, with recomputed canonical hashes. It exercises real off-chain crypto,
synthetic finalized key/request evidence, durable auth/session records, exact
cookie/CSRF HTTP handlers, comparison/reviews/presence/close, refusal of client
paid fields and absence of payment finality from events. This is not wallet UI,
network E2E, real NEAR association evidence or a live merchant sale.

Still required for activation: actual target-wallet NEP-413/callback tests; secure
host/key/recovery configuration and resource/load review; signed merchant profile
publishing; frontend cookie/CSRF/callback integration; new separately reviewed
contract and adapter/deployment (outside authorization here); real two-device
chain/payment verification evidence. Keep merchant/Handshake/Protected flags OFF.
Account control never means legal business verification/KYC.
