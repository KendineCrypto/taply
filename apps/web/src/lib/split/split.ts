import { z } from 'zod';
import { InvalidAmountError, toBaseUnits } from '@/lib/format/amount';
import { normalizeLabel } from '@/lib/contacts/contacts';
import { AccountIdSchema } from '@/lib/protocol';
import type { ContractRequest } from '@/lib/protocol';

/**
 * Split Pay MVP (E3). One total, several people, one independent request each.
 *
 *  - All arithmetic is BigInt in yoctoNEAR. An equal split gives the remainder
 *    (at most n-1 yoctoNEAR) one by one to the first people, so the shares
 *    always add up to the exact total. Custom shares must add up exactly.
 *  - Each share becomes its own ordinary request, created by the person who is
 *    owed (the connected account) through the normal request form, optionally
 *    restricted to that participant's account. Nothing is created, signed or
 *    charged automatically.
 *  - Shares are locked once any share has a request: changing the split then
 *    means a new group, so a created request never disagrees with its plan.
 *  - Group status is computed from each child's chain status. The group is
 *    "settled" ONLY when every child is Verified Paid by the independent
 *    receipt verifier in this session. Paid per contract is not enough, a DEMO
 *    state never counts, and anything unknown keeps the group open.
 */

export const SPLIT_STORAGE_KEY = 'taply.split.v1';
export const MAX_GROUPS = 30;
export const MAX_PARTICIPANTS = 20;
const U128_MAX = (1n << 128n) - 1n;

export interface Participant {
  readonly id: string;
  readonly label: string;
  /** Optional payer restriction for this share's request. */
  readonly accountId: string | null;
  readonly amountBaseUnits: string;
  readonly requestId: string | null;
  readonly recordedAt: string | null;
}

