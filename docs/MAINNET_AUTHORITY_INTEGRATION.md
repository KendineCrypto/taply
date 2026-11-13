# Mainnet signing-authority integration (application side, phase 6)

Branch `claude/mainnet-phase6` → `claude/festive-brahmagupta-qkqex1`. Protocol:
[MAINNET_SIGNING_AUTHORITY.md](MAINNET_SIGNING_AUTHORITY.md) (Codex `850080d`).
**NO-GO for real funds.** No production endpoint, no witness, no signing.

## What the app does

| Piece | Implementation | Codex interface used |
| --- | --- | --- |
| Authority client | `apps/web/src/lib/mainnet/authority-client.ts` implements `MainnetWalletAuthority` over the HTTP API: `POST challenge {publicKey, command}` → wallet authorization → `POST execute {id, command, signed}`; plus `bindCommerce`. Validates every challenge (`mainnetAuthorityMessageParameters`) against the exact command and a **locally computed** policy hash before any wallet prompt. Holds no ledger, CAS, Redis or raw signer. | `MainnetAuthorityCommand`, `MainnetAuthorityChallenge`, `mainnetAuthorityMessageParameters` |
| Taply Wallet authorization | `vaultAuthoritySigner` → `EncryptedMainnetVault.authorizeAuthorityCommand(challenge, command, policyHash, confirm)` | vault method (gated) |
| External wallet authorization | `nearConnectAuthoritySigner` → `authorizeMainnetNearConnectCommand` with NEAR Connect `signMessage` (wallets that do not report the account key are unsupported) | NEAR Connect wrapper (gated) |
| Transactions | `createMainnetWalletBackend({ authority })` with the HTTP authority: Codex's planner, reserve-before-handoff (`executeReservedMainnetHandoff`), uncertain outcomes, FINAL reconciliation and tombstones run unchanged | backend, coordinator, planner |
| Device | Server-issued `__Host-taply-mainnet-device` (Secure, HttpOnly, SameSite=Strict); the browser never reads it; device id taken from the server's challenge | `createMainnetAuthorityHttp` |
| Merchant sale | Local `bindMainnetCommerceTerms` + authority `bindCommerce` freeze (status shown: frozen / gated / unavailable / mismatch); payer compares the FINAL request with the reviewed hash | `bindCommerce`, `verifyMainnetCommerceBinding` |

## Modes (build-time, Mainnet builds default every flag to `off`)

- **unavailable** (default, every real build): exact reviews only; nothing reservable.
- **isolated-http** (`NEXT_PUBLIC_TAPLY_MAINNET_AUTHORITY=isolated-http`): the client
  above. **Refused on Production** by `scripts/check-mainnet-env.mjs`. The Next app
  has **no** authority route; a real deployment answers 404 → fail closed. Tests serve
  the endpoint from the TEST harness only.
- **simulated** (phase 5 test harness): unchanged, refused on Production, and now
  compiled out of every other bundle (CI greps plain, authenticated and phase 2–4
  bundles).

Fail-closed rules: endpoint missing / 5xx / refusal → review labelled "not reachable";
challenge for another command, account, key or policy → refused before the wallet is
asked; closed signing gate → review labelled "wallet authorization disabled"; any
unknown outcome blocks; a lost transaction hash is never a failure; no automatic retry,
reset or device takeover exists anywhere in the app.

## Evidence (classes kept separate)

- **Integration (Node, real Redis, IN-MEMORY TEST WITNESS, synthetic chain):**
  `apps/web/scripts/mainnet-authority-integration.test.mts` drives the app's client
  against Codex's real `createMainnetAuthorityHttp` → `createAuthenticatedMainnetAuthority`
  → `createFencedMainnetRedisPersistence`. Wallet authorization uses a TEST-ONLY
  disposable key with exactly Codex's NEP-413 bytes (the app has no such signer).
  Covers: per-command challenges, HttpOnly device enrollment, single use / replay,
  forged signature, local policy pinning, first-device ownership and read-only second
  device (no takeover), reserve → handoff → lost response → durable UNCERTAIN →
  blocks → FINAL reconciliation (settlement NOT established) → permanent replay
  refusal, external hash lost before persistence stays blocked even with a matching
  hint, merchant session ↔ immutable terms (same / changed amount / changed merchant /
  repeated creation / invalid commitment / different request), Redis rollback behind
  the witness fails closed, unprovisioned accounts never self-initialize, no TTL.
- **Real browser at `https://mainnet.taplyapp.xyz`** (`scripts/mainnet-phase6-qa.mjs`,
  same harness): challenge issued and validated, wallet refused at the gate, cookie
  attributes, no executed command / ledger / enrollment server-side, policy mismatch,
  503 and missing endpoint, no app-server authority route, no Redis surface, sale
  freeze status, no simulated authority in the bundle, no wallet prompt shown.
- **Codex's own tests** (API 85 incl. real Redis witnessed CAS, rollback/deletion,
  AOF process kill/restart; near-client 338 incl. 14 handoff cases) run unchanged.
- **Not covered and cannot be while gated:** a real wallet signing an authority
  command in the browser, a physical NEAR Connect wallet, any Mainnet transaction.

## Unresolved production witness requirements (owner/Codex)

1. A permanent, linearizable `FreshnessAuthority` outside Redis's restore/admin domain,
   with its own security review. The in-memory test witness is not one, and neither
   is a second Redis key or replica.
2. Durable Redis: no eviction, AOF/fsync policy, backups whose restore can never
   precede the witness head; deliberate per-account provisioning of both records.
3. A reviewed mounting of the HTTP adapter: trusted-IP extraction from reviewed
   infrastructure, Redis rate-limit budgets, CSP/XSS review, cookie isolation, and
   **multi-account routing** (Codex's service is configured per account; the test
   harness routes by public key / challenge id — that glue is test-only).
4. A complete confirmation UI for authority commands (the app shows a minimal
   confirmation; it is unreachable while the gate is closed).

## Device loss and recovery limitations

- The first authenticated device owns writes for the account; later devices can read
  and reconcile but never reserve or hand off. There is **no** ownership transfer,
  reset or takeover. Losing the owner device's cookie (cleared storage, lost phone)
  blocks new payments for that account until a reviewed recovery procedure exists.
- Device credentials are browser cookies, not hardware attestation: cookie theft plus
  wallet-key compromise defeats the boundary; XSS remains a risk.
- At most 16 enrolled devices and 32 pending challenges per account; the ledger keeps
  at most 256 tombstones, after which writes block until audited archival exists.
- An external-wallet attempt whose response was lost before its hash was stored stays
  blocked permanently under the current protocol (a wallet-specific recovery protocol
  is required); internal-vault attempts reconcile from their pre-computed hash.

## Remaining Mainnet contract deployment requirements (owner)

Read-only Mainnet (phase 5 evidence, re-checked): `taply-pay.kendinecrypto.near` does
not exist. Required before any real payment: deploy and pin the instant-payment
contract; approve Gift and escrow accounts, limits, fees and code pins; approve the
USDC code pin; provision the Mainnet Upstash database and the witness; then separate
signing, funded-quote and verifier release reviews. R-2 (successful payout with a
missing callback) and the Intents router gas/refund attribution remain open.
