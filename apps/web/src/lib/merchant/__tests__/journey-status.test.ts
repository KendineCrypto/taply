import { describe, expect, it } from 'vitest';
import { isVerifiedStatus, journeyStatus } from '../journey';
import type { JourneySide } from '../journey';

/** Phase 7G canonical statuses: evidence in, label out. No timers, no scans, no session events. */

const STAGES = ['awaiting', 'wallet', 'transfer', 'contract_paid', 'verified', 'failed', 'unresolved', 'cancelled'] as const;

describe('journeyStatus', () => {
  it('merchant phone: ready → observed → paid per contract → verified receipt', () => {
    const s = (stage: (typeof STAGES)[number]) => journeyStatus({ side: 'receiver', stage });
    expect(s('awaiting')).toBe('ready_for_customer');
    expect(s('transfer')).toBe('payment_observed');
    expect(s('contract_paid')).toBe('paid_per_contract');
    expect(s('verified')).toBe('verified_receipt');
  });

  it('customer phone: review → wallet → submitted → paid per contract → verified paid', () => {
    const s = (stage: (typeof STAGES)[number], ownAttemptPending = false) => journeyStatus({ side: 'payer', stage, ownAttemptPending });
    expect(s('awaiting')).toBe('ready_to_review');
    expect(s('awaiting', true)).toBe('checking_chain');
    expect(s('wallet')).toBe('awaiting_wallet');
    expect(s('transfer')).toBe('transaction_submitted');
    expect(s('contract_paid')).toBe('paid_per_contract');
    expect(s('verified')).toBe('verified_paid');
  });

  it('the merchant never shows wallet or customer activity, even if its own journal is busy', () => {
    for (const stage of STAGES) {
      const status = journeyStatus({ side: 'receiver', stage, ownAttemptPending: true });
      expect(['awaiting_wallet', 'checking_chain', 'transaction_submitted', 'ready_to_review']).not.toContain(status);
    }
  });

  it('only the verified stage can produce a verified status, on either side', () => {
    for (const side of ['receiver', 'payer'] as JourneySide[]) {
      for (const stage of STAGES) {
        for (const ownAttemptPending of [false, true]) {
          const status = journeyStatus({ side, stage, ownAttemptPending });
          expect(isVerifiedStatus(status)).toBe(stage === 'verified');
        }
      }
    }
  });

  it('a pending own attempt only changes the open state, never a later one', () => {
    for (const stage of STAGES.filter((s) => s !== 'awaiting')) {
      expect(journeyStatus({ side: 'payer', stage, ownAttemptPending: true })).toBe(journeyStatus({ side: 'payer', stage }));
    }
  });

  it('failures and cancellations read the same on both phones', () => {
    for (const side of ['receiver', 'payer'] as JourneySide[]) {
      expect(journeyStatus({ side, stage: 'failed' })).toBe('needs_attention');
      expect(journeyStatus({ side, stage: 'unresolved' })).toBe('needs_attention');
      expect(journeyStatus({ side, stage: 'cancelled' })).toBe('closed');
    }
  });
});
