# Taply — definitive Product Requirements v0.4

## Product hierarchy
**P0 must ship and work on NEAR Testnet:** wallet connection, real NEAR balances and send/receive; signed Request links + QR; static merchant QR generating one unique purchase request; **Handshake** two-device session; **Instant Pay**; **Protected Pay** with cancel/release/payout status; chain-verified receipts; accurate failure states. Visual identity from `brand/`.

**P1 if core stays stable:** embedded/invisible wallet through a reviewed *Testnet-compatible* signing provider, sponsored transaction fees, Contacts, Split Pay, NEP-141 mock stablecoin/token flows, merchant dashboard filters.

**P2 future/prototype:** Milestone Pay with disputes; recurring request templates; social account enhancements; proximity payments/NFC; advanced merchant analytics. No unsupported feature gets demoed as real.

## Actors
Payer/customer, requester/payee, merchant (owns receiving Testnet account), merchant staff viewing register, session service (untrusted for funds), wallet signer, chain indexer/cache, smart contract, optionally relayer. Threat model covers malicious customer, malicious merchant, spoofed URL, compromised session server and request replay.

## Use cases
1. **Friend:** Alice creates 1 NEAR Request, Bob opens link and instantly pays; both observe verified outcome.
2. **Store:** merchant displays permanent `/checkout/{slug}` QR, Bob scans, merchant/customer confirm amount in unique Handshake; payer signs; merchant register shows genuinely FINAL only after settlement.
3. **Protected transfer:** both parties agree to 60-second cancellation. Bob funds escrow; merchant sees *Locked, not spendable*. Bob can cancel before cutoff. Or time elapses, an actor calls release, payout callback succeeds; merchant now sees Final. Clock expiring alone never means paid.
4. **Rejected/wrong:** user denies signing, has insufficient gas or wrong account, link expires, payment already settled or chain RPC errors — must show honest actionable states.
5. **Onboarding:** default connect a NEAR Testnet wallet. Optional Google/Apple/email/passkey only if provider yields demonstrably controlled, recoverable Testnet account & signed transactions; do not imply OAuth login itself holds funds.

## Core abilities
### Wallet
Real chain-based balance, account ID, network badge, send, receive-address QR, token allowlist, activity, security/backup. For first-party wallet use trusted primitives, human security approval, recovery test. No plaintext browser wallet keys or backend custody.

### Requests
Each on-chain request has immutable recipient, payer constraints (if set), network, asset, base-unit amount, memo, expiry, payment mode, protected cancellation deadline and merchant binding if applicable. Share `/pay/{requestId}` and QR containing identical canonical link. Recipient and rules displayed *before* signing.

### Handshake
Short-lived UUIDv4+ session ID and random unpredictable session token (not a transaction authority). QR joins a session; customer and merchant see canonical **6-character comparison code** derived from session nonce + cryptographically bound immutable terms. Matching screens assist humans, not proof of merchant legality. Changes require new session / re-confirmation. Backend offers realtime presence and events but cannot independently mark transactions complete. A user may pay a verified request without a live merchant present; degraded state clearly indicated.

### Instant Pay
Signed transfer via contract or documented direct transfer model. True payout must be verified; funded != final if async payout pending. Receipts can reference merchant intent/session on-chain, not just generic transfer hash. No implicit reversible promise.

### Protected Pay
Payer and payee explicitly opt in before funding. Cancellation window specified on-chain using nanosecond block timestamp **or reviewed equivalent**; display countdown as approximate until chain-authoritative cutoff. Funds escrowed with escrow liability accounting. Only payer cancels before cutoff; after cutoff release is permissionless/authorized according to contract rules; never both cancel and release. UI distinguishes `LOCKED`, `REFUNDING`, `RELEASING`, `CANCELLED_REFUNDED`, `FINAL_PAID`, `FAILED_RECOVERABLE`. Merchant cannot treat lock as final payment. If payer refunded, no receipt saying "paid".

### Milestone Pay (P2)
Named milestones, explicit acceptance rules, signed release approval, explicit timeout and dispute/refund policy. Never imply blockchain can judge quality of human-delivered work. Separate contract extension and gated spec required before implementation.

### Checkout
Merchant profile with bound receiver account, static reusable QR **not a reusable paid request**; amount entered by merchant/customer according to profile rules; every sale generates unique one-time immutable request with expiry; merchant's actual receiver cannot be overridden by QR payload or browser. Cash-register shows per-session status and final receipt; optional quick replay protection. No offline fake finalization.

### Verified receipts
Final receipt includes request ID, session ID if used, mode, network, contract account, payer, receiver, token, base-unit quantity, associated transaction(s), final settlement status, verification height/time and explorer link. If payout failed or finality uncertain, mark pending; independently queryable.

### Additional features retained
- Contacts (P1): local-first saved labels -> account IDs; final review shows exact ID; discourage address poisoning; explicit opt-in before cloud sync.
- Split Pay (P1): group with independent signed requests; sum of base units exact; group aggregate settled only after all child requests final.
- Recurring Requests (P2): templates produce unique pending requests; never unattended charge or recurring authorization; idempotency + timezone tests.
- Social Login (P1/P2): only proven Testnet key control, recovery, logout; fallback supported wallet.
- Sponsored Gas (P1): relayer with quotas/antiabuse; precise explanation of sponsored vs free transaction; separate credentials.
- NFC / proximity (P2): experimental, no claim NameDrop tap-to-pay unless tested native implementation.

## Design and content
Use approved `brand` assets (single corrected vector geometry; don't redraw). Primary `#0B120E`, surfaces `#111C15`/`#203226`, text `#F4F3E8`, lime `#C7FC75`. UI must say `NEAR Testnet · Demo funds` consistently. Wallet actions friendly, large mobile buttons, dark green not orange. Never infer real USD price for a mock stablecoin. Free/social login not declared available until working.

## Product quality gates
G0 typed spec frozen → G1 native Testnet Instant request payment → G2 Handshake paired devices + merchant QR → G3 Protected cancellation **and** successful release with refunds → G4 UX/error/security/receipt proof → G5 optional extra features. Failure to reach G3 means describe Protected as experimental, not shipping.
