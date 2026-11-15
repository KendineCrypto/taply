# Mainnet header cleanup and display-balance resilience

Owner requested removing the Demo/network pill and repeated real-funds/unaudited
header copy. Mainnet now opts out of the shared shell badge; Testnet keeps its
existing default. The always-visible safety disclosure is removed from Mainnet's
header. Synthetic fixture builds still visibly identify fixture data. Network
identity, exact transaction reviews, caps and signing gates are unchanged.

A live read-only diagnostic reproduced primary RPC timeouts while the approved
Mainnet archival provider read the same account successfully. The display-balance
hook now retries approved Mainnet providers on transient transport, rate-limit,
node-sync and unavailable-block errors. Each provider verifies Mainnet genesis
and reads the full native/USDC snapshot at one FINAL block. Wrong-network or
contradictory evidence is not retried into an apparently successful balance.
No snapshot fields are mixed; all providers failing remains an error, not zero.
The transaction planner/signer provider and checks are unchanged.

Focused tests cover fallback, refusal to mask mismatches and no fabricated zero.
TypeScript and lint pass. The new display reader also completed a live read-only
balance read. Browser QA checks the requested header absence and preserves the
fixture label assertion. CI and deployment must succeed before live completion
is claimed. No key, wallet signature or funds were used for these checks.
