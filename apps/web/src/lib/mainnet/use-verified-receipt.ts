'use client';

import { useEffect, useState } from 'react';
import { verifyMainnetSettlement } from '@taply/near-client';
import { locateAcrossProviders } from '@/lib/verify/locate-funding';
import { createFetchLocatorRpc } from '@/lib/verify/rpc';
import { MAINNET_CONFIG } from './config';
import { MAINNET_ASSETS } from './assets';
import type { MainnetRequest } from './fixtures';

type Proof = Extract<Awaited<ReturnType<typeof verifyMainnetSettlement>>, { kind: 'VERIFIED_SETTLEMENT' }>;
type State = { kind: 'checking' } | { kind: 'unavailable' } | { kind: 'verified'; proof: Proof };

/** Both phones independently find and verify a first-attempt native payout.
 * A candidate hash or FINAL_PAID alone can never produce Verified Paid. */
export function useVerifiedMainnetReceipt(request: MainnetRequest | null) {
  const [result, setResult] = useState<{ key: string; state: State } | null>(null);
  const profile = MAINNET_CONFIG.ok && !MAINNET_CONFIG.fixtures ? MAINNET_CONFIG.profile : null;
  const eligible = profile !== null && request?.status === 'FINAL_PAID' && request.latestOperation?.status === 'SUCCEEDED'
    && request.latestOperation.nonce === '1' && request.terms.assetId === MAINNET_ASSETS.NEAR.id && request.payerAccountId !== null;
  const key = eligible ? JSON.stringify([profile, request.terms.id, request.termsHash, request.payerAccountId, request.fundedAtNs, request.latestOperation]) : null;
  useEffect(() => {
    if (key === null || profile === null || request === null || request.payerAccountId === null) return;
    const payer = request.payerAccountId;
    let live = true;
    const commit = (state: State) => { if (live) setResult({ key, state }); };
    const run = async () => {
      try {
        const candidates: string[] = [];
        try {
          const lines = (sessionStorage.getItem(`taply.mainnet.receipt:instant:${request.terms.id}`) ?? '').split('\n');
          for (const line of lines) {
            const [hash, signer] = line.trim().split(/\s+/);
            if (hash && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(hash) && signer === payer) candidates.push(hash);
          }
        } catch { /* Chain discovery still works without browser storage. */ }
        if (candidates.length === 0) {
          const found = await locateAcrossProviders({ contractId: request.terms.contractId, request },
            [profile.rpcUrl, 'https://archival-rpc.mainnet.fastnear.com'].filter((v, i, all) => all.indexOf(v) === i)
              .map((rpcUrl, i) => createFetchLocatorRpc({ rpcUrl, providerId: `mainnet-receipt-${i}` })));
          if (found.kind === 'found') candidates.push(...found.candidates);
        }
        for (const transactionHash of candidates.slice(0, 3)) {
          if (!live) return;
          const funding = { transactionHash, signerAccountId: payer };
          const proof = await verifyMainnetSettlement({ kind: 'instant', profile }, { id: request.terms.id, funding, operations: [funding] });
          if (proof.kind === 'VERIFIED_SETTLEMENT' && proof.status === 'PAID' && proof.beneficiary === request.recipientAccountId
            && proof.amountBaseUnits === request.terms.amountBaseUnits && proof.assetId === request.terms.assetId) {
            commit({ kind: 'verified', proof }); return;
          }
        }
        commit({ kind: 'unavailable' });
      } catch { commit({ kind: 'unavailable' }); }
    };
    void run();
    return () => { live = false; };
    // The key binds all immutable terms, deployment pins and payout facts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return key === null ? null : result?.key === key ? result.state : { kind: 'checking' } as State;
}
