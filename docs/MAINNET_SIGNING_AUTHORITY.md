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
