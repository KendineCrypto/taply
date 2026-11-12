# Production check after PR #33 — 2026-11-12

**Build under test:** `release/taplyapp` was fast-forwarded from `5a7e587` to
`6a47a4c` (= `main`, PR #33) at 06:19:45 UTC. At 06:20:41 taplyapp.xyz served two
new JavaScript chunks; one contains the sale follow-up code. That is a content
match, not a commit-SHA proof. Every run below started after that check. All
runs used real NEAR Testnet and fresh disposable faucet accounts.

| Check | UTC | Result | Files |
| --- | --- | --- | --- |
| Cashier: a merchant Taply Wallet creates a 0.01 NEAR request in the app; a customer pays from a script | 06:21–06:22 | PASS. The cashier's screen opened the receipt **by itself 6 s** after payment, with no `?ftx=` hint. **Verified Paid** at 20 s. `FINAL_PAID`, payout `SUCCEEDED` for the exact amount. No page errors | [result.json](result.json), [screens](2-cashier-receipt.png) (script: [`cashier-e2e.mjs`](../cashier-auto-verify-2026-11-12/cashier-e2e.mjs)) |
| Payer: Taply Wallet pays 0.05 NEAR | 06:22–06:24 | PASS. The receipt opened by itself; **Verified Paid** from a live check; no Approve after reload; a direct second payment was refused with `NOT_OPEN`; merchant +0.05 NEAR exactly | [verified-paid/result.json](verified-paid/result.json) |
| Live Handshake: join, same sale code, disconnect and reconnect, third phone refused, pay | 06:24–06:27 | PASS. `ALREADY_JOINED`, `FINAL_PAID`, both phones show "Payment recorded" | [handshake/result.json](handshake/result.json) (join secrets redacted) |
| Console on 14 routes at 390 and 1280 px | 06:27–06:31 | No page errors. Known messages only: the 404 page, and archival-RPC rate limits on a day-old receipt opened without its funding link (it keeps "Payment recorded", says "Do not pay again" and retries) | — |

No contract, flag or environment change. R-2 stays open; see
[R2_REACHABILITY.md](../../R2_REACHABILITY.md).
