import { describe, expect, it } from 'vitest';
import { ContractRequestSchema } from '@/lib/protocol';
import pilotJson from '@/test/fixtures/testnet/pilot-request.json';
import {
  SPLIT_STORAGE_KEY,
  childMemo,
  childStatusFromChain,
  createSplit,
  equalShares,
  groupStatus,
  isLocked,
  loadSplits,
  planSplit,
  recordChild,
  saveSplits,
  verifiedAmount,
} from '../split';
import type { ChildStatus, SplitGroup, SplitInput } from '../split';

const ME = 'taplytest.testnet';
const NOW = new Date('2026-11-08T10:00:00.000Z');
let n = 0;
const pid = () => `person-${String(++n).padStart(4, '0')}`;
const PILOT = ContractRequestSchema.parse(pilotJson);

function input(over: Partial<SplitInput> = {}): SplitInput {
  return {
    name: 'Dinner',
    total: '1',
    mode: 'equal',
    memo: '',
    people: [
      { label: 'Ali', account: 'ali.testnet', share: '' },
      { label: 'Ayşe', account: '', share: '' },
      { label: 'Can', account: 'can.testnet', share: '' },
    ],
    ...over,
  };
}

function group(over: Partial<SplitInput> = {}): SplitGroup {
  const r = createSplit(input(over), { recipientAccountId: ME, now: NOW, id: 'group-00001', participantId: pid });
  if (!r.ok) throw new Error(r.problems.join(','));
  return r.group;
}

describe('exact integer split (T22)', () => {
  it.each([
    [1n, 3],
    [2n, 3],
    [10n ** 24n, 3],
    [10n ** 24n + 1n, 7],
    [(1n << 128n) - 1n, 20],
    [5n, 5],
  ])('splits %s yocto into %i shares that add up exactly and differ by at most 1', (total, people) => {
    const shares = equalShares(total, people);
    expect(shares).toHaveLength(people);
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(total);
    const min = shares.reduce((a, b) => (b < a ? b : a));
    const max = shares.reduce((a, b) => (b > a ? b : a));
    expect(max - min <= 1n).toBe(true);
  });

  it('1 NEAR between 3 people: the first person gets the extra yoctoNEAR, nothing is lost', () => {
    const g = group();
    expect(g.participants.map((p) => p.amountBaseUnits)).toEqual(['333333333333333333333334', '333333333333333333333333', '333333333333333333333333']);
    expect(g.participants.reduce((a, p) => a + BigInt(p.amountBaseUnits), 0n)).toBe(10n ** 24n);
  });

  it('refuses an equal split that would leave someone with zero', () => {
    expect(planSplit(input({ total: '0.000000000000000000000002' }), ME)).toMatchObject({ ok: false, problems: ['share_zero'] });
  });

  it('custom shares must add up exactly; the difference is reported in base units', () => {
    const people = [
      { label: 'Ali', account: '', share: '0.5' },
      { label: 'Can', account: '', share: '0.499999999999999999999999' },
    ];
    expect(planSplit(input({ mode: 'custom', people }), ME)).toEqual({ ok: false, problems: ['shares_do_not_add_up'], difference: 1n });
    const exact = planSplit(input({ mode: 'custom', people: [people[0]!, { ...people[1]!, share: '0.5' }] }), ME);
    expect(exact.ok && exact.shares).toEqual([5n * 10n ** 23n, 5n * 10n ** 23n]);
  });

  it.each([
    [{ people: [{ label: 'Solo', account: '', share: '' }] }, 'too_few_people'],
    [{ total: '' }, 'total_required'],
    [{ total: '0' }, 'total_zero'],
    [{ total: '1e2' }, 'total_invalid'],
    [{ people: [{ label: 'A', account: ME, share: '' }, { label: 'B', account: '', share: '' }] }, 'person_is_recipient'],
    [{ people: [{ label: 'A', account: 'x.testnet', share: '' }, { label: 'B', account: 'x.testnet', share: '' }] }, 'duplicate_person_account'],
    [{ people: [{ label: '', account: '', share: '' }, { label: 'B', account: '', share: '' }] }, 'person_label_invalid'],
    [{ people: [{ label: 'A', account: 'Bad!', share: '' }, { label: 'B', account: '', share: '' }] }, 'person_account_invalid'],
  ])('refuses %j', (over, problem) => {
    const r = planSplit(input(over as Partial<SplitInput>), ME);
    expect(r.ok === false && r.problems).toContain(problem);
  });
});

describe('children', () => {
  it('each child request is recorded once, never shared between people, and locks the plan', () => {
    const g = group();
    const [a, b] = g.participants;
    const id1 = 'a'.repeat(64);
    expect(isLocked(g)).toBe(false);
    const r1 = recordChild(g, a!.id, id1, NOW);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(isLocked(r1.group)).toBe(true);
    expect(recordChild(r1.group, a!.id, 'b'.repeat(64), NOW)).toEqual({ ok: false, reason: 'already_recorded' });
    expect(recordChild(r1.group, b!.id, id1, NOW)).toEqual({ ok: false, reason: 'request_used_twice' });
    expect(recordChild(r1.group, 'nobody-0000', 'c'.repeat(64), NOW)).toEqual({ ok: false, reason: 'unknown_participant' });
  });

  it('child memo names the share and always fits the 256-byte request memo', () => {
    const g = group({ memo: 'ş'.repeat(100) });
    expect(childMemo(g, 0)).toBe(`${'ş'.repeat(100)} · Split 1/3: Ali`);
    const long = group({ memo: 'ş'.repeat(100), people: input().people.map((p, i) => ({ ...p, label: `${'ğ'.repeat(39)}${i}` })) });
    expect(new TextEncoder().encode(childMemo(long, 0)).length).toBeLessThanOrEqual(256);
  });
});

