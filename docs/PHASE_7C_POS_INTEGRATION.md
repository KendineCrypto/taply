# Merchant POS integration contract — Phase 7C.1

This guide targets Claude's Merchant Hub/POS/Checkout/scanner/demo and gated live
Handshake without assuming those new files are in this worktree. No frontend
files, feature flags or production gates were modified. Use shared v1 schemas;
this is not a competing payment protocol. Production service refuses authentication
and protected routes today. Test integration is synthetic and must be labelled so.

## Base URL, HTTPS and cookies

Use a same-origin base `/api/v1` behind a trusted adapter/reverse proxy. There is
no currently supplied API server/listener or live base URL. If frontend introduces
an API-base setting, treat the name as a new frontend-owned configuration choice,
not an existing env variable. Require its origin to equal window.location.origin.
Backend origin must equal that exact HTTPS origin, including port and excluding
trailing slash. A different API origin or port does not work: CORS is not enabled.

For a future local network test, use trusted local HTTPS for the shared hostname,
with certificates trusted by both phones and the development computer. Forward
/api/v1 internally to the Fetch adapter; do not change Origin or trust arbitrary
X-Forwarded-* headers. The launcher supplies a validated peer ID. Secure cookies
cannot be made functional by turning Secure off. Do not expose a synthetic-auth
test composition on LAN/public hosts; no such listener was started here.

Use fetch credentials:"same-origin" and cache:"no-store". Browser stores only
__Host-taply-browser and __Host-taply-session cookies, HttpOnly Secure
SameSite=Strict, Path=/, no Domain. Never copy cookie values into frontend state,
localStorage, URLs, QR, logs or analytics. CSRF token from successful auth/me or
verify can be kept in ephemeral memory; send X-CSRF-Token on every authenticated
POST. Browser sends exact Origin; do not attempt to set/forge it in app code.
POST JSON must be duplicate-free/strict, <=8192 bytes; response dynamic data must
not enter the service worker cache. Origin alone is insufficient for auth POSTs.

## Types and examples

Import HandshakeSession, SessionEvent, ApiError, and their runtime schemas from
@taply/shared. The following types describe existing endpoint bodies; they do not
grant authority or change shared schemas:

```ts
type ChallengeInput = { accountId: string };
type AuthChallenge = {
  id: string; accountId: string; network: 'near-testnet'; purpose: 'merchant-login';
  origin: string; recipient: string; nonceBase64: string; state: string;
  expiresAtMs: number; message: string;
};
type SignedEnvelope = { accountId: string; publicKey: string; signature: string; state: string };
type VerifyInput = { challengeId: string; signed: SignedEnvelope };
type AuthResult = { accountId: string; csrfToken: string; network: 'near-testnet' };
type CreatedSession = { session: HandshakeSession; joinToken: string };
type BindInput = { intentId: string; termsHash: string };
type JoinInput = { joinToken: string };
type ReviewInput = { termsHash: string };
type EventPage = { reset: boolean; events: SessionEvent[] };
```

Example request helper (frontend implementation proposal, not code installed here):

```ts
const API_BASE = '/api/v1';
async function post(path: string, data: unknown, csrf: string, key?: string) {
  return fetch(`${API_BASE}/${path}`, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf,
      ...(key ? { 'Idempotency-Key': key } : {}) },
    body: JSON.stringify(data),
  });
}
// After accepted authentication and only in a supported composition:
const response = await post('sessions', {}, csrfToken, crypto.randomUUID());
// Parse response status/errors first, then validate session with shared schema.
```

Creation/bind/join/review keys are 16–128 ASCII alphanumeric/_/-. Persist only safe
operation metadata if retries are needed; never persist the join secret in a
general journal. Reusing one key with another body conflicts. A retry returns its
original response, potentially stale; follow it with a snapshot. A timeout is not
permission to create a new sale. Retention cleanup ends old key validity; do not
replay a previous sale after the session is removed.

## Exact endpoints and sequence

All paths use /api/v1; successful session responses are HandshakeSessionSchema.

