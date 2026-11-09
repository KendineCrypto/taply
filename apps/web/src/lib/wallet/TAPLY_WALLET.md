# Phase 4C native wallet SDK backend — production signing OFF

Baseline: latest merged feature/frontend `27123b73e6266b5c9011a592c28c0e64eefb0b16`.
The human approved adding exactly near-api-js 7.4.0 and the required package/lock
changes for development only. No real wallet, Testnet signature, broadcast,
account provisioning, funding, contract deployment or activation is authorized
or performed by this work. No Taply payment has occurred.

## Implemented

- Local Web Crypto Ed25519 identity generation, encrypted AES-256-GCM vault,
  PBKDF2-SHA256 (600,000 iterations), authenticated metadata, explicit unlock,
  five-minute expiry, lock on hide/disconnect/storage change, encrypted recovery.
  Generation is LOCAL_ONLY until final Testnet account/key reads prove provisioning.
- SDK Signer delegates to Web Crypto using the nonextractable unlocked key.
  The SDK never receives exported private bytes or a private-key string. No
  generic raw-message signer or CryptoKey is exposed by the public wallet API.
- SDK createTransaction/actions produce exactly one native Transfer, or one
  approved contract call. Native values use exact positive u128 yocto amounts.
  Receivers must already exist. Storage plus 300 Tgas at twice the observed gas
  price are reserved separately; that reserve is not a predicted fee.
- Immutable scalar review contains Testnet, sender/key, receiver, exact deposit,
  method/canonical arguments, reserves, nonce, final block hash and 60-second
  expiry. Explicit confirmation callback; then recheck account/key/nonce/balance,
  receiver, time, contract code/rules and both signing gates.
- Before sending: Web Crypto hashes SDK-serialized unsigned bytes independently,
  verifies SDK hash and Ed25519 signature with both SDK and Web Crypto, and checks
  the decoded signed wire transaction. SDK-decoded arrays are normalized to
  Uint8Array without relaxing signature/action checks. Lock/reunlock invalidates
  the signing lease, including between signing and transport.
- Persist the exact local hash and public unsigned bytes BEFORE SDK transport.
  No private key, passphrase or signed transaction bytes enter the journal.
- One bounded send_tx attempt, wait_until FINAL, no backoff/failover/nonce retry.
  Redirects/credentials are refused; timeout covers response body consumption.
- Unknown results remain blocked across reloads. Reconcile only the same hash
  using SDK receipt-status reads and the existing independent chain reader's
  complete rooted FINAL outcomes and receipt block provenance. Check action,
  amount, account, key, nonce and hash. Stored FINAL markers are rechecked.
- Existing WalletAdapter and WalletProvider injection point are preserved.
  create_request/pay_instant_native/cancel_unfunded/retry_native_transfer reuse
  their existing prepare* functions. Approved contract hash and ABI are unchanged.
  Unknown local hashes survive in the existing payment submission journal.
  Backend execution success is NOT Verified Paid: the existing payout verifier
  still decides that. The default external/Meteor adapter remains unchanged.

## Gates and integration

TAPLY_WALLET_SIGNING_ENABLED is now true for NEAR TESTNET ONLY, by the owner's explicit
decision on 2026-11-09, without an independent security review. Every signature needs an
unlocked vault, a fresh final snapshot and the ConfirmTransactionDialog; curated Ref/Rhea
swap shapes are accepted only through checkedSwapTransaction (near-client). Contract calls additionally
require the existing Instant Pay flag and an explicit confirmation callback.
Neither vault unlock, storage/query values nor env values bypass the local gate.
No Claude-owned UI component/style was modified. UI confirmation wiring and real
wallet acceptance require human review before activation.

createTaplyWalletController exposes prepareTransactionReview, confirmAndSend and
reconcileTransaction for the existing UI to consume after review. Its adapter
uses the same backend for contract calls. Creation/import and submission share
an exclusive browser Web Lock; absent Web Locks or secure-context crypto fail
closed. Low-level backend tests inject a simulated approval/lock policy and fake
RPC; those are test dependencies, not runtime feature flags.

