import { describe, expect, it } from 'vitest';
import { FIXTURES, memoryStorage, must } from '@/test/chain';
import { hashOf } from '@/lib/verify/__tests__/fake-chain';
import { FOLLOW_UP_WINDOW_MS, claimFollowUp, ownFundingAttempt, ownSaleCreation, receiptPath } from '../follow-up';
import type { JournalEntry } from '../journal';

/** Phase 6A: same-device receipt follow-up and reference propagation. */

const { paidRestricted, openRestricted, paidAfterRetry } = FIXTURES;
const PAYER = must(paidRestricted.payerAccountId, 'a payer');
const FUND = hashOf('funding');
const T0 = Date.parse('2026-11-01T10:00:00.000Z');

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  const at = new Date(T0).toISOString();
  return {
    method: 'pay_instant_native',
    network: 'near-testnet',
    contractId: paidRestricted.terms.contractId,
    requestId: paidRestricted.terms.id,
    termsHash: paidRestricted.termsHash,
    signerAccountId: PAYER,
    terms: null,
    operationNonce: null,
    phase: 'RESOLVED',
    transactionHash: FUND,
    startedAt: at,
    updatedAt: at,
    ...overrides,
  };
}

describe('receiptPath', () => {
  it('carries this device’s funding hash as a hint', () => {
    expect(receiptPath(paidRestricted, [entry()])).toBe(`/receipt/${paidRestricted.terms.id}?ftx=${FUND}`);
  });

  it('never manufactures a hint: no hash on this device means a plain receipt path', () => {
    expect(receiptPath(paidRestricted, [entry({ transactionHash: null })])).toBe(`/receipt/${paidRestricted.terms.id}`);
    expect(receiptPath(paidRestricted, [])).toBe(`/receipt/${paidRestricted.terms.id}`);
    // A hash journaled by someone other than the payer is not the funding hash.
    expect(receiptPath(paidRestricted, [entry({ signerAccountId: 'mallory.testnet' })])).toBe(
      `/receipt/${paidRestricted.terms.id}`,
    );
  });

  it('a paid-after-retry receipt without the retry hash carries only the funding hint', () => {
    const fund = entry({ requestId: paidAfterRetry.terms.id, signerAccountId: must(paidAfterRetry.payerAccountId, 'payer') });
    expect(receiptPath(paidAfterRetry, [fund])).toBe(`/receipt/${paidAfterRetry.terms.id}?ftx=${FUND}`);
  });

  it('not paid: no hint', () => {
    expect(receiptPath(openRestricted, [entry({ requestId: openRestricted.terms.id })])).toBe(
      `/receipt/${openRestricted.terms.id}`,
    );
  });
});

describe('ownFundingAttempt', () => {
  it('is this device’s recent funding attempt for a FINAL_PAID request', () => {
    expect(ownFundingAttempt(paidRestricted, [entry()], T0 + 60_000)).not.toBeNull();
    // With or without a hash: the receipt then says honestly what is missing.
    expect(ownFundingAttempt(paidRestricted, [entry({ transactionHash: null })], T0 + 60_000)).not.toBeNull();
  });

  it('ignores old attempts, declined ones, other signers and unpaid requests', () => {
    expect(ownFundingAttempt(paidRestricted, [entry()], T0 + FOLLOW_UP_WINDOW_MS + 1)).toBeNull();
    expect(ownFundingAttempt(paidRestricted, [entry({ phase: 'USER_REJECTED' })], T0)).toBeNull();
    expect(ownFundingAttempt(paidRestricted, [entry({ signerAccountId: 'mallory.testnet' })], T0)).toBeNull();
    expect(ownFundingAttempt(openRestricted, [entry({ requestId: openRestricted.terms.id })], T0)).toBeNull();
  });
});

describe('ownSaleCreation (the cashier who created the sale)', () => {
  const CREATOR = paidRestricted.terms.creatorAccountId;
  const created = (overrides: Partial<JournalEntry> = {}) =>
    entry({ method: 'create_request', signerAccountId: CREATOR, transactionHash: hashOf('create'), ...overrides });

  it('is this device’s recent create_request for a FINAL_PAID request', () => {
    expect(ownSaleCreation(paidRestricted, [created()], T0 + 60_000)).not.toBeNull();
  });

  it('ignores old sales, declined prompts, other signers, other methods and unpaid requests', () => {
    expect(ownSaleCreation(paidRestricted, [created()], T0 + FOLLOW_UP_WINDOW_MS + 1)).toBeNull();
    expect(ownSaleCreation(paidRestricted, [created({ phase: 'USER_REJECTED' })], T0)).toBeNull();
    expect(ownSaleCreation(paidRestricted, [created({ signerAccountId: 'mallory.testnet' })], T0)).toBeNull();
    // The payer's own attempt is not a sale this device created.
    expect(ownSaleCreation(paidRestricted, [entry()], T0)).toBeNull();
    expect(ownSaleCreation(openRestricted, [created({ requestId: openRestricted.terms.id })], T0)).toBeNull();
  });

  it('its receipt path carries no invented hint (the receipt finds the funding transaction itself)', () => {
    expect(receiptPath(paidRestricted, [created()])).toBe(`/receipt/${paidRestricted.terms.id}`);
  });
});

describe('claimFollowUp', () => {
  it('fires once per attempt, so a reload or "Back to payment" never loops', () => {
    const storage = memoryStorage();
    expect(claimFollowUp(storage, entry())).toBe(true);
    expect(claimFollowUp(storage, entry())).toBe(false);
    // A new attempt (new start time) is followed again.
    expect(claimFollowUp(storage, entry({ startedAt: new Date(T0 + 1000).toISOString() }))).toBe(true);
  });

  it('without storage it never fires', () => {
    expect(claimFollowUp(null, entry())).toBe(false);
  });
});