1. POST auth/challenges `{accountId}` sets browser-binding cookie and returns
   AuthChallenge. POST auth/verify `{challengeId,signed}` checks proof and sets a
   fresh auth cookie. Returns AuthResult; successful reauth revokes prior presented
   auth cookie. GET auth/me returns AuthResult. POST auth/logout `{}` needs CSRF,
   clears cookie and invalidates pending login authority. Every login account is
   independently verified; a wallet connection is not login.
2. Merchant POST sessions `{}` with CSRF and idempotency returns CreatedSession:
   DRAFT, public ID/nonce/expiry, separate join secret. Merchant ID remains exactly
   near-testnet:{accountId}; checkout route is /checkout/{accountId}.
3. Merchant must separately sign a fresh compatible on-chain request binding that
   exact session ID/nonce/expiry and merchant==creator==receiver. POST
   sessions/:id/bind `{intentId,termsHash}` verifies canonical chain terms before
   OPEN. THIS STEP IS UNAVAILABLE ON THE APPROVED PILOT. Never set null bindings
   or silently create an ordinary Instant request instead.
4. Independently authenticated customer POST sessions/:id/join `{joinToken}`
   consumes join authority and becomes PAIRED. Merchant cannot join as payer;
   canonical payer restriction applies. Both GET sessions/:id for snapshot.
5. Each client independently reads canonical chain request with near-client,
   matches ID/hash/recipient/session, derives shared sessionCommitment and
   comparisonCode, displays exact immutable terms, and requires an explicit review.
   POST sessions/:id/review `{termsHash}` per participant. Both reviews yield
   REVIEWED, which never means payment authorization or Paid.
6. POST sessions/:id/presence `{connected:true|false}` reports presence lease;
   POST sessions/:id/close `{}` is merchant-only. Close/expiry never cancels funds.
   GET sessions/:id/events returns EventPage; Last-Event-ID decimal header is
   optional. No SSE endpoint exists: Content-Type is application/json.

Session lifetime is 120 seconds; presence lease 30 seconds; cleanup removes
records five minutes after session expiry. 64 hints retained. Use event polling
around every six seconds and fetch snapshot on hints/reset, plus idle snapshot
every 30 seconds. Heartbeat about every 15 seconds while route is active. Coordinate
tabs and stagger/back off: peer and account limits are 60 requests/minute, shared
across routes, including two devices on the same NAT. Stop/re-auth on 401, stop
review on expiration. Presence disconnect/reconnect keeps paired identity/review.

Deduplicate by sessionId/eventId and ignore older hints. reset=true requires
snapshot and canonical chain refetch. On disconnect, show coordination unavailable,
not payment failure; chain verification remains independent. Avoid launching
duplicate timers or changing payment actions from socket/poll messages.

## Feature-specific wiring and disabled states

| Frontend feature | Current safe integration |
| --- | --- |
| Merchant Hub | Show exact account; GET merchants/:accountId returns 404; do not show verified business/profile |
| POS | Local synthetic harness can exercise lifecycle; production auth/session requests refuse; no merchant-bound sale |
| Checkout | Account-derived discovery; immutable invoice must be independently read; no profile response may override receiver |
| Merchant QR scanner | Permanent checkout URL is discovery; proposed session join secret stays in fragment, stripped immediately, POST body only |
| Demo Handshake | Explicitly synthetic; fixture codes derive canonical terms; REVIEWED never gets Verified Paid |
| Gated live route | Keep flags OFF; show unavailable prerequisites; do not downgrade to unbound Instant |

The profile API does not publish signed profiles. GET merchants/:accountId is
404 MERCHANT_NOT_FOUND; unsupported profile operations refuse. Account control is
not business identity/KYC. QR formats remain the prior proposal, not enabled live
capabilities. Reject foreign origin, unexpected account/route and query secrets.

Stable ApiError responses carry errors.CODE keys; never display raw server prose.
401 AUTH_* => stop timers, discard ephemeral CSRF, require fresh auth; 403 CSRF =>
refetch auth/me only same-origin, never bypass; 403 NOT_AUTHORIZED => stop role
action. TERMS_MISMATCH/MERCHANT_BINDING_INVALID => block review/payment and explain
exact receiver mismatch. SESSION_EXPIRED/JOIN_TOKEN_USED => stop pairing, never
retry another identity automatically. 429 => pause/backoff all related pollers;
retryAfterMs may be null, so use bounded local jittered backoff. 503
VERIFICATION_UNAVAILABLE => keep unavailable/pending, preserve safe operation ID,
never fabricate profile/auth/chain proof. Unknown money execution requires
WAIT_AND_RECONCILE, never another payment. All dynamic responses are no-store.

