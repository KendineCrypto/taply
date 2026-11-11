import { describe, expect, it } from 'vitest';
import { CALLER_ROLES, ContractRequestSchema } from '@/lib/protocol';
import type { CallerRole, ChainState, DerivedPaymentActions } from '@/lib/protocol';
import { isVerifiedPaid } from '@/lib/protocol/presentation';
import { mapChainState } from '../map-chain-state';
import { locateFundingTransaction } from '@/lib/verify/locate-funding';
import views from './fixtures/r2-sandbox-request-views.json';

/**
 * R-2, client side. These request views were produced by REAL NEAR sandbox
 * runs (contracts/payments-r2/sandbox/tests/r2.rs), for the deployed escrow
 * source ("legacy") and the R-2 candidate:
 *  1: transfer succeeded, callback panicked;
 *  2: transfer succeeded, callback ran out of gas;
 *  3: transfer FAILED (recipient missing) AND callback panicked: nothing was
 *     received.
 * In none of them may any client path show the payment as paid or Verified
 * Paid, even with the most permissive inputs (fresh final RPC read, a claimed
 * verified receipt, every gate open, every caller role).
 */
const RESIDUAL = Object.entries(views).filter(([name]) => /^[123]-/.test(name));

function permissive(callerRole: CallerRole): DerivedPaymentActions {
  return {
    callerRole,
    cancelWindowOpen: true,
    releaseEligible: true,
    retry: { eligible: true, operationNonce: '1', kind: 'INSTANT_PAYOUT' },
  };
}

describe('R-2 residual states never look paid', () => {
  it('covers both R-2 variants for the deployed source and the candidate', () => {
    expect(RESIDUAL.map(([name]) => name).sort()).toEqual([
      '1-success-callback-panic-candidate',
      '1-success-callback-panic-legacy',
      '2-success-callback-oog-candidate',
      '3-failed-transfer-callback-panic-candidate',
      '3-failed-transfer-callback-panic-legacy',
    ]);
  });

  for (const [name, raw] of RESIDUAL) {
    it(`${name}: parses, is in flight, and no presentation or verifier path calls it paid`, async () => {
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
      const located = await locateFundingTransaction({
        rpc: rpc as never,
        contractId: request.terms.contractId,
        request,
      });
      expect(located).toEqual({ kind: 'not_applicable', reason: 'not_final_paid' });
    });
  }

  it('control: a confirmed refund from the same runs parses and is still never "paid"', () => {
    const request = ContractRequestSchema.parse(views['6-concurrent-cancel-release']);
    expect(request.status).toBe('CANCELLED_REFUNDED');
    expect(isVerifiedPaid(request.status, 'verified_final', 'rpc')).toBe(false);
  });
});
