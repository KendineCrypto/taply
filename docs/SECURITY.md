# Taply v0.4 security, custody, escrow, receipt and identity

## Hard boundaries
1. **NEAR Testnet only**. Never solicit seed phrases from mainnet wallets; no real funds. Config rejects unexpected chain and provider endpoints; no mainnet fallback.
2. No private keys or recovery phrases in backend, source, GitHub, screenshot/demo, logs, analytics, URL, QR or localStorage plaintext. Don't invent cryptographic primitives. Review passcode/KDF/encryption, wallet generation, backup, restore, secure storage, device loss and logout before enabling embedded wallet.
3. Google/Apple/passkey OAuth login != wallet ownership. NEAR Auth advertises its live Mainnet service; prove a working Testnet provisioned account and signature before using it. If unsupported, show normal Testnet wallet connection; never fake embedded wallet.
4. Payer sees verified full recipient Account ID, token, amount, network, mode, cancel conditions and fees before signed approval. Swipe is an intent gesture, not silent transfer.
5. All amount arithmetic u128/base units; never JS floating-point conversions for chain amounts. Display `USD` only as non-guaranteed unit of an explicitly named mock test token.
6. Payment request terms immutable, fully verified against approved contract; validate user-controlled URLs and deep links, session binding and merchant account; reject cross-origin spoofed redirects.
7. Handshake short code is human comparison helper **not** proof of identity. Untrusted live server must not be able to change payout terms. Compromised socket/event response cannot cause `FINAL_PAID`.
8. Merchant permanent QR resolves merchant ID and signed account binding; create new on-chain intent per sale; never allow customer to swap payee in unsigned payload unnoticed.
9. Protected funds are **escrowed**, not final payment. Merchant UI must say `LOCKED — NOT PAID`. Expiration is only the point at which a release transaction *becomes eligible*; no automatic completion.
10. Only payer can cancel before chain cutoff; release only after cutoff; condition checks atomically guard cancel/release. In-flight outgoing promise state is committed BEFORE making cross-contract call. Callbacks private, operation-nonce checked, idempotent, callback origin validated.
11. Settlement liabilities conserved. On callback failure retain recoverable funded obligation, surface unresolved state and safe retry. Never simultaneously refund and release; don't allow anyone to drain balances via unbounded retries/storage exhaustion.
12. Approve only Testnet NEP-141 contract IDs; `ft_on_transfer` caller must be FT contract; return unused amounts per standard; test storage registration/transfer resolution failures. Payer identity is `sender_id`, not FT contract.
13. Receipt `FINAL_PAID` only if recipient payout actually succeeds with requisite chain finality; screenshot or client tx hash insufficient. Refund must result in receipt `CANCELLED_REFUNDED`, not `FINAL_PAID`.
14. Rate limit session creates/joins, protect join tokens, lock tenant/merchant reads behind verified access, expire/revoke session tokens, enforce signed merchant account association.
15. Sponsored gas requires bounded relayer signed delegated actions, quotas, abuse protections, no open arbitrary subsidized transaction relay.
16. Split/recurring must never automatically debit. Recurring template retries idempotent; split amounts conserve sums and child requests settle independently.
17. Require `cargo test`/near-workspaces or current maintained SDK test equivalent plus integration and adversarial E2E. No claim of audit.

## Stop-the-line gates — must ask lead for explicit review
- Creating or importing wallet keys; OAuth/passkey account provisioning and recovery.
- Escrow/payout/refund contract logic & deployment.
- FT allowlist, storage registration, callback flow.
- Release/cancel edge or changing 60-second semantics.
- Sponsorship/relayer production-enablement.
- Any change from NEAR Testnet or feature implying real economic value.

## Threat tests
Replay request / same tx; forged verified receipt; amount substitution; wrong token, decimals or recipient; ownerless cancellation; cancellation vs release race; callback double invocation; malicious FT caller; server socket spoof; leaked join URL; expired session with valid intent; unauthorized merchant status read; fake compare code; malicious linked wallet; RPC timeout and uncertain submitted tx; storage deposit exhaustion; social login account mismatch, provider outage & recovery failure.
