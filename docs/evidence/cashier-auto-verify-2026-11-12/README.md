# Cashier sees Verified Paid without a tap — 2026-11-12 (local build, real Testnet)

**Branch build, not production.** Built from `claude/beautiful-gates-c6fhhh` and
served with `next start` on `localhost:3100`. The build used the same public
configuration as taplyapp.xyz: pilot contract `taply-pay-pilot-1.testnet`, code
hash `BrR6bioU…`, Instant Pay on. All chain activity is real NEAR Testnet.

**Before:** on taplyapp.xyz today, the merchant's pay screen stops at "Payment recorded ·
Awaiting verification" and the cashier has to tap **Verify receipt**.

**Change:** if this device created the sale, the pay screen now opens the receipt
by itself once the sale is paid.
- It fires once per tab, and only within 30 minutes of the sale's creation.
- The receipt URL carries no funding hint. The receipt finds the funding
  transaction from public chain data and runs the same independent verifier.
- The navigation itself never makes a sale look verified.
- Code: `apps/web/src/lib/payments/follow-up.ts` (`ownSaleCreation`) and `components/payments/PaymentScreen.tsx`.
- Tests: 3 unit tests and 2 component tests. The component test fails without the change.

| Step (UTC) | Result |
| --- | --- |
| 06:05:05 | Merchant Taply Wallet `taply-till-5ea2fd.testnet` created in the app (faucet) |
| 06:05:34 | 0.01 NEAR request created in the app at `/request/new` and confirmed in Taply's dialog |
| 06:05:44 | Customer (disposable faucet account) paid from a script: tx `AKBdsfyEdMSUuhqtMNAAs4NpG3tDLFzqJsXNXjvvVAdW` |
| 06:05:48 | The cashier's screen opened `/receipt/<id>` by itself, 4 s after payment, with no `?ftx=` |
| 06:06:02 | **Verified Paid**, 18 s after payment. Chain: `FINAL_PAID`, payout `SUCCEEDED`, exact amount |

Files: [result.json](result.json) · [waiting](1-cashier-waiting.png) · [receipt](2-cashier-receipt.png) · script [cashier-e2e.mjs](cashier-e2e.mjs).

Re-run (needs a running build):

```sh
TAPLY_E2E_RPC=https://test.rpc.fastnear.com node cashier-e2e.mjs <baseUrl> <outDir> <playwright index.mjs> packages/near-client/testnet-e2e/lib.mjs
```

Limits:
- Verified Paid on the merchant's phone depends on public archival RPCs to find the funding transaction. If they rate-limit, the receipt says "Could not verify yet", keeps "Payment recorded", says "Do not pay again" and retries by itself.
- The customer paid from a script, not from the app.
