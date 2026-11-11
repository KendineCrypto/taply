# Phase 7I — UX copy simplification

> **Archived status report.** This file records what was true on the date in its
> title or sections and is kept unchanged as history. It is not the current status.
> Current status (2026-11-11): payments are signed on taplyapp.xyz, the live two-phone
> Handshake and Protected Pay (Testnet escrow, not audited) are on. Authoritative:
> [README](../README.md) and [VERIFICATION_MATRIX.md](VERIFICATION_MATRIX.md).

> Historical implementation report: the results below describe initial `0503e9f`. Final `352a7cf` adds neutral contract-paid clocks, the checkout chevron and four tests (1,155 workspace passes). Committed screenshots predate that polish. See [current release readiness](RELEASE_READINESS.md) for reruns and remaining gates.

Implemented locally on the connected Windows PC, in `C:\taply-phase7i-ux`, branch `feature/phase7i-ux`, from verified source SHA `6a485a251f38271fa9f95567e601a71c2b0ae70b`.

## Result

Reduced default-screen explanations through TSX removal and progressive disclosure, alongside 56 revised dictionary values in each language. Preserved the existing visual system. No payment, verifier, authentication, contract, shared schema or feature-gate implementation changed. Live G2/Handshake remains disabled. No transactions signed, deployment, push or merge performed. The source checkout remained clean at its original SHA.

## Screens and changes

| Journey | Removed or collapsed | Retained in view |
| --- | --- | --- |
| Home / wallet | Removed the repeated keys/approval paragraph; shortened connect and empty-state copy | Wallet connection, exact account, network, balance errors, wallet availability and recovery warnings |
| Send / receive | Shortened preview-only, disabled-send, QR and network copy | Exact recipient, amount, fees, signing review; no-mainnet warning; unknown-result/retry warnings |
| Merchant / new sale | Removed redundant header subtitles and account explanation; collapsed future-feature and backend explanations into Details; shortened local-sales copy | Receiving account, New sale, Store QR, local-history scope, pending-sale guard, quote/storage/gas terms |
| Checkout / store QR | Collapsed the how-to list and profile background; removed duplicate discovery notice heading; shortened identity copy | Exact account, unverified business identity, compare-account warning, scan action, store QR explicitly marked as not a payment |
| Payment request / confirmation | Removed repeated review introduction and share-permissions paragraph | All existing review fields, permitted payer, expiry, amount, network, contract, wallet action, gas and confirmation checkbox |
| Shared payment session | Duplicate status chip is visually hidden but remains accessible; timeline, proof legend, counterpart and sale-code explanation moved into Details | Amount, full recipient, sale code, stage headline, one supporting sentence, receipt-check action; Checking chain stays visible |
| Receipts | Removed repeated proof-pending and sharing paragraphs; moved lookup provenance and technical reason code into disclosures | Distinct contract-paid/verified seals and text, recipient/payer, amount, timestamp, verification failures and retry action, live announcement |
| Activity | Shortened scope and empty state; enlarged activity/explorer links to 44px minimum height | Local-only scope and journal status, without claiming settlement |
| Demo / onboarding | Removed duplicate demo headline/tagline/introduction; collapsed reviewer and Handshake-preview panels | DEMO/synthetic markers, tour navigation, focus handling, optional reviewer matrix and Help |
| Errors | Shortened configuration, disabled-signing, unknown-result and unavailable-receipt copy | Uncertainty, fail-closed behavior and “do not pay again” instructions |

The default shared-session hero now has one visible status headline. Its timeline, proof explanation and counterpart paragraph no longer compete with the amount and action. Mandatory signing review remains deliberately more detailed than an ordinary status screen.

## Copy examples

| Context | Before | After |
| --- | --- | --- |
| Merchant sale EN | Enter an amount, review it and create a one-time payment QR. | Create a payment QR. |
| Merchant sale TR | Tutarı gir, kontrol et ve tek kullanımlık ödeme QR’ı oluştur. | Ödeme QR’ı oluştur. |
| Contract-paid EN | The contract recorded the payout. The receipt check makes it Verified Paid. | Payout recorded; not independently verified yet. |
| Contract-paid TR | Kontrat ödemeyi kaydetti. Makbuz kontrolü bunu Doğrulanmış Ödendi yapar. | Aktarım kaydedildi; henüz bağımsız doğrulanmadı. |
| Transfer EN | Your payment reached the contract and is on its way. Not final yet. Do not pay again. | Not final yet. Do not pay again. |
| Receive TR | Bu QR kodu yalnızca hesap kimliğinizi içerir, asla bir tutar içermez. | Yalnızca hesap · tutar içermez |
| Checkout EN | This page only identifies the merchant. Nothing is charged here. Ask the merchant to show the QR for your sale. | Ask the merchant for your sale QR. |

## Safety and accessibility

