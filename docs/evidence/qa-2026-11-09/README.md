# Protected Pay QA walkthrough against the real Testnet candidate (2026-11-09)

Local production build (`next build && next start`) of `claude/kind-cerf-c4n261` with the
public read-only env plus QA settings — not a Vercel deployment:

```
NEXT_PUBLIC_TAPLY_FLAG_PROTECTED_PAY=on
NEXT_PUBLIC_TAPLY_PROTECTED_CONTRACT_ID=taply-e2e-6cdaf61b.testnet
NEXT_PUBLIC_TAPLY_PROTECTED_CODE_HASH=Ea5REQGAgRUiL6JzbKMY5sRRn2E4oPs3i1oFHPsSz29A
NEXT_PUBLIC_TAPLY_PROTECTED_QA=on
```

Headless Chromium, 390 px, read-only (no wallet connected, nothing signed):

| Screen | What the live chain read showed | Overflow |
| --- | --- | --- |
| `/protected/6687e98a6cffb413ff2d73c7f025b47de77d3f8bc760440be1260b48c7f2c7d4` | Unreviewed-contract banner; **Refunded** badge; 2.5 tUSD-TEST (symbol/decimals from the contract's verified allowlist); payer/recipient accounts; 60 s window; on-chain cutoff; "Refunded — not a payment" | none |
| `/protected/new` | Asset selector lists NEAR and tUSD-TEST from the live `get_config`; window options 60 s / 5 min / 15 min / 1 h | none |

Screenshots: `protected-token-refunded.png`, `protected-new-token.png` (deviceScaleFactor 2).