describe('chain status per share', () => {
  // The REAL pilot request (recorded view result) as the chain answer for one share.
  const pilotGroup: SplitGroup = {
    id: 'group-pilot1',
    name: 'Pilot',
    recipientAccountId: ME,
    totalBaseUnits: '200000000000000000000000',
    mode: 'equal',
    memo: '',
    participants: [
      { id: 'person-p1', label: 'One', accountId: null, amountBaseUnits: '100000000000000000000000', requestId: PILOT.terms.id, recordedAt: NOW.toISOString() },
      { id: 'person-p2', label: 'Two', accountId: null, amountBaseUnits: '100000000000000000000000', requestId: null, recordedAt: null },
    ],
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
  const contract = 'taply-pay-pilot-1.testnet';

  it('maps a matching FINAL_PAID request to paid per contract (not verified)', () => {
    expect(childStatusFromChain(pilotGroup, pilotGroup.participants[0]!, PILOT, '1793600000000000000', contract)).toBe('paid_per_contract');
    expect(childStatusFromChain(pilotGroup, pilotGroup.participants[1]!, null, null, contract)).toBe('not_created');
  });

  it('a request that does not match the share never counts (amount, payer, recipient, contract)', () => {
    const p = pilotGroup.participants[0]!;
    expect(childStatusFromChain(pilotGroup, { ...p, amountBaseUnits: '1' }, PILOT, null, contract)).toBe('mismatch');
    expect(childStatusFromChain(pilotGroup, { ...p, accountId: 'someone.testnet' }, PILOT, null, contract)).toBe('mismatch');
    expect(childStatusFromChain({ ...pilotGroup, recipientAccountId: 'other.testnet' }, p, PILOT, null, contract)).toBe('mismatch');
    expect(childStatusFromChain(pilotGroup, p, PILOT, null, 'other-contract.testnet')).toBe('mismatch');
    expect(childStatusFromChain(pilotGroup, { ...p, requestId: 'f'.repeat(64) }, PILOT, null, contract)).toBe('mismatch');
  });

  it('an OPEN request past its chain expiry is expired; before it, open', () => {
    const open = { ...PILOT, status: 'OPEN' as const };
    const p = pilotGroup.participants[0]!;
    expect(childStatusFromChain(pilotGroup, p, open, PILOT.terms.fundingExpiresAtNs, contract)).toBe('expired');
    expect(childStatusFromChain(pilotGroup, p, open, '1', contract)).toBe('open');
  });
});

describe('group status: final only when every share is Verified Paid', () => {
  it.each<[ChildStatus[], string]>([
    [['verified', 'verified', 'verified'], 'settled_verified'],
    [['verified', 'paid_per_contract', 'verified'], 'paid_unverified'],
    [['paid_per_contract', 'paid_per_contract'], 'paid_unverified'],
    [['verified', 'open', 'open'], 'partial'],
    [['in_flight', 'open'], 'partial'],
    [['open', 'open'], 'waiting'],
    [['verified', 'not_created'], 'preparing'],
    [['verified', 'unknown'], 'partial'],
    [['unknown', 'open'], 'waiting'],
    [['verified', 'expired'], 'needs_attention'],
    [['verified', 'mismatch'], 'needs_attention'],
    [['verified', 'payout_failed'], 'needs_attention'],
    [['verified', 'checking'], 'partial'],
  ])('%j -> %s', (children, expected) => {
    expect(groupStatus(children)).toBe(expected);
  });

  it('counts only verified shares in the verified total', () => {
    const g = group();
    expect(verifiedAmount(g, ['verified', 'paid_per_contract', 'verified'])).toBe(333333333333333333333334n + 333333333333333333333333n);
  });
});

describe('storage', () => {
  function memory() {
    const d = new Map<string, string>();
    return { getItem: (k: string) => d.get(k) ?? null, setItem: (k: string, v: string) => void d.set(k, v), removeItem: (k: string) => void d.delete(k) };
  }
  it('round-trips', () => {
    const s = memory();
    const g = group();
    saveSplits(s, [g]);
    expect(loadSplits(s)).toEqual({ status: 'ok', groups: [g] });
  });
  it('refuses a stored plan whose shares do not add up, or that reuses a request', () => {
    const s = memory();
    const g = group();
    s.setItem(SPLIT_STORAGE_KEY, JSON.stringify({ version: 1, groups: [{ ...g, totalBaseUnits: '2000000000000000000000000' }] }));
    expect(loadSplits(s)).toEqual({ status: 'corrupt' });
    const reused = { ...g, participants: g.participants.map((p) => ({ ...p, requestId: 'a'.repeat(64), recordedAt: NOW.toISOString() })) };
    s.setItem(SPLIT_STORAGE_KEY, JSON.stringify({ version: 1, groups: [reused] }));
    expect(loadSplits(s)).toEqual({ status: 'corrupt' });
  });
});
