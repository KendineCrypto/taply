# Phase 5 signing authority — development handoff

Base: `3a186a790ffd8e07dd9406068c18dccd9083c7cc`.
Branch: `codex/mainnet-signing-authority`. **NO-GO for real funds.**

## Authentication contract

`apps/api/src/mainnet-authenticated-authority.mts` exports
`createAuthenticatedMainnetAuthority`, `MainnetAuthorityCommand` and
`MainnetAuthorityChallenge`. Only server configuration selects account, Mainnet
profile/code pins and persistence. Commands are `read`, `reserve`, `handoff`,
`uncertain`, `reconcile`; reserve/handoff/uncertain argument tuples match
`MainnetWalletAuthority`. No client principal, arbitrary transaction, terminal
proof, clearing or takeover endpoint exists.

Every command requires a new server-generated NEP-413 challenge binding account,
FullAccess public key, Mainnet, exact origin, device, command digest, policy digest,
nonce and two-minute expiry. The challenge is consumed durably before signature
verification or RPC. Verification checks finalized Mainnet genesis/account/key
permissions and recent chain timestamp. A lost response never permits replay.
Obtain a fresh authorization to **read/reconcile**, never blindly repeat payment.

`createMainnetAuthorityHttp` is an **unmounted** Fetch adapter. Existing production
refusal routes remain unchanged. POST `/api/mainnet/authority/challenge` accepts
`{publicKey,command}`; execute accepts `{id,command,signed}`. `signed` contains only
`accountId,publicKey,signature`. No callback URL is signed/supported. The browser
must use the exact returned message, recipient and decoded 32-byte nonce.
NEAR Connect 0.12 `signMessage` compatibility was checked against installed types;
physical wallet acceptance is unproven. Wallets which change the payload or add a
callback URL are unsupported until explicitly integrated and tested.

The server sets `__Host-taply-mainnet-device` Secure/HttpOnly/SameSite=Strict.
Device IDs are server-generated; possession of a supplied ID is insufficient.
The first authenticated enrollment owns writes; later devices can authenticate to
read/reconcile but cannot reserve or hand off. No ownership transfer/reset is
implemented. This is a browser credential, not hardware/device attestation.
Cookie theft plus wallet-key compromise defeats this boundary; XSS remains a risk.

All requests require the exact Mainnet Origin, JSON POST, no query credentials,
bounded 64 KiB streaming body and three-second body deadline. The mandatory
limiter runs before body/RPC; its Redis implementation enforces global/IP/account
budgets. Trusted IP must come from reviewed infrastructure, not arbitrary forwarded
headers. Redis never reaches the browser.

## Durable authority and controlled recovery

`createFencedMainnetRedisPersistence` takes an independent `FreshnessAuthority`.
The witness must be permanent, linearizable and outside Redis's restore/admin
domain. A second Redis key or replica is NOT independent rollback protection.
Both initial records must be provisioned deliberately; requests never initialize
missing storage. `initialMainnetAuthorityState` creates provisioning data only.

Scope: `taply.mainnet.authority:<account>`; Redis key:
`taply:mainnet:authority:v1:<account>`. Canonical record:
`{epoch:64hex,revision:decimal,payload:canonicalStateJson}`. The witness receives
`authorityAnchor(account,record)`. Auth, enrollment and wallet ledger share this
record; every mutation uses witness CAS followed by exact Redis Lua CAS without
TTL. A crash between commits blocks the account. An acknowledged Redis rollback,
eviction, TTL or missing witness fails closed. Recovery may restore only the exact
payload matching the existing witness; no witness reset or automatic rollback is
allowed. No automated recovery/admin endpoint is supplied.

The independent production witness/provider and its operational security review
remain **unsatisfied release requirements**. Mock witness tests do not establish
production durability. Record size is bounded by strict JSON limits; capacity
failure blocks, never prunes operation tombstones. Challenges can expire; attempts
and ownership do not. Device enrollment is bounded to 16; challenges to 32.

## Unchanged settlement and release boundaries

Server reserve reconstructs every operation from fresh pinned chain data.
Reconciliation independently verifies FINAL execution with exact signer/key,
nonce/actions and complete graph. It never establishes settlement by itself.
R-2 remains possible: successful payout with missing/failed callback cannot be
retried or administratively called successful. Existing independent settlement
readers require matching successful callbacks and ordered retry histories.

`intentsRouter:false` and every signing, funded-quote and public receipt release
gate remain false. Sandbox gas measurements do not prove the actual Intents/USDC
router execution envelope. No transaction, deployment, account funding, access-key
change or hosting action is performed by this work.

## Evidence status

Initial local strict API types/lint and five adversarial test groups pass. These
use disposable off-chain signatures, synthetic RPC and an in-memory witness; they
are not real Mainnet signing or physical wallet evidence. Final tests and exact CI
SHA must be reported separately. Full functional parity and release are not yet
proven; UI migration, production witness, physical wallet acceptance, approved
contract configurations and actual authorized Mainnet end-to-end evidence remain.

## Completed integration interfaces

`MainnetAuthorityCommand` and `MainnetAuthorityChallenge` are now also exported
from `@taply/near-client`. `mainnetAuthorityMessageParameters(challenge,expected)`
validates the intended command, exact account/key and locally trusted policy hash
before constructing NEAR Connect 0.12 `signMessage` parameters. Never just copy
the server's policy hash into expected configuration. Client/server NEP-413 bytes
are compared in tests.