## Security limits

Encrypted vaults protect keys at rest, not a malicious same-origin script,
extension or compromised build while unlocked. XSS/CSP, dependency/build review,
wallet iframe isolation and recovery UX still need security review. This is not
an audit or approval for real funds. Temporary PKCS8/password byte buffers are
wiped; guaranteed erasure of JavaScript strings/CryptoKeys is not claimed.

Use a strong unique passphrase (minimum 16 characters, maximum 1024 UTF-8 bytes).
Backups expose public identity and allow offline password guesses: never log,
commit or send them to a backend. Restore authenticates/decrypts and verifies
private/public correspondence with a local challenge, refuses overwrite, and
starts locked. No plaintext/seed import or password-reset custodian exists.

Only Testnet genesis, named .testnet/native implicit accounts and FullAccess
Ed25519 keys are supported. No account creation, gas keys, key management,
relayer, FT, arbitrary contract action or Mainnet path exists. Source SDK code
was inspected: JsonRpcProvider defaults to retrying, and retries counts total
attempts in 7.4.0. Our provider sets one attempt and overrides sendJsonRpc with
its checked one-shot transport. SDK Account convenience retries are never used.

Trust is configured RPC, not a light client. Web Locks/journal do not coordinate
other devices or external wallets sharing a key. Missing/pruned history stays
unknown. A legacy RESERVED record without a hash stays blocked. Do not clear
storage or create a new intent to escape an unresolved spend. Contract callback
stall and retained upgrade-authority limitations remain unchanged.

## Tests and browser compatibility

Run pnpm check from the repository root. Focused tests:

    node --test packages/near-client/test/wallet-signer.test.mjs packages/near-client/test/wallet-payment-signer.test.mjs
    pnpm --filter @taply/web test -- src/lib/wallet src/lib/payments

Tests use disposable in-memory keys and synthetic transactions/fake RPC only;
they never access a real wallet or broadcast to NEAR. Covered: success, explicit
decline, timeout, HTTP/RPC failure, stale nonce, duplicate/concurrent submission,
locked/relocked vault, expiry, insufficient funds, key/signature mismatch,
storage failure, action forgery, wrong network and same-hash reload reconciliation.

wallet-browser-check runs Chromium, Firefox and WebKit desktop plus Chromium
and WebKit mobile emulation. It tests the actual encrypted vault, nonextractable
SDK signer, independent hash/signature validation, recovery, locks and zero private
exports. All non-local requests are blocked; memory storage is used. Isolated
pinned Playwright 1.64.1 lives in runner temp, not workspace dependencies. Run
node packages/near-client/browser-tests/run.mjs with TAPLY_PLAYWRIGHT_MODULE
pointing to that tool's index.mjs. Browser-engine emulation is NOT a physical
Android/iOS device test; chosen production devices remain a manual acceptance gate.

## Short manual acceptance checklist (new human approval required)

1. Keep local/Instant signing OFF. Confirm the external Meteor connection and
   finalized balance still work. Review the source/CI and compatibility results.
2. Wire the existing UI to immutable reviews and explicit confirmation. Generate
   a dedicated local identity, save an encrypted backup, reload, use wrong/damaged
   recovery input, restore on a fresh profile and test background/lock behavior.
3. Separately approve external provisioning/funding, then verify the exact account,
   matching public key, final balance, receiver QR and gas/storage reserves.
4. Separately approve ONE 0.1 NEAR transfer. Reject a review and confirm no send;
   then approve one exact transfer and independently inspect FINAL recipient funds.
5. Test ambiguous return/reload without retry. Then test the existing Instant Pay
   state machine and independent payout verifier. Never label deposit/SDK execution
   alone Verified Paid. Stop on mismatch, missing evidence or callback stall.

Sources: https://github.com/near/near-api-js/releases/tag/near-api-js%407.4.0
https://docs.near.org/tools/near-api
https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/sign
https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
