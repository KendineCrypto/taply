# Phase 4A wallet core — signing disabled

The external NEAR Connect / Meteor-backed adapter remains the default. No
customer identity or key is migrated from it. `createTaplyWalletController` is a
separate, opt-in library integration seam, compatible with `WalletAdapter` and
the existing `WalletProvider` injection point. No UI component/style was changed.

## Implemented and tested

| Capability | Actual behavior |
|---|---|
| Local Ed25519 generation | Browser Web Crypto `generateKey`; native implementation, no custom cryptographic primitive. Produces a local 64-hex native NEAR implicit identity. No account/faucet/transfer RPC. |
| Account lifecycle | `NOT_CREATED`, `LOCAL_ONLY`, `PROVISIONED`. Provisioned requires synced Testnet genesis, final account state and the matching FullAccess public key at the same block. Missing account never becomes a fabricated zero balance. |
| Encrypted vault | AES-256-GCM, random 16-byte salt and 12-byte IV, PBKDF2-HMAC-SHA256 at 600,000 iterations. Version/network/algorithm/public key/account/KDF parameters are authenticated. Browser creation/import requires an exclusive Web Lock to prevent cross-tab overwrite races. |
| Unlock and lock | Explicit passphrase unlock; nonextractable private CryptoKey in memory only. Five-minute maximum unlock, page hide/background, storage change, disconnect and disposal lock. Reload starts locked. A lock during pending unlock prevents resurrection. |
| Recovery | Export/import **encrypted backup only**; authenticates/decrypts, verifies private/public key correspondence using a local random challenge, refuses overwrite, restores locked. No seed/plaintext-key import or password-reset service. |
| Finalized balance | Chain reader returns exact liquid amount, storage usage, live storage price/gas price and final-block provenance. Reads can be refreshed without unlocking. |
| Native send preparation | Testnet/implicit address syntax, receiver existence, exact decimal/yocto conversion, positive u128 amount, self-send refusal, available-balance/storage/gas reserve. Immutable review data. No signing/submission. |
| Receive | Exact public account ID plus QR matrix/payload via the existing QR encoder; local-only provisioning label retained. QR presentation itself does not create/fund an account. |
| Replay foundation | Persistent public attempt journal. Unknown/reserved/submitted attempts block later spends across reloads. No elapsed-time reset or hash replacement. Not wired to a transaction backend yet. |
| Payment integration seam | Implements existing `WalletAdapter`; payment schemas/state machine/contract/verifier unchanged. All signing calls fail closed. |

## Explicitly not implemented / not demonstrated

There is **no independent NEAR transaction signer/submission backend** in this
delivery. The proposed maintained SDK is `near-api-js` **7.4.0**, whose pinned
registry metadata and source/declarations were inspected. Adding it requires a
`pnpm-lock.yaml` change; approval was requested under AGENTS.md and was not
received during implementation. No root manifest or lockfile was changed.

Consequently transaction confirmation UI, SDK transaction serialization/signing,
one-shot broadcast, transaction-hash reconciliation and FINAL native-transfer
outcome are pending. The journal alone is not a working submission engine. No
account was created, funded or imported from a real user's wallet. No Taply-local
wallet has been proven on-chain; no Taply payment has occurred.

`TAPLY_WALLET_SIGNING_ENABLED` is a hard-coded false constant. The production
adapter has no reachable signing/transport implementation; vault unlock does not
enable signing. The vault exports no generic raw-signing API. Existing Instant
Pay flag defaults remain off, and no local env was read or modified. Never set an
env flag and claim the independent wallet is ready.

## Security decision and remaining approval gates

