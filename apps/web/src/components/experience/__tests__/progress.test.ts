import { describe, expect, it } from 'vitest';
import { CHAIN_STATES } from '@/lib/protocol';
import { STAGE_TONE, progressStageFor, stepsFor } from '../progress';
import type { ProgressStage } from '../progress';

const base = { incident: false, walletPending: false, verified: false };

describe('progressStageFor', () => {
  it('maps every Instant Pay state to its stage', () => {
    expect(progressStageFor({ ...base, state: 'OPEN' })).toBe('awaiting');
    expect(progressStageFor({ ...base, state: 'OPEN', walletPending: true })).toBe('wallet');
    expect(progressStageFor({ ...base, state: 'PAYOUT_IN_FLIGHT' })).toBe('transfer');
    expect(progressStageFor({ ...base, state: 'PAYOUT_IN_FLIGHT', incident: true })).toBe('unresolved');
    expect(progressStageFor({ ...base, state: 'PAYOUT_FAILED_RECOVERABLE' })).toBe('failed');
    expect(progressStageFor({ ...base, state: 'FINAL_PAID' })).toBe('contract_paid');
    expect(progressStageFor({ ...base, state: 'FINAL_PAID', verified: true })).toBe('verified');
    expect(progressStageFor({ ...base, state: 'CANCELLED_UNFUNDED' })).toBe('cancelled');
  });

  it('never produces "verified" (the success treatment) without FINAL_PAID + a verification', () => {
    for (const state of CHAIN_STATES) {
      for (const incident of [false, true]) {
        for (const walletPending of [false, true]) {
          const unverified = progressStageFor({ state, incident, walletPending, verified: false });
          expect(unverified).not.toBe('verified');
          const claimed = progressStageFor({ state, incident, walletPending, verified: true });
          if (state !== 'FINAL_PAID') expect(claimed).not.toBe('verified');
        }
      }
    }
  });

  it('only the verified stage carries the success tone', () => {
    const successStages = (Object.keys(STAGE_TONE) as ProgressStage[]).filter((s) => STAGE_TONE[s] === 'success');
    expect(successStages).toEqual(['verified']);
  });

  it('returns null for Protected Pay states so callers fall back to the status badge', () => {
    expect(progressStageFor({ ...base, state: 'LOCKED' })).toBeNull();
  });
});

describe('stepsFor', () => {
  it('marks the verification step done only for verified', () => {
    expect(stepsFor('verified').verified).toBe('done');
    // Contract confirmed; the independent check is pending, never "done".
    expect(stepsFor('contract_paid').contract).toBe('done');
    expect(stepsFor('contract_paid').verified).toBe('current');
  });

  it('flags the transfer step on failure and unresolved', () => {
    expect(stepsFor('failed').transfer).toBe('failed');
    expect(stepsFor('unresolved').transfer).toBe('failed');
    expect(stepsFor('failed').contract).toBe('todo');
  });

  it('awaiting has only the creation done', () => {
    expect(stepsFor('awaiting')).toEqual({ created: 'done', approved: 'current', transfer: 'todo', contract: 'todo', verified: 'todo' });
  });
});
