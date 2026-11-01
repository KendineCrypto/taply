'use client';

import { useEffect, useState } from 'react';
import type { ContractRequest, VerifiedReceipt } from '@/lib/protocol';
import { verifyInstantReceipt } from './instant-receipt';
import type { VerificationFailure } from './instant-receipt';
import type { ReceiptReferences } from './references';
import type { VerifierRpc } from './rpc';

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
    };

/**
 * Runs the independent receipt verifier once per (request, references, retry
 * tick). Read-only. The result is kept in memory only: a VerifiedReceipt is
 * never cached in storage, so a later visit re-verifies against the chain.
 */
export function useReceiptVerification(input: {
  readonly rpc: VerifierRpc | null;
  readonly contractId: string;
  readonly approvedCodeHash: string;
  readonly request: ContractRequest | null;
  readonly references: ReceiptReferences | null;
  readonly generation: number;
}): VerificationView {
  const { rpc, contractId, approvedCodeHash, request, references, generation } = input;
  const applicable = request !== null && request.status === 'FINAL_PAID';
  const funding = references?.funding ?? null;
  const retries = references?.retries ?? [];
  const complete = references?.complete === true;
  const key =
    applicable && rpc !== null && complete && funding !== null
      ? [request.terms.id, funding.hash, ...retries.map((r) => r.hash), generation].join(':')
      : null;
  const [result, setResult] = useState<{
    key: string;
    view: VerificationView;
  } | null>(null);

  useEffect(() => {
    if (key === null || rpc === null || request === null || funding === null) return;
    let active = true;
    void verifyInstantReceipt({
      rpc,
      contractId,
      approvedCodeHash,
      requestId: request.terms.id,
      fundingTransaction: funding,
      retryTransactions: retries,
    }).then((outcome) => {
      if (!active) return;
      setResult({
        key,
        view:
          outcome.kind === 'verified'
            ? { kind: 'verified', receipt: outcome.receipt }
            : {
                kind: 'failed',
                reason: outcome.reason,
                transient: outcome.transient,
              },
      });
    });
    return () => {
      active = false;
    };
    // `key` captures request ID, references and generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, rpc, contractId, approvedCodeHash]);

  if (!applicable) return { kind: 'not_applicable' };
  if (rpc === null) return { kind: 'unavailable' };
  if (!complete) return { kind: 'missing_reference' };
  if (result === null || result.key !== key) return { kind: 'checking' };
  return result.view;
}
