'use client';

import { useEffect, useState } from 'react';
import type { ContractRequest, VerifiedReceipt } from '@/lib/protocol';
import type { VerificationFailure } from './instant-receipt';
import { nextAutoRetryDelay } from './retry-policy';
import type { ReceiptReferences } from './references';
import type { VerifierRpc } from './rpc';
import { verifyAcrossProviders } from './fallback';

export type VerificationView =
  /** The contract does not report FINAL_PAID: there is nothing to verify. */
  | { readonly kind: 'not_applicable' }
  /** This build has no verifier RPC configured. */
  | { readonly kind: 'unavailable' }
  /** Paid per contract, but this device lacks a needed transaction hash. */
  | { readonly kind: 'missing_reference' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'verified'; readonly receipt: VerifiedReceipt }
  | {
      readonly kind: 'failed';
      readonly reason: VerificationFailure;
      readonly transient: boolean;
      /** Provider-requested wait (rate limit), in ms from `failedAt`. */
      readonly retryAfterMs: number | null;
      /** Epoch ms of this failed attempt (device clock, display only). */
      readonly failedAt: number;
      /** Epoch ms of the next automatic attempt, or null when it waits for the person. */
      readonly autoRetryAt: number | null;
    };

/**
 * Runs the independent receipt verifier with bounded retries for transient RPC
 * lag/finality failures (schedule in `retry-policy.ts`; rate limits honoured,
 * long provider waits left to the person). Read-only. The result is kept in memory only: a VerifiedReceipt is
 * never cached in storage, so a later visit re-verifies against the chain.
 */
export function useReceiptVerification(input: {
  readonly rpc: VerifierRpc | null;
  /** Optional second provider; used only when `rpc` fails transiently (lib/verify/fallback.ts). */
  readonly fallbackRpc?: VerifierRpc | null;
  readonly contractId: string;
  readonly approvedCodeHash: string;
  readonly request: ContractRequest | null;
  readonly references: ReceiptReferences | null;
  readonly generation: number;
}): VerificationView {
  const { rpc, contractId, approvedCodeHash, request, references, generation } = input;
  const fallbackRpc = input.fallbackRpc ?? null;
  const applicable = request !== null && request.status === 'FINAL_PAID';
  const funding = references?.funding ?? null;
  const retries = references?.retries ?? [];
  const complete = references?.complete === true;
  const key =
    applicable && rpc !== null && complete && funding !== null
      ? JSON.stringify([contractId, approvedCodeHash, rpc.providerId, fallbackRpc?.providerId ?? null, request.terms.id, request.termsHash,
          request.latestOperation?.nonce, funding, retries, generation])
      : null;
  const [result, setResult] = useState<{
    key: string;
    view: VerificationView;
  } | null>(null);

  useEffect(() => {
    if (key === null || rpc === null || request === null || funding === null) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retriesUsed = 0;
    let waitingForVisible = false;
    const run = async () => {
      if (!active) return;
      if (document.visibilityState === 'hidden') {
        waitingForVisible = true;
        return;
      }
      waitingForVisible = false;
      const outcome = await verifyAcrossProviders(
        { contractId, approvedCodeHash, requestId: request.terms.id, fundingTransaction: funding, retryTransactions: retries },
        fallbackRpc === null ? [rpc] : [rpc, fallbackRpc],
      );
      if (!active) return;
      if (outcome.kind === 'verified') {
        setResult({ key, view: { kind: 'verified', receipt: outcome.receipt } });
        return;
      }
      const failedAt = Date.now();
      const delay = nextAutoRetryDelay(outcome, retriesUsed);
      setResult({
        key,
        view: {
          kind: 'failed',
          reason: outcome.reason,
          transient: outcome.transient,
          retryAfterMs: outcome.retryAfterMs ?? null,
          failedAt,
          autoRetryAt: delay === null ? null : failedAt + delay,
        },
      });
      if (delay !== null) {
        retriesUsed += 1;
        timer = setTimeout(() => void run(), delay);
      }
    };
    const onVisible = () => {
      if (waitingForVisible && document.visibilityState === 'visible') void run();
    };
    document.addEventListener('visibilitychange', onVisible);
    void run();
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // `key` captures the contract/version, request terms/operation, references and generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, rpc, fallbackRpc, contractId, approvedCodeHash]);

  if (!applicable) return { kind: 'not_applicable' };
  if (rpc === null) return { kind: 'unavailable' };
  if (!complete) return { kind: 'missing_reference' };
  if (result === null || result.key !== key) return { kind: 'checking' };
  return result.view;
}
