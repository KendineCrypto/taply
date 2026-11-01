# Taply One-Tap UX Redesign — implementation brief

Status: approved UX direction, **not implementation evidence**. Branch: `feature/frontend`. Product: NEAR **Testnet** only. This brief reorders priorities: simplify the experience before expanding wallet capabilities or recording the final demo.

## Product thesis

**"Your wallet. Your payment. One tap."** means low cognitive load: one obvious next action at every moment. It does **not** mean silent blockchain signing or bypassing wallet security confirmations.

Reference Phantom's **interaction principles** (strong balance hierarchy, minimal navigation, bottom sheets, playful but restrained motion) rather than copying its trademark, illustrations, purple identity, component layout, or proprietary assets. Keep the existing Taply wordmark, deep-forest/lime/cream palette and independent Verified Paid receipt.

### Current friction, verified against the branch

- `AppShell.tsx`: five permanent bottom navigation destinations (Home, Pay, Scan, Activity, Settings).
- `QuickActions.tsx`: three oversized primary shortcuts **in addition to** bottom navigation.
- `TourCard.tsx`: a prominent always-present demo tile on the live wallet home.
- `CreateRequest.tsx`: four form fields visible together (amount, memo, permitted payer, expiry), then a full review.
- `PaymentScreen.tsx` and `ReceiptScreen.tsx`: accurate but dense blockchain evidence and status copy occupy the primary path.
- Native and external wallet switching has to stay truthful and not accidentally grant signing.

## New information architecture

1. **Cüzdan / Wallet** — home, balance, account identity, recent activity preview. Wallet/account switch is a compact accessible action in the header. Keep permanent Testnet indication.
2. **Tap** — single central prominent bottom navigation action. Opens an accessible animated bottom sheet with contextual options:
   - **İste / Request** (primary; supported contract path).
   - **Öde / Pay** (scan a QR / paste an existing payment link; show genuine pay review).
   - **Gönder / Send NEAR** (navigate to the existing send-review surface; if native signing is disabled show why, never imply it is enabled).
3. **Geçmiş / Activity** — transactions and request states; no synthetic history and no "Verified Paid" without independent verification.

**No fourth/fifth persistent bottom tab**. Settings, wallet management, language and help under top-right account/avatar menu. Receive address and QR via tapping the account identity or one small context action; no redundant Home/Pay/Receive CTA clusters. The demo tour moves to a secondary Help/Explore entry, not a large permanent home billboard.

## Screen contracts

### Wallet home

- Header: small Taply mark left, compact **NEAR Testnet** badge, account avatar/menu right. Show external vs native wallet accurately. Don't silently change active signer.
- Central focus: genuine, finalized **NEAR balance** in large typography; no fake USD valuation, yield, trend, token or chart.
- Under it: compact account row, tap to view address/receive QR/copy.
- Below: three most recent real activities with status and one "All activity" text link; tasteful empty state when none.
- Only one unmistakable primary action at rest: center **Tap** in bottom navigation.
- Loading, RPC outage, wrong network and local-only identity never display fabricated amounts.

### Request money: two focused screens, not a four-field form

**Step 1 — Amount.** Big, readable NEAR numeric input/keypad, connected recipient automatically known; one `Continue` CTA. Empty/invalid states inline. Optional memo, payer restriction and expiration collapsed behind `More options`, not removed. Safe defaults: no memo, any Testnet payer, 15-minute funding period. No automatic account/wallet switch.

**Step 2 — Review.** Amount, exact recipient, chain/asset, explicit "Anyone may pay" (when unrestricted), expiry, **exact permanent storage bond** and estimated gas clearly shown before signing; additional technical details expandable. One `Create request in wallet` CTA. This is an actual signed on-chain create_request with the existing journal, nonce and quote guards. No automatic signing. Once created, show a single clean QR ticket with one dominant Share action and smaller copy access.

### Pay an existing request

Scan or paste link -> compact truthful review -> explicit wallet approval -> status. On review always show actual payer, recipient, exact NEAR amount, Testnet, contract binding and any deadline/fee/restriction. Wallet rejection and unknown transaction outcomes are not successes and may not trigger retries.

### Payment/receipt states

