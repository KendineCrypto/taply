import { verifyInstantReceipt } from './instant-receipt';
import type { VerificationResult, VerifyInstantInput } from './instant-receipt';
import type { VerifierRpc } from './rpc';

/**
 * Second read-only archival provider for the independent receipt verifier.
 * Measured 2026-11-09: ~0.75 s per archival read vs ~3.5 s on the default one,
 * which needs ~12 sequential reads per proof and was the source of
 * "Could not reach the RPC" on the live receipt page.
 */
export const DEFAULT_FALLBACK_VERIFIER = Object.freeze({
  rpcUrl: 'https://archival-rpc.testnet.fastnear.com',
  rpcProviderId: 'fastnear-archival-testnet',
});

/**
 * Runs the WHOLE independent verification on each provider in turn.
 *
 *  - Reads are never mixed: every proof comes from one provider end to end,
 *    and the VerifiedReceipt names that provider.
 *  - Only a TRANSIENT failure (unreachable, rate limited, history not served)
 *    moves on to the next provider. A definitive failure (evidence mismatch,
 *    wrong contract, refund instead of payout, ...) stops immediately and is
 *    returned: another provider can never "outvote" a contradiction.
 *  - Nothing is cached; nothing is inferred. If every provider fails
 *    transiently, the last failure is returned.
 */
export async function verifyAcrossProviders(
  input: Omit<VerifyInstantInput, 'rpc'>,
  rpcs: ReadonlyArray<VerifierRpc>,
  verify: (input: VerifyInstantInput) => Promise<VerificationResult> = verifyInstantReceipt,
): Promise<VerificationResult> {
  let last: VerificationResult | null = null;
  for (const rpc of rpcs) {
    const outcome = await verify({ ...input, rpc });
    if (outcome.kind === 'verified' || !outcome.transient) return outcome;
    last = outcome;
  }
  return last ?? { kind: 'not_verified', reason: 'RPC_UNAVAILABLE', detail: 'no verifier provider', transient: true };
}