Production taply-pay-pilot-1.testnet, approved hash
BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B, rejects non-null merchantAccountId
and sessionBinding. The read adapter always refuses bound use. No upgrade,
deployment, key change or on-chain action occurred in this review.

## Future human-run NEP-413 compatibility checklist

Procedure only: do not run during this task. Requires separate human approval for
off-chain wallet authentication and a reviewed test environment; no payments or
account/key changes are implied. Candidate Meteor/MyNearWallet/other selected
Testnet wallets are UNTESTED, not certified. Check each device/OS/browser/wallet
version independently, including an actual iPhone/Safari wallet return.

Installed SDK inspection: @hot-labs/near-connect 0.12.0 declares signMessage with
message, recipient, Uint8Array nonce, optional network/signerId. Its SignedMessage
has accountId/publicKey/signature; no state/callbackUrl fields. Checked-in Taply
WalletAdapter lacks signMessage. Manifest filters can request signMessage+testnet,
but declarations are not runtime/mobile evidence. Sources:
[SDK reference](https://github.com/hot-dao/near-selector),
[NEP-413](https://github.com/near/NEPs/blob/master/neps/nep-0413.md).

1. Verify selected wallet is actually in Testnet and has off-chain signMessage;
   refuse unsupported wallets without transaction-signing fallback. Do not add a
   function-call key or ask for seed/private-key export. A connect event proves
   neither signature support nor account control.
2. Obtain server challenge; bind its pending ID/account/origin in memory. Send
   exact message/recipient and decoded 32-byte nonce; request explicit Testnet and
   signerId where SDK supports them. Never reserialize message or sign UTF-8 nonce
   text. Display that this proves account control only, not a payment.
3. Handle Promise/injected response or reviewed redirect fragment separately.
   Check exact response shape, requested account, ed25519 public-key identity and
   base64 64-byte signature. Do not assume wallet returned state: for the installed
   SDK a frontend envelope may attach the pending challenge's state because state
   is already inside the exact signed message and independently browser-bound by
   the server. Never synthesize accountId/publicKey/signature or accept a response
   for a different pending challenge. Account arrays need explicit matching, not
   first-account selection.
4. Current HTTP challenge has no callbackUrl. A wallet that inserts a callback URL
   into signed bytes will fail verification; do not try different payload variants
   until one verifies. If required, design explicit server-stored exact callback
   support for /auth/callback and review the adapter before use. Strip returned
   fragments immediately; never put signatures/state in queries/telemetry. Cookie
   behavior after external-wallet return must be tested under SameSite=Strict.
5. Verify backend obtains recent finalized FullAccess key association for the exact
   returned key/account and Testnet genesis. Archive only sanitized pass/fail,
   wallet/version, public account/key, checked block/height and challenge/message
   hashes. Do not archive live signatures, cookie/join/CSRF/state secrets.
6. Negative cases: decline, wrong account, changed amount/message/recipient/nonce,
   callback mismatch, signature/key substitution, expired (>120s) challenge,
   another browser reusing signed result, duplicate verify and RPC outage.
   All must refuse without a session cookie. Successful login must rotate auth
   token/CSRF; old token and post-logout requests fail.
7. Key revocation/rotation: use already authorized operator-provided public test
   evidence or a separately approved dedicated account exercise. No key management
   is performed by this agent. After finalized removal, new login with that key
   must fail; a new associated FullAccess key needs a new challenge. Existing auth
   sessions currently live up to 15 minutes unless logged out; there is no
   continuous key-revocation check. Decide/review this policy before activation.

No step above was executed on an actual wallet. Backend fixtures alone cannot
close this gate. See PHASE_7C_SECURITY_REVIEW.md for remaining rollback/ACL/recovery
requirements before any network or real-G2 integration.