`EncryptedMainnetVault.authorizeAuthorityCommand(...)` and
`authorizeMainnetNearConnectCommand(...)` implement fixed-purpose authorization
with confirmation and expiry/identity checks. Both reject under the closed signing
gate. There is no arbitrary raw-message signer.

The additional command `bindCommerce` takes `[kind,draftTerms,session]`.
Authenticated merchant and owner device freeze exact terms and session identity
in witnessed storage. Conflicting reuse of a session ID fails; identical reuse
after fresh authorization returns the same commitment. Pass its terms to the
reviewed instant/escrow creation operation, then read the actual contract request.
This is not a deployed registry or payment status. Join/presence tokens stay out
of public commitments. The full live-session UI/service migration remains Claude
integration work; this phase implements its authenticated immutable binding.

`createMainnetProtocolVerification(profiles).commerce(...)` reads the pinned FINAL
request and checks the payer-reviewed hash. Its `receipt` dispatcher covers
native, USDC, instant/escrow, Gift and retry-history readers. Pins come from server
configuration. The browser's independent reader remains required for public
verification labels; a server response or socket event never substitutes for it.

The internal handoff sequencer is now separately tested with inert callbacks.
Fourteen cases cover internal/external hash conventions, rejection, lost response,
RPC ambiguity, Redis failure and lost acknowledgements. It persists handoff before
sending and always returns unresolved until reconciliation. No release gate is
overridden in these tests. Nine API test groups cover disposable cryptographic
authorization, replay, devices, merchant bindings, rollback and HTTP bounds.
Real Redis tests additionally cover witnessed CAS, rollback/deletion, rate limits
and AOF process-kill/restart. Local Windows lacks Redis: Linux CI must run these.
Policy tests retain native, USDC, request, Protected and Gift coverage and add exact
USDC transfer-call message checks. Physical signing acceptance is still separate.

Subsystem `736868fd6bbee015c9b1eb4c21065cca36216924` passed
[Workspace CI](https://github.com/KendineCrypto/taply/actions/runs/43490535155).
This does not certify later changes. Final CI must match the delivered SHA.

## Router and R-2 reassessment, 2026-11-13

The [published FtWithdraw interface](https://near.github.io/intents/defuse_core/intents/tokens/struct.FtWithdraw.html)
documents configurable `min_gas`, a 50 TGas default for the token transfer-call
and distribution of remaining gas across promises. That is an outer token-call
allocation, not a Taply receiver gas guarantee. It does not bind the deployed
router/token versions, solver-selected values or a Taply quote.
The [withdrawal documentation](https://docs.agentsonintents.com/integration/verifier-contract/deposits-and-withdrawals/withdrawals)
warns that using `msg` does not have simple-transfer refund protection. Returned
tokens must not be represented as a customer refund.

Release requires actual finalized graphs for configured router/USDC deployments,
receiver gas across adversarial paths, a supported upstream gas/refund commitment,
quote-to-delivery attribution and proof of recovery/refunds. No live Taply delivery
was performed. R-2 remains contained by refusing unknown-callback retries. Wallet
execution reconciliation cannot repair the unresolved contract obligation.

## Remaining release requirements

1. Independently provision and review the monotonic witness, Redis durability,
   no-eviction, backup and controlled recovery. No production witness is supplied.
2. Review device loss/revocation/takeover and bounded-history archival. There is
   no automatic reset or safe takeover; lost credentials currently block writes.
3. Integrate the unmounted HTTP adapter, trusted-IP extraction and browser flow;
   assess CSP/XSS, cookie isolation and complete transaction confirmations.
4. Physically test supported NEAR Connect wallets and internal vault recovery,
   nonce behavior and uncertain outcomes under a separately authorized plan.
5. Approve Gift/escrow accounts, limits and code pins; obtain authorized end-to-end
   payment/refund/receipt evidence and resolve or explicitly accept R-2 exposure.
6. Owner separately authorizes release gates and deployment/funding operations.

**NO-GO for real funds and a claim of complete functional parity.** No contract
code, Testnet behavior, production route, workflow gate or hosting setting changes.

### External lost-response ambiguity

Phase 5 additionally refuses terminal reconciliation when an external attempt has
neither an exact reserved nonce nor a retained transaction hash. A later manual
hash could identify another transfer with identical terms, while the original
attempt remains live. The account stays blocked; timeout/nonce advancement cannot
clear it. Internal exact-nonce attempts and already-retained external hashes still
require complete independent FINAL evidence. Do not use `uncertain` to inject a
manually guessed hash as a workaround. A reviewed wallet-specific recovery protocol
is required for external responses lost before hash persistence.

CI on `b6e1881cfcabfc4e0d814cbb5e8b41d12faaf3a2` passed Workspace (93 shared,
338 client, 85 API including real Redis) and browser gates. Its first Mainnet
protocol run failed before sandbox execution because near-workspaces 0.24.0 could
not download the binary (`DownloadError("timeout: connect")`); the failed job was
rerun unchanged. This infrastructure failure was not bypassed or labelled success.
The later reconciliation hardening requires a new final exact-commit CI run.
