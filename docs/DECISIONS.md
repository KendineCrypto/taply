# Open architecture decisions — must be answered in code with evidence

- ADR-001: How does native NEAR received by contract become truly received by merchant and how are payout callback failures recovered? **Blocker G1**.
- ADR-002: Protected cancellation cutoff/chain timestamp precision and simultaneous cancel-vs-release race? **Blocker G3**.
- ADR-003: Merchant-approved Protected terms and account binding (signed merchant policy or merchant explicitly joins)? **Blocker G3**.
- ADR-004: Payment deposit/storage funding reserves and gas at NEAR Testnet runtime? **Blocker G1**.
- ADR-005: Testnet-compatible Invisible Wallet provider, recovery and signer? **Blocker P1**.
- ADR-006: NEP-141 allowlist, storage registration, refund semantics and failure outcomes? **Blocker optional FT**.
- ADR-007: Signed delegated action relayer sponsor limits and costs? **Blocker optional sponsorship**.
- ADR-008: How to support permanent QR securely and exclude anonymous slug-to-account takeover? **Blocker G2**.
- ADR-009: Session comparison code input canonicalization and nonce expiry/test vectors? **Blocker G2**.
- ADR-010: What evidence confirms recipient payout rather than only incoming deposit? **Blocker G1/G3**.

Don't mark a decision resolved without tested implementation/evidence and lead approval for fund-handling paths.
