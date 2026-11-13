/**
 * The official 1Click SDK, pinned at exactly 0.1.26 (docs/MAINNET_BRIEF.md §7.1).
 * Server only: imported from route handlers, never from a client component.
 * Only the signature scheme and types are used; HTTP goes through ./client.ts
 * (bounded, no redirects, injectable for tests) to the same documented API.
 */
export {
  quoteHash as quoteHashSdk,
  verifyQuoteSignature as verifyQuoteSignatureSdk,
} from '@defuse-protocol/one-click-sdk-typescript';
export type { QuoteResponse as OneClickQuoteResponse } from '@defuse-protocol/one-click-sdk-typescript';

/**
 * 1Click manager key. Same literal as the SDK 0.1.26 default argument of
 * `verifyQuoteSignature` (src/quote-signature.ts; not exported by the package)
 * and docs/MAINNET_BRIEF.md §3. Passed explicitly so a test can prove which key
 * production verification uses.
 */
export const ONE_CLICK_MANAGER_PUB_KEY = 'ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc';