export interface SplitGroup {
  readonly id: string;
  readonly name: string;
  readonly recipientAccountId: string;
  readonly totalBaseUnits: string;
  readonly mode: 'equal' | 'custom';
  readonly memo: string;
  readonly participants: ReadonlyArray<Participant>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Equal shares of `total` for `n` people; the first (total mod n) people get one extra base unit. */
export function equalShares(total: bigint, n: number): bigint[] {
  if (n < 1 || !Number.isSafeInteger(n)) throw new Error('equalShares: n must be a positive integer');
  if (total < 0n) throw new Error('equalShares: negative total');
  const count = BigInt(n);
  const base = total / count;
  const remainder = total % count;
  return Array.from({ length: n }, (_, i) => (BigInt(i) < remainder ? base + 1n : base));
}

export type SplitProblem =
  | 'name_empty'
  | 'name_too_long'
  | 'name_hidden_characters'
  | 'total_required'
  | 'total_invalid'
  | 'total_zero'
  | 'too_few_people'
  | 'too_many_people'
  | 'person_label_invalid'
  | 'person_account_invalid'
  | 'person_is_recipient'
  | 'duplicate_person_account'
  | 'share_invalid'
  | 'share_zero'
  | 'shares_do_not_add_up'
  | 'memo_too_long'
  | 'recipient_invalid';

export interface SplitInput {
  readonly name: string;
  /** Decimal NEAR as typed. */
  readonly total: string;
  readonly mode: 'equal' | 'custom';
  readonly memo: string;
  readonly people: ReadonlyArray<{ readonly label: string; readonly account: string; readonly share: string }>;
}

function decimalToUnits(value: string): bigint | 'invalid' {
  try {
    return BigInt(toBaseUnits(value.trim().replace(',', '.'), 24));
  } catch (error) {
    if (error instanceof InvalidAmountError) return 'invalid';
    throw error;
  }
}

/** Validates and computes the exact shares. Never rounds. */
export function planSplit(
  input: SplitInput,
  recipientAccountId: string,
): { ok: true; name: string; total: bigint; shares: bigint[]; people: Array<{ label: string; accountId: string | null }> } | { ok: false; problems: SplitProblem[]; difference?: bigint } {
  const problems: SplitProblem[] = [];
  const name = normalizeLabel(input.name);
  if (!name.ok) problems.push(`name_${name.problem}`);
  if (!AccountIdSchema.safeParse(recipientAccountId).success) problems.push('recipient_invalid');
  if (new TextEncoder().encode(input.memo).length > 200) problems.push('memo_too_long');
  let total = 0n;
  if (input.total.trim() === '') problems.push('total_required');
  else {
    const parsed = decimalToUnits(input.total);
    if (parsed === 'invalid' || parsed > U128_MAX) problems.push('total_invalid');
    else if (parsed === 0n) problems.push('total_zero');
    else total = parsed;
  }
  if (input.people.length < 2) problems.push('too_few_people');
  if (input.people.length > MAX_PARTICIPANTS) problems.push('too_many_people');
  const people: Array<{ label: string; accountId: string | null }> = [];
  const seen = new Set<string>();
  for (const person of input.people) {
    const label = normalizeLabel(person.label);
    if (!label.ok) problems.push('person_label_invalid');
    const account = person.account.trim();
    if (account !== '') {
      if (!AccountIdSchema.safeParse(account).success) problems.push('person_account_invalid');
      else if (account === recipientAccountId) problems.push('person_is_recipient');
      else if (seen.has(account)) problems.push('duplicate_person_account');
      seen.add(account);
    }
    people.push({ label: label.ok ? label.label : '', accountId: account === '' ? null : account });
  }
  if (problems.length > 0) return { ok: false, problems: [...new Set(problems)] };

  let shares: bigint[];
  if (input.mode === 'equal') {
    shares = equalShares(total, people.length);
    if (shares.some((s) => s === 0n)) return { ok: false, problems: ['share_zero'] };
  } else {
    shares = [];
    for (const person of input.people) {
      const value = person.share.trim() === '' ? 'invalid' : decimalToUnits(person.share);
      if (value === 'invalid') return { ok: false, problems: ['share_invalid'] };
      if (value === 0n) return { ok: false, problems: ['share_zero'] };
      shares.push(value);
    }
    const sum = shares.reduce((a, b) => a + b, 0n);
    if (sum !== total) return { ok: false, problems: ['shares_do_not_add_up'], difference: total - sum };
  }
  if (!name.ok) return { ok: false, problems };
  return { ok: true, name: name.label, total, shares, people };
}

export function createSplit(
  input: SplitInput,
  ctx: { readonly recipientAccountId: string; readonly now: Date; readonly id: string; readonly participantId: (i: number) => string },
): { ok: true; group: SplitGroup } | { ok: false; problems: SplitProblem[]; difference?: bigint } {
  const plan = planSplit(input, ctx.recipientAccountId);
  if (!plan.ok) return plan;
  const at = ctx.now.toISOString();
  return {
    ok: true,
    group: {
      id: ctx.id,
      name: plan.name,
      recipientAccountId: ctx.recipientAccountId,
      totalBaseUnits: plan.total.toString(),
      mode: input.mode,
      memo: input.memo,
      participants: plan.people.map((p, i) => ({
        id: ctx.participantId(i),
        label: p.label,
        accountId: p.accountId,
        amountBaseUnits: (plan.shares[i] ?? 0n).toString(),
        requestId: null,
        recordedAt: null,
      })),
      createdAt: at,
      updatedAt: at,
    },
  };
}

/** Shares are locked once any child request exists. */
export function isLocked(group: SplitGroup): boolean {
  return group.participants.some((p) => p.requestId !== null);
}

/** Memo for a child request: the group's note plus who and which share. */
export function childMemo(group: SplitGroup, index: number): string {
  const tag = `Split ${index + 1}/${group.participants.length}: ${group.participants[index]?.label ?? ''}`;
  const memo = group.memo.trim() === '' ? tag : `${group.memo.trim()} · ${tag}`;
  // Request memos are at most 256 UTF-8 bytes. The tag alone always fits (label <= 40 chars).
  return new TextEncoder().encode(memo).length <= 256 ? memo : tag;
}

export function recordChild(
  group: SplitGroup,
  participantId: string,
  requestId: string,
  now: Date,
): { ok: true; group: SplitGroup } | { ok: false; reason: 'already_recorded' | 'unknown_participant' | 'invalid_request_id' | 'request_used_twice' } {
  if (!/^[0-9a-f]{64}$/.test(requestId)) return { ok: false, reason: 'invalid_request_id' };
  const person = group.participants.find((p) => p.id === participantId);
  if (person === undefined) return { ok: false, reason: 'unknown_participant' };
  if (person.requestId !== null) return person.requestId === requestId ? { ok: true, group } : { ok: false, reason: 'already_recorded' };
  if (group.participants.some((p) => p.requestId === requestId)) return { ok: false, reason: 'request_used_twice' };
  return {
    ok: true,
    group: {
      ...group,
      participants: group.participants.map((p) => (p.id === participantId ? { ...p, requestId, recordedAt: now.toISOString() } : p)),
      updatedAt: now.toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Status

export type ChildStatus =
  | 'not_created'
  | 'checking'
  /** Read failed or is uncertain. Never treated as paid or as unpaid. */
  | 'unknown'
  | 'open'
  | 'expired'
  | 'in_flight'
  | 'payout_failed'
  | 'cancelled'
  | 'paid_per_contract'
  /** Independent receipt verifier returned verified in this session. */
  | 'verified'
  /** The chain request does not match this share (amount, recipient or payer). Never counts. */
  | 'mismatch';

/** Maps a finalized chain read to a child status, after checking it is this share's request. */
export function childStatusFromChain(
  group: SplitGroup,
  participant: Participant,
  request: ContractRequest | null,
  observedAtNs: string | null,
  contractId: string,
): ChildStatus {
  if (participant.requestId === null) return 'not_created';
  if (request === null) return 'unknown';
  const t = request.terms;
  if (
    t.id !== participant.requestId ||
    t.contractId !== contractId ||
    request.recipientAccountId !== group.recipientAccountId ||
    t.amountBaseUnits !== participant.amountBaseUnits ||
    t.assetId !== 'near:native' ||
    t.mode !== 'instant' ||
    t.permittedPayerAccountId !== participant.accountId
  ) {
    return 'mismatch';
  }
  switch (request.status) {
    case 'OPEN':
      return observedAtNs !== null && BigInt(observedAtNs) >= BigInt(t.fundingExpiresAtNs) ? 'expired' : 'open';
    case 'PAYOUT_IN_FLIGHT':
      return 'in_flight';
    case 'PAYOUT_FAILED_RECOVERABLE':
      return 'payout_failed';
    case 'CANCELLED_UNFUNDED':
      return 'cancelled';
    case 'FINAL_PAID':
      return 'paid_per_contract';
    default:
      return 'unknown';
  }
}

export type GroupStatus =
  | 'preparing'
  | 'waiting'
  | 'partial'
  | 'needs_attention'
  /** Every share paid per contract, but not every share independently verified yet. */
  | 'paid_unverified'
  /** Every share Verified Paid. The only "done" state. */
  | 'settled_verified';

export function groupStatus(children: ReadonlyArray<ChildStatus>): GroupStatus {
  if (children.length === 0) return 'preparing';
  if (children.every((c) => c === 'verified')) return 'settled_verified';
  if (children.some((c) => c === 'mismatch' || c === 'expired' || c === 'cancelled' || c === 'payout_failed')) return 'needs_attention';
  if (children.some((c) => c === 'not_created')) return 'preparing';
  if (children.every((c) => c === 'verified' || c === 'paid_per_contract')) return 'paid_unverified';
  if (children.some((c) => c === 'verified' || c === 'paid_per_contract' || c === 'in_flight')) return 'partial';
  return 'waiting';
}

/** Sum of shares that are Verified Paid, in base units. */
export function verifiedAmount(group: SplitGroup, children: ReadonlyArray<ChildStatus>): bigint {
  return group.participants.reduce((sum, p, i) => (children[i] === 'verified' ? sum + BigInt(p.amountBaseUnits) : sum), 0n);
}

// ---------------------------------------------------------------------------
// Storage

const ParticipantSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  label: z.string().min(1).max(160),
  accountId: AccountIdSchema.nullable(),
  amountBaseUnits: z.string().regex(/^[1-9][0-9]{0,38}$/),
  requestId: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  recordedAt: z.iso.datetime().nullable(),
});
const GroupSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  name: z.string().min(1).max(160),
  recipientAccountId: AccountIdSchema,
  totalBaseUnits: z.string().regex(/^[1-9][0-9]{0,38}$/),
  mode: z.enum(['equal', 'custom']),
  memo: z.string().max(800),
  participants: z.array(ParticipantSchema).min(2).max(MAX_PARTICIPANTS),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
const EnvelopeSchema = z.strictObject({ version: z.literal(1), groups: z.array(GroupSchema).max(MAX_GROUPS) });

export type SplitStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type LoadedSplits = { readonly status: 'ok'; readonly groups: SplitGroup[] } | { readonly status: 'unavailable' } | { readonly status: 'corrupt' };

export function loadSplits(storage: SplitStorage | null): LoadedSplits {
  if (storage === null) return { status: 'unavailable' };
  let raw: string | null;
  try {
    raw = storage.getItem(SPLIT_STORAGE_KEY);
  } catch {
    return { status: 'unavailable' };
  }
  if (raw === null) return { status: 'ok', groups: [] };
  try {
    const parsed = EnvelopeSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return { status: 'corrupt' };
    const groups = parsed.data.groups as SplitGroup[];
    for (const g of groups) {
      // A stored plan whose shares no longer add up to its total is not trusted.
      const sum = g.participants.reduce((a, p) => a + BigInt(p.amountBaseUnits), 0n);
      if (sum !== BigInt(g.totalBaseUnits)) return { status: 'corrupt' };
      const requests = g.participants.flatMap((p) => (p.requestId === null ? [] : [p.requestId]));
      if (new Set(requests).size !== requests.length) return { status: 'corrupt' };
      if (new Set(g.participants.map((p) => p.id)).size !== g.participants.length) return { status: 'corrupt' };
    }
    if (new Set(groups.map((g) => g.id)).size !== groups.length) return { status: 'corrupt' };
    return { status: 'ok', groups };
  } catch {
    return { status: 'corrupt' };
  }
}

export function saveSplits(storage: SplitStorage | null, groups: ReadonlyArray<SplitGroup>): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(SPLIT_STORAGE_KEY, JSON.stringify({ version: 1, groups }));
    return true;
  } catch {
    return false;
  }
}