- OPEN: beautiful payment card, amount, recipient, one Share or Pay action (role-aware).
- IN_FLIGHT: simple "Processing on Testnet" with one quiet status line; **Never pay again** warning when outcome ambiguous.
- FINAL_PAID: "Paid per contract" distinct from "Verified Paid".
- VERIFIED: visually satisfying **single-use** check/shield animation, cream receipt card with amount, parties, date and one share/copy verification link. Blockchain transaction/receipt hashes and proof JSON under collapsed `Technical proof` disclosure, still easily accessible. Keep provenance and external independent verifier fully intact.
- Failed/unknown: preserve exact safety-state semantics and stop conditions.

### Native wallet onboarding

Keep strong passphrase, required acknowledgements, encrypted backup and mandatory backup confirmation. These are **not** optional fields to remove. Make the wizard feel calm, one decision per screen, small progress indicator and subtle transitions. Do not generate or handle keys in React UI. Native signing remains off until separately approved; Meteor remains working pilot fallback.

## Visual identity and animation

- Keep existing Taply night/forest, lime and cream receipt surfaces; reduce nested cards, heavy gradients, repeated outlines, uppercase metadata and giant warning boxes.
- One primary lime CTA max per decision screen. Other actions become plain text, compact icons or contextual bottom sheet entries. Don't hide critical warnings or exact terms.
- Motion: 160–240 ms for tap feedback/tab transitions; 220–320 ms for bottom sheet; brief receipt check animation ~450 ms only once after independent verification. Spring-like easing, quiet stagger on real list items, no fake balance counting or artificial processing time. Prefer CSS/transforms/opacity already supported; do not add a large animation package without lead approval.
- `prefers-reduced-motion` disables decorative motion. Keyboard navigation, escape-to-close, focus restore, visible focus and 44px targets for sheet. Avoid blocking scroll inappropriately.
- Desktop stays a refined responsive wallet, not an enlarged phone screenshot.
- Design remains original to Taply, **inspired by** (not cloned from) Phantom's clarity and animation.

## Guardrails that must not change

- No contract edits, deployed code-hash changes, signature enabling or mainnet fallback.
- `NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY` remains environment-controlled, and test/CI default off; native `TAPLY_WALLET_SIGNING_ENABLED` remains false.
- `prepareCreateRequest`, `preparePayInstantNative`, settlement state machine, immutable terms and proof verifier must remain behaviorally identical.
- Do not auto-execute transactions, auto-click wallet confirmation, auto-repeat an unknown transaction or claim a CLI-verified flow was a mobile wallet test.
- Keep all read-only chain evidence and `docs/EVIDENCE.md` intact.

## Acceptance tests and quality bar

- Max **three** persistent bottom destinations; no permanent home demo billboard.
- Request step 1 shows **amount as the only mandatory editable field**. User can still optionally set memo/payer/expiry.
- Request review always presents exact bond, expiry, anyone/payer restriction, amount, recipient and network before the wallet is invoked.
- Each main screen has one dominant next action. No action duplicated at equal visual weight in home and bottom nav.
- Receipt only shows `Verified Paid` when the existing independent verifier produces a verified receipt; no animations or shortcut claims otherwise.
- Keep real `/pay/[id]`, `/receipt/[id]?ftx=...`, wallet create/restore and existing Testnet pilot evidence functional.
- EN/TR, 360/390/430px, modern desktop, keyboard/focus/a11y, reduced motion, no layout overflow, strong mobile performance.
- Expand tests for simplified navigation, optional-fields defaults, immutable terms, disabled signing, progressive disclosures, exact QR/share link and verification-state integrity.
- Run `pnpm install --frozen-lockfile` and `pnpm check`, Playwright screenshots before/after, screenshot diff review. Commit to `feature/frontend` only; don't touch `main`.

## Implementation sequence

1. Refactor shell/navigation and remove repetitive home CTAs.
2. Focused amount-first request wizard with advanced options; preserve current protocol/quote code.
3. Simplify pay, share and receipt presentation.
4. Add precise micro-interactions and test reduced-motion.
5. Browser/CI regression, capture EN/TR demos, update demo kit.

Success means a first-time user can locate **Request** instantly, enter 0.1 NEAR, understand the exact terms and approve the existing wallet request without confronting transaction hashes, contract vocabulary or multiple equally prominent buttons. This does **not** claim a blockchain transaction itself takes one literal tap.
