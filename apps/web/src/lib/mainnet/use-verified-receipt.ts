'use client';

import { useEffect, useState } from 'react';
import { MAINNET_USDC } from '@taply/shared';
import { verifyMainnetSettlement } from '@taply/near-client';
import { locateAcrossProviders } from '@/lib/verify/locate-funding';
import type { FundingShape } from '@/lib/verify/locate-funding';
import { createFetchLocatorRpc } from '@/lib/verify/rpc';
import { MAINNET_CONFIG } from './config';
import { MAINNET_ASSETS } from './assets';
import type { MainnetRequest } from './fixtures';

type Proof = Extract<Awaited<ReturnType<typeof verifyMainnetSettlement>>, { kind: 'VERIFIED_SETTLEMENT' }>;
type State = { kind: 'checking' } | { kind: 'unavailable' } | { kind: 'verified'; proof: Proof };

/** The router account the deployed contract accepts deliveries from (get_config.routerAccountId). */
export const MAINNET_ROUTER_ACCOUNT = 'intents.near';
const HASH = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** Owner-approved USDC token code pin (same variable and rule as wallet-ops). Without it USDC never verifies. */
const USDC_PIN = ((v: string | undefined) => (v !== undefined && HASH.test(v) ? v : undefined))(process.env.NEXT_PUBLIC_TAPLY_MAINNET_USDC_CODE_HASH);

/** Both phones independently find and verify a first-attempt payout:
 *  - NEAR: the payer's `pay_instant_native`;
 *  - USDC from a NEAR wallet: the payer's `ft_transfer_call` (needs the USDC code pin);
 *  - USDC through NEAR Intents (1Click): the `intents.near` delivery (needs the USDC code pin).
 * Candidate hashes come from this browser's own records, the public 1Click hint
 * (router only) or a bounded chain search. A candidate hash or FINAL_PAID alone
 * can never produce Verified Paid: the NEAR-side verifier must prove the whole
 * funding → payout → callback graph against pinned code. For router deliveries
 * that proof covers NEAR only, never the debit on the origin chain. */
export function useVerifiedMainnetReceipt(request: MainnetRequest | null, hintNearTxs: ReadonlyArray<string> = []) {
  const [result, setResult] = useState<{ key: string; state: State } | null>(null);
  const profile = MAINNET_CONFIG.ok && !MAINNET_CONFIG.fixtures ? MAINNET_CONFIG.profile : null;
  const native = request?.terms.assetId === MAINNET_ASSETS.NEAR.id;
  const usdc = request?.terms.assetId === MAINNET_ASSETS.USDC.id && USDC_PIN !== undefined;
  const eligible = profile !== null && request?.status === 'FINAL_PAID' && request.latestOperation?.status === 'SUCCEEDED'
    && request.latestOperation.nonce === '1' && (native || usdc) && request.payerAccountId !== null;
  const router = eligible && usdc && request?.payerAccountId === MAINNET_ROUTER_ACCOUNT;
  const hints = router ? hintNearTxs.filter(h => HASH.test(h)).slice(0, 3) : [];
  const key = eligible ? JSON.stringify([profile, request.terms.id, request.termsHash, request.payerAccountId, request.fundedAtNs, request.latestOperation, hints]) : null;
  useEffect(() => {
    if (key === null || profile === null || request === null || request.payerAccountId === null) return;
    // The verifier requires the funding transaction's signer: the payer, which for a router delivery is intents.near itself.
    const payer = request.payerAccountId;
    const funding: FundingShape = native ? { kind: 'native' }
      : payer === MAINNET_ROUTER_ACCOUNT ? { kind: 'router', tokenContract: MAINNET_USDC, router: MAINNET_ROUTER_ACCOUNT }
      : { kind: 'token', tokenContract: MAINNET_USDC };
    let live = true;
    const commit = (state: State) => { if (live) setResult({ key, state }); };
    const run = async () => {
      try {
        const candidates: string[] = [...hints];
        try {
          const lines = (sessionStorage.getItem(`taply.mainnet.receipt:instant:${request.terms.id}`) ?? '').split('\n');
          for (const line of lines) {
            const [hash, signer] = line.trim().split(/\s+/);
            if (hash && HASH.test(hash) && signer === payer && !candidates.includes(hash)) candidates.push(hash);
          }
        } catch { /* Chain discovery still works without browser storage. */ }
        const tryAll = async (list: ReadonlyArray<string>) => {
          for (const transactionHash of list.slice(0, 3)) {
            if (!live) return true;
            const ref = { transactionHash, signerAccountId: payer };
            const proof = await verifyMainnetSettlement({ kind: 'instant', profile }, { id: request.terms.id, funding: ref, operations: [ref], ...(usdc ? { usdcCodeHash: USDC_PIN } : {}) });
            if (proof.kind === 'VERIFIED_SETTLEMENT' && proof.status === 'PAID' && proof.beneficiary === request.recipientAccountId
              && proof.amountBaseUnits === request.terms.amountBaseUnits && proof.assetId === request.terms.assetId
              && proof.routerDelivery === (funding.kind === 'router')) {
              commit({ kind: 'verified', proof }); return true;
            }
          }
          return false;
        };
        if (await tryAll(candidates)) return;
        const found = await locateAcrossProviders({ contractId: request.terms.contractId, request, funding, ...(funding.kind === 'router' ? { maxCalls: 160 } : funding.kind === 'token' ? { maxCalls: 80 } : {}) },
          [profile.rpcUrl, 'https://archival-rpc.mainnet.fastnear.com'].filter((v, i, all) => all.indexOf(v) === i)
            .map((rpcUrl, i) => createFetchLocatorRpc({ rpcUrl, providerId: `mainnet-receipt-${i}` })));
        if (found.kind === 'found' && await tryAll(found.candidates.filter(c => !candidates.includes(c)))) return;
        commit({ kind: 'unavailable' });
      } catch { commit({ kind: 'unavailable' }); }
    };
    void run();
    return () => { live = false; };
    // The key binds all immutable terms, deployment pins, payout facts and hint candidates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return key === null ? null : result?.key === key ? result.state : { kind: 'checking' } as State;
}
