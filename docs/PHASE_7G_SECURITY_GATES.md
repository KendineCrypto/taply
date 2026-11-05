# Phase 7G CORE security gates

Base: `5999d0c2bee67839e1ba55546b0021b22f2d0ce4`. Work is isolated on
`feature/phase7g-core`. Production authentication and live G2 remain disabled.

| G2 acceptance requirement | Required evidence / authority |
| --- | --- |
| Merchant controls receiver | NEP-413 proof plus fresh finalized FullAccess association; direct creator-signed contract creation |
| Unique authorized sale | Creator-scoped nonce / deterministic ID; permanent replay tombstone |
| Immutable merchant/session terms | Frozen v1 terms/hash/commitment; merchant equals creator equals receiver |
| Independent customer terms | Approved deployment hash, Testnet genesis, same finalized block reads |
| Independent equal code | Each client computes frozen v1 commitment/code from independently read terms |
| Explicit bilateral review | Authenticated separate participants review the exact hash; review is coordination only |
| Explicit funding | Customer wallet approval, exact native principal/hash; never requested automatically |
| Safe settlement | Existing reserved in-flight transfer and private nonce-checked callback |
| Chain payment status | Finalized chain read; server events and clocks confer no payment authority |
| Verified Paid | Independent funding/transfer/callback receipt graph proof, beyond contract status |

Implementation decision: an opt-in `merchant-bound-v1` contract build will be
versioned separately from the default pilot build. No frozen wire schema, hash
domain, payout method or callback ABI is changed. No upgrade of the existing
pilot is authorized. A new deployment identity/hash must be reviewed separately.

The approved deployment remains `taply-pay-pilot-1.testnet`, code hash
`BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B`. Recorded pilot WASM SHA-256:
`a13d932f3b4cadbb4a6580d447a8142f8c704656998659fb3ccebde6ddacb0d2`.
These are historical pins, not a fresh chain observation.

Activation gates: separately reviewed deployment and upgrade authority, real wallet
NEP-413/mobile evidence, signed merchant discovery, trusted HTTPS/cookies/host
permissions, independent non-restorable freshness infrastructure, recovery and
resource acceptance, frontend integration and actual two-device receipt evidence.
Passing local tests cannot close these operational gates.