Use native Web Crypto for key generation, encryption and KDF; no mnemonic/custom
KDF/handwritten Ed25519. PBKDF2-SHA256's 600,000 iteration parameter follows the
[OWASP guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
The browser must provide secure-context Ed25519 and AES-GCM/PBKDF2 APIs; unsupported
browsers fail closed, retaining the external wallet fallback. See the native
[deriveKey API](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey).

Passphrases require at least 16 characters and at most 1024 UTF-8 bytes. Use a
strong unique passphrase. Encrypted backups expose public identity and permit
offline password guesses; they are sensitive and must not be committed/logged.
All storage is explicit caller-provided local storage; only ciphertext/public
metadata is written. Passwords and decrypted PKCS8 buffers are never persisted;
temporary byte buffers are overwritten. JavaScript strings/CryptoKeys are managed
memory, so guaranteed erasure of every runtime copy is not claimed.

AES-GCM protects storage at rest, not a malicious same-origin script, extension
or compromised build while the vault is unlocked. Browser XSS/CSP, wallet-iframe
isolation, dependency review, secure recovery UX and browser/mobile compatibility
need human security review before enabling a signer. This is not audited or
suitable for real funds. No backend, telemetry or recovery custodian holds keys.

The gas reserve is deliberately conservative: 300 Tgas at twice the observed
price, separate from runtime storage and the exact transfer amount. It is a
spending restriction, not a predicted fee. Source accounts must have the exact
FullAccess key; function-call/gas-key modes and account creation are unsupported.
Receivers must already exist, so send cannot silently provision an account.
Named `.near` accounts and non-native implicit formats are excluded.

## Next SDK integration requirements

1. Obtain SDK/lockfile approval and pin `near-api-js@7.4.0`; preserve existing pins.
2. Use its `Signer` / `createTransaction` / `actions` interfaces. Reuse the existing
   `prepare*` payment helpers; allow only the approved contract + methods, exact
   arguments, gas and deposits. No arbitrary contract/key/account actions.
3. Verify synced Testnet genesis, source FullAccess key, final nonce, receiver,
   balance/storage/gas and approved contract code before **every** approval.
   Bind a short-lived immutable review to account/receiver/action/amount/network.
4. Require explicit confirmation, unlock and a cross-tab Web Lock. Persist the
   locally computed transaction hash **before** broadcasting; refuse when storage
   or the lock is unavailable. Never sign/broadcast during restoration or polling.
5. Submit exactly once. Source inspection found SDK `JsonRpcProvider` defaults to
   retries; in 7.4.0 `retries` counts total attempts, so one attempt is `retries: 1`,
   **not 0**. Test the actual fetch count, timeouts, redirect policy and unknown
   outcomes. Do not use `Account`'s nonce retry convenience path.
6. Reconcile only the same signed hash using FINAL receipt evidence. Missing hash,
   timeout or page close never authorizes another native send. Keep contract
   Paid-per-contract separate from independently Verified Paid.
7. Validate SDK signatures locally against disposable test keys, then obtain
   separate approval for real Testnet provisioning/signing/funding. See official
   [SDK release](https://github.com/near/near-api-js/releases/tag/near-api-js%407.4.0)
   and [NEAR API documentation](https://docs.near.org/tools/near-api).

## Manual Testnet acceptance checklist (human approval required)

- Verify external Meteor-backed wallet connection/balance still works; keep all
  local and Instant Pay signing gates off.
- After a reviewed Claude UI integration, explicitly generate a dedicated local
  Testnet identity. Confirm it says LOCAL_ONLY and offers only an encrypted backup.
- Reload, use a wrong passphrase, import a damaged backup, lock/background the
  page and restore on a fresh browser profile. It must never silently unlock.
- With separate provisioning/funding approval, activate that dedicated implicit
  Testnet account externally; refresh and verify matching key/final balance and
  exact account QR. Do not assume local generation created the account.
- Review 0.1 NEAR to an existing second Testnet account; verify exact yocto amount,
  sender/receiver/network/storage/gas reserve and insufficient-balance refusal.
- Stop here for this delivery. Actual send, signature, ambiguity/FINAL and the
  same Instant Pay state-machine acceptance require the SDK backend, tests and
  new human approval. Retain the functioning external-wallet fallback.

Tests: root `pnpm check`; focused `pnpm --filter @taply/web test -- src/lib/wallet`
and `node --test packages/near-client/test/wallet*.test.mjs` after package builds.
Tests generate disposable in-memory keys only; they never create chain accounts
or sign/broadcast NEAR transactions.
