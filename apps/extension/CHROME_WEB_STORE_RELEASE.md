# Chrome Web Store release preparation — Taply for X

Status: PREPARATION ONLY. No store submission, account registration, payment or production deployment has been made.

## Public listing draft (English)

**Name:** Taply for X — NEAR Testnet Tips

**Short description:** Tip X profiles with NEAR Testnet using Taply Wallet. Review recipient and amount before signing. Unofficial extension.

**Detailed description:**

Taply for X adds an optional Tip with Taply button to X profiles. Enter a NEAR Testnet account you have confirmed independently, choose an amount, and open the transaction in Taply Wallet to review and approve it yourself.

- Voluntary NEAR Testnet tipping from X profiles
- Locally saved, UNVERIFIED handle-to-address notes for convenience
- Fast links to Taply Wallet and payment requests
- Read-only shortcut cards for direct Taply payment or receipt links shown in X messages

**Important:** X profile names do not establish wallet ownership. Confirm the full NEAR account with the person before sending. The extension does not execute transactions or hold wallet keys. Signing is performed separately on taplyapp.xyz. Test tokens only; no real funds. No affiliation with X.

**Support/source:** https://github.com/KendineCrypto/taply

**Product:** https://taplyapp.xyz

## Developer privacy disclosures — draft, verify against final release

Single purpose: Let a user initiate an NEAR Testnet tip from an X profile and review direct Taply payment links displayed in X.

Permissions: `storage` — keeps the NEAR Testnet recipient account locally with the corresponding X handle for the user's convenience. Content script access limited to `x.com` and `twitter.com` to render a voluntary button and recognize visible Taply links. No X credentials, wallet private keys, seed phrases or outgoing message automation.

Data practices: A handle and recipient account are saved in Chrome local extension storage on the user's device. The extension reads visible page URLs only to recognize direct Taply links; it does not intentionally persist X messages or profiles, and does not send these mappings to the extension publisher's server. On an explicit click, the browser opens taplyapp.xyz with a recipient and amount in the URL to populate the send form. The destination web app has its own separate privacy practices.

Publish an accurate privacy policy at a stable HTTPS URL before submitting. Account for the fact that the destination URL itself contains the account and payment amount, even though they are not secrets. Do not claim the product collects no user data.

## Required images and listing fields

- Actual Taply icon (128x128 PNG) with manifest icons if desired; do not imply X endorsement.
- One authentic 1280x800 screenshot minimum (ideally 2–3 real screenshots).
- Category, support address, detailed description, localized copy if applicable.
- Public visibility, regions, privacy fields, permissions justification.
- Two-step verified developer account with one-time registration fee.

## Hard blockers before Store submission

- [ ] Stable production prefill is deployed and a *real signed Testnet transfer* was verified end-to-end.
- [ ] Live X signed-in browser QA: profile SPA navigation, DM links and DOM changes.
- [ ] Validate that the extension visibly distinguishes UNVERIFIED X profile addresses.
- [ ] Add accurate public privacy policy and terms/support link.
- [ ] Add store icon and screenshots captured from the real product, not mock success states.
- [ ] Test Chrome/Edge accessibility, pop-up blockers and no account creation or hidden signing.
- [ ] Confirm ownership and trademark disclosures; no implication of affiliation with X or Chrome.
- [ ] Review latest Chrome Web Store financial data and limited-use rules.
- [ ] Produce a clean ZIP containing only extension package files at ZIP root.
- [ ] Review release build; explicit owner GO for public release.

## Publishing workflow (requires publisher account owner)

1. Register/login: https://chrome.google.com/webstore/devconsole — one-time $5 fee if not already registered.
2. Add new item; upload ZIP; supply listing, screenshots and public privacy policy.
3. Select Distribution → Public (not Unlisted or Private).
4. Submit for Review (optionally choose deferred publishing for manual post-review release).
5. Store reviews typically take a few days, possibly weeks; there is no guaranteed publication date.

Official docs:
- https://developer.chrome.com/docs/webstore/register
- https://developer.chrome.com/docs/webstore/publish
- https://developer.chrome.com/docs/webstore/cws-dashboard-listing
- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- https://developer.chrome.com/docs/webstore/review-process
