# Taply for X · Chrome MV3 alpha v0.3

**Status: separate development branch; NOT merged, NOT deployed, NOT published.**
NEAR **Testnet only**. Unofficial; not affiliated with X.

Taply for X adds a user-initiated **Tip with Taply** control on X profiles.
It also recognizes direct Taply request and receipt links visibly present in X DMs.

## Install locally

1. Check out branch `feature/taply-for-x-mvp`.
2. Open Chrome `chrome://extensions` or Edge `edge://extensions`.
3. Enable Developer mode; click Load unpacked.
4. Select repository folder `apps/extension` (containing `manifest.json`).
5. Visit an X profile, click Tip with Taply, and enter the recipient's independently confirmed NEAR Testnet address.
6. Enter a positive NEAR amount and choose Review in Taply.
7. In Taply Wallet, review the full recipient, amount, gas and network again. Confirm explicitly.

## Current limitations

- The site-side `/send?source=x-tip&to=...&amount=...` prefill is in this branch but **not deployed**.
- Until deployment, enter the address and amount manually on the live Taply site.
- Only Taply Wallet's native Testnet direct send is available. External-wallet direct send is disabled.
- No X handle is cryptographically associated with a NEAR account. Saved mapping is UNVERIFIED local-only data.
- No automatic DMs, signatures, clicks, payments, X API access, private keys, passwords or seed phrases.
- X DOM changes may break controls; DM cards need visible direct Taply links (not `t.co` URLs).
- DM Dismiss is a local UI action, not an on-chain cancellation or refund.
- Direct tips are **not** Taply contract payments; they do not carry Taply's contract Verified Paid proof.

## Taply Proof

After an actual independently **Verified Paid** contract receipt, Taply offers
**Copy live proof embed**. Paste the resulting HTML iframe on another website.
The embedded `/proof/<64-hex-request-id>` route reruns Taply's existing on-chain
receipt verification in a compact read-only UI. A funding transaction hint
never becomes proof by itself; chain failure or an RPC outage cannot create a
Verified Paid badge. Historic records remain labelled historic.

Only the read-only proof URL is framed. Signing and payment routes remain unframeable.
Currently this embeds the full compact receipt instead of a tiny badge.

## Tests

```sh
node --test apps/extension/tests.cjs
node --check apps/extension/shared.js
node --check apps/extension/content.js
node --check apps/extension/popup.js
```

## Before public release

- Test the extension in a signed-in X session, including SPA navigation and direct DM links.
- Test two real disposable wallets: Tip → review → signed Testnet transfer → chain observation.
- Test proof iframe on an external domain: success, cancellation, missing evidence, unavailable RPC.
- Check X and Chrome Web Store terms, accessibility and permissions.
- Run full workspace CI, review security response headers, then obtain human approval before merging.