- `CONTRACT_PAID` remains neutral, explicitly **not independently verified**, with a receipt-check action. `VERIFIED_PAID` alone receives the lime shield/title treatment. Neither state mapping nor verifier was changed.
- Unresolved state remains caution-colored with its visible no-repeat-payment instruction. RPC failure never becomes success. Receipt announcements remain outside disclosures.
- Exact signing terms, fees, irreversible storage deposit, expiry, account/network mismatch and retry restrictions remain available in their existing pre-signing locations. No mandatory review field was collapsed.
- Native `details`/`summary` keeps keyboard behavior; new disclosure controls have at least 44px height. Existing live regions, reduced-motion behavior and focus handling were retained.
- Sale codes remain comparison aids, with their identity limitation in Details. No customer presence or authentication is inferred; “Live” was clarified to “Auto-updating.”

## Validation

Final `pnpm check`: **PASS**, exit 0. Includes brand validation, production builds, strict TypeScript, lint and all workspace tests:

- Shared: 92 passed.
- Near-client: 207 passed.
- Web: 852 passed, 1 skipped; 62 test files passed, 1 skipped.
- Total: **1,151 passed**, one opt-in live-network test skipped.

Full web suite includes receipt verification, merchant receipt lookup, payment state mapping, freshness, redirect recovery, shared journey, mobile receipts, signing guards and feature-gate tests. Updated seven affected test files; added three EN/TR disclosure and visible-warning regression cases. Initial failures were obsolete copy assertions and a duplicate heading; corrected before the final pass. No stored snapshot files needed regeneration.

After adding QA tooling: `pnpm --filter @taply/web typecheck` and `pnpm --filter @taply/web lint`: **PASS**, exit 0. `git diff --check`: **PASS**. Rust tests were not run because no contract code changed.

Browser QA against the production build:

- 90 route/locale/viewport combinations: 15 screens × EN/TR × 360/390/1280px.
- Zero horizontal overflow, unnamed main-content controls, controls below 44px height in the automated checks, or page errors.
- 30 additional isolated SharedSession presentations: five states × EN/TR × three widths. Overflow and keyboard disclosure checks passed.
- Screenshot inspection included checkout, home, Turkish signing review, contract-paid, verified and unresolved presentations.
- External requests blocked in the route pass. Disconnected wallet/configuration screens and DEMO journey used; the isolated payment presentations are prominently labelled synthetic. These are UI evidence, **not new blockchain/payment evidence**.

Reproduce from the worktree, using a separately installed Playwright (no dependency or lockfile change):

```powershell
pnpm check
pnpm --filter @taply/web exec next start -p 3219 -H 127.0.0.1
# In a second terminal, after the build:
node apps/web/scripts/phase7i-fixtures.mjs
node apps/web/scripts/phase7i-qa.mjs <path-to-playwright/index.mjs>
```

## Screenshots

Before screenshots are the existing Phase 7H artifacts at the source SHA. After screenshots use local offline/demo data; the payment hero comparisons show layout/copy changes, not identical transaction evidence.

| Screen | Before | After |
| --- | --- | --- |
| Home EN | [7H](../apps/web/docs/screenshots/phase7h/en-home-390.png) | [7I](../apps/web/docs/screenshots/phase7i/en-home-390.png) |
| Checkout EN | [7H](../apps/web/docs/screenshots/phase7h/en-checkout-390.png) | [7I](../apps/web/docs/screenshots/phase7i/en-checkout-390.png) |
| Contract-paid EN | [7H real read](../apps/web/docs/screenshots/phase7h/en-customer-paid-390.png) | [7I synthetic component](../apps/web/docs/screenshots/phase7i/en-fixture-contract_paid-390.png) |
| Verified distinction | — | [Synthetic verified](../apps/web/docs/screenshots/phase7i/en-fixture-verified-390.png) |
| Unresolved TR | — | [Synthetic unresolved](../apps/web/docs/screenshots/phase7i/tr-fixture-unresolved-360.png) |
| Signing review TR | — | [Demo at 360px](../apps/web/docs/screenshots/phase7i/tr-demo-review-360.png) |

[All after screenshots and structured audit](../apps/web/docs/screenshots/phase7i/qa.json). Captures contain sample accounts, public identifiers or loopback development URLs; no private hostnames, credentials or secrets.

## Remaining UX risks

- Users must expand Details for timeline, proof mechanics and secondary provenance. Visible unverified and unknown-result warnings mitigate misreading, but user testing is still needed.
- Browser checks are Chromium-based, not physical iOS/Android or a full screen-reader audit. Touch checks measure height; densely grouped demo controls and real mobile wallet redirects warrant device testing.
- Connected merchant/request creation and real RPC receipt outcomes remain covered by the existing component/integration suites; this phase did not repeat live Testnet signing or prove new settlement.
- Longer mandatory signing and failure states intentionally exceed the one-sentence target. The compact-copy policy must not remove their transaction terms in future edits.
