import { describe, expect, it } from 'vitest';
import { CALLER_ROLES, ContractRequestSchema } from '@/lib/protocol';
import type { CallerRole, ChainState, DerivedPaymentActions } from '@/lib/protocol';
import { isVerifiedPaid } from '@/lib/protocol/presentation';
import { mapChainState } from '../map-chain-state';
import { locateFundingTransaction } from '@/lib/verify/locate-funding';
import views from './fixtures/r2-deployed-escrow-views.json';

/**
 * Known risk R-2 (docs/SECURITY_REVIEW_2026-11-09.md), client side.
 *
 * These request views were read from a REAL local NEAR node (near-workspaces
 * sandbox, 2026-11-11) running the deployed escrow source
 * (contracts/payments-protected, code hash 963iSEB8...) built with a test-only
 * fault that makes the payout callback panic:
 *  1-success-callback-panic: the transfer arrived, the callback panicked;
 *  3-failed-transfer-callback-panic: the transfer FAILED (recipient account
 *    missing) and the callback panicked, so the recipient received nothing.
 * The contract leaves both PAYOUT_IN_FLIGHT forever. No client path may call
 * either paid or Verified Paid, even with the most permissive inputs: a fresh
 * final RPC read, a claimed verified receipt, every gate open, every role.
 * (Sandbox source and the R-2 analysis: draft PR #31, not merged.)
 */
const CASES = Object.entries(views);

function permissive(callerRole: CallerRole): DerivedPaymentActions {
  return {
    callerRole,
    cancelWindowOpen: true,
    releaseEligible: true,
    retry: { eligible: true, operationNonce: '1', kind: 'INSTANT_PAYOUT' },
  };
}

describe('R-2: a payout whose callback never completed never looks paid', () => {
  it('covers both R-2 variants', () => {
    expect(CASES.map(([name]) => name).sort()).toEqual(['1-success-callback-panic', '3-failed-transfer-callback-panic']);
  });

  for (const [name, raw] of CASES) {
    it(`${name}: parses, stays in flight, and no presentation or verifier path calls it paid`, async () => {
      const request = ContractRequestSchema.parse(raw);
      expect(request.status).toBe('PAYOUT_IN_FLIGHT');
      expect(request.latestOperation?.status).toBe('IN_FLIGHT');
      const state = request.status as ChainState;
      expect(isVerifiedPaid(state, 'verified_final', 'rpc')).toBe(false);
      for (const role of CALLER_ROLES) {
        const p = mapChainState({
          state,
          observation: { assurance: 'verified_final', source: 'rpc', stale: false, rpcAvailable: true },
          derived: permissive(role),
          fundingEligibility: 'ELIGIBLE',
          incident: null,
          settlementProof: 'verified_receipt', // even a (forged) claim of a verified receipt
        });
        expect(p.verifiedRibbon).toBe(false);
        expect(p.contractReportsPaid).toBe(false);
        expect(p.tone).not.toBe('success');
        expect(p.money).not.toBe('to_recipient');
      }
      // The independent verifier's funding locator refuses before any RPC call.
      const rpc = { call: () => Promise.reject(new Error('must not be called')) };
      const located = await locateFundingTransaction({ rpc: rpc as never, contractId: request.terms.contractId, request });
      expect(located).toEqual({ kind: 'not_applicable', reason: 'not_final_paid' });
    });
  }
});
