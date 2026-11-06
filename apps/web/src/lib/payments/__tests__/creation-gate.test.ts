import { describe, expect, it } from 'vitest';
import { blockingCreations, latestRecentCreation, recheckDelayMs, RECENT_CREATION_WINDOW_MS } from '../creation-gate';
import type { JournalEntry } from '../journal';
import type { IntentTerms } from '@/lib/protocol';

const C = 'payments.testnet';
const NOW = Date.parse('2026-11-01T12:00:00.000Z');
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const entry = (over: Partial<JournalEntry>): JournalEntry =>
  ({
    method: 'create_request',
    network: 'near-testnet',
    contractId: C,
    requestId: 'a'.repeat(64),
    termsHash: 'b'.repeat(64),
    signerAccountId: 'shop.testnet',
    terms: { memo: '' } as unknown as IntentTerms,
    operationNonce: null,
    phase: 'SUBMITTED',
    transactionHash: null,
    startedAt: at(1000),
    updatedAt: at(1000),
    ...over,
  }) as JournalEntry;

describe('creation gate', () => {
  it('blocks only on unexplained creations by this account on this contract', () => {
    const list = [
      entry({ requestId: '1'.repeat(64) }),
      entry({ requestId: '2'.repeat(64), phase: 'RESOLVED' }),
      entry({ requestId: '3'.repeat(64), phase: 'USER_REJECTED' }),
      entry({ requestId: '4'.repeat(64), signerAccountId: 'other.testnet' }),
      entry({ requestId: '5'.repeat(64), contractId: 'old.testnet' }),
      entry({ requestId: '6'.repeat(64), method: 'pay_instant_native', terms: null }),
      entry({ requestId: '7'.repeat(64), phase: 'OUTCOME_UNKNOWN' }),
      entry({ requestId: '8'.repeat(64), phase: 'AWAITING_SIGNATURE' }),
      entry({ requestId: '9'.repeat(64), phase: 'USER_REJECTED', notDispatched: true }),
    ];
    // '3' is a legacy USER_REJECTED without local no-dispatch evidence: still blocking (F-01).
    // '9' was refused locally before any wallet call: nonblocking.
    expect(blockingCreations(list, 'shop.testnet', C).map((e) => e.requestId[0])).toEqual(['1', '3', '7', '8']);
  });

  it('latest recent creation: newest, within the window, never a decline', () => {
    const list = [
      entry({ requestId: '1'.repeat(64), startedAt: at(5_000) }),
      entry({ requestId: '2'.repeat(64), startedAt: at(1_000), phase: 'USER_REJECTED' }),
      entry({ requestId: '3'.repeat(64), startedAt: at(3_000), phase: 'RESOLVED' }),
      entry({ requestId: '4'.repeat(64), startedAt: at(RECENT_CREATION_WINDOW_MS + 1) }),
    ];
    expect(latestRecentCreation(list, 'shop.testnet', C, NOW)?.requestId[0]).toBe('3');
    expect(latestRecentCreation([list[3] as JournalEntry], 'shop.testnet', C, NOW)).toBeNull();
    expect(latestRecentCreation(list, 'other.testnet', C, NOW)).toBeNull();
  });

  it('re-check backoff is bounded', () => {
    expect([0, 1, 2, 3, 4, 5, 50].map(recheckDelayMs)).toEqual([3000, 6000, 12000, 24000, 30000, 30000, 30000]);
  });
});
