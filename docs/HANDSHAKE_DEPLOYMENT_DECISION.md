# Live Handshake deployment — options and decision (2026-11-09)

What exists: `apps/api` (session engine, NEP-413 merchant auth, durable encrypted SQLite storage, HTTP
handlers, SSE/JSON catch-up, rate limits) with 57+ tests; it starts **no listener** and keeps production auth
closed (F-06). The merchant-bound contract is proven on Testnet (`taply-e2e-9c2eeea4.testnet`, see
RELEASE_EVIDENCE_INDEX.md): the contract, not the session service, binds the sale to the session and decides payment.

| Option | Fit | Cost / access | Verdict |
| --- | --- | --- | --- |
| Vercel serverless + in-memory/SQLite file | Instances are ephemeral; rooms would vanish between requests | — | **Rejected** (not durable) |
| Vercel serverless + managed KV/Postgres (Vercel Marketplace: Upstash Redis or Neon, free tiers) | Short polling (≤2 s) works on serverless; needs a storage adapter replacing SQLite behind the existing `storage.mts` interface | Free tier, but the **owner** must provision it in the Vercel project (creates env vars) | **Chosen** — simplest supportable path, no purchase |
| Persistent Node host (Fly.io/Render/VM) running `apps/api` as-is with SQLite volume | Zero code change to storage; SSE works | Needs an owner account; free tiers vary and may require a card | Fallback |
| Third-party realtime (Ably/Pusher) | Adds a trusted relay; still needs durable state | Owner account | Not needed |

Security invariants kept in every option: the service stores only public session data and signed hints; it can
neither change terms (the contract stores immutable terms + session commitment) nor declare payment (clients
re-read the chain; socket/poll "paid" is a hint only).

## Exact missing external configuration (owner)

1. In the Vercel project `taply` → Storage → create **Upstash Redis (free)** (or Neon Postgres) for the *Preview*
   environment only; this adds `KV_REST_API_URL` / `KV_REST_API_TOKEN` (server-only).
2. Set a server-only `TAPLY_SESSION_ENCRYPTION_KEY` (32 random bytes, base64) for Preview.
3. Then the remaining code work is a storage adapter (`apps/api/src/storage.mts` interface → Redis REST) and a
   Vercel route wrapper around the existing handlers, plus `NEXT_PUBLIC_TAPLY_FLAG_HANDSHAKE=on` and the merchant
   candidate contract id/hash on the **QA preview only**.

Not done in this session: the adapter and route wrapper (no storage credentials to test against; shipping an
untested durable layer would be the "pretend durable" outcome the mandate forbids).
