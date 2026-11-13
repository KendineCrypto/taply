import { z } from 'zod';
import { isGiftId } from '@taply/near-client';

/**
 * Gifts this device created or claimed. Local only (like contacts and
 * history): it keeps the creator's share link and remembers a claim's
 * transaction hash for evidence. Nothing here is ever proof of anything; every
 * screen re-reads the chain.
 */
const KEY = 'taply.gifts.v1';
const MAX = 50;

const Created = z.strictObject({
  kind: z.literal('created'),
  id: z.string().refine(isGiftId),
  /** URL-safe link secret (43 chars). */
  secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  creator: z.string().min(2).max(64),
  amountYocto: z.string().regex(/^[1-9][0-9]{0,38}$/),
  lifetimeS: z.number().int().positive(),
  message: z.string().max(1024),
  design: z.number().int().min(0).max(255),
  savedAt: z.number().int(),
  /** What the wallet reported for the funding transaction. */
  phase: z.enum(['draft', 'submitted', 'unknown', 'declined']),
  txHash: z.string().max(64).nullable(),
});
const Claimed = z.strictObject({
  kind: z.literal('claim'),
  id: z.string().refine(isGiftId),
  account: z.string().min(2).max(64),
  savedAt: z.number().int(),
  phase: z.enum(['submitted', 'unknown']),
  txHash: z.string().max(64).nullable(),
});
const Entry = z.discriminatedUnion('kind', [Created, Claimed]);
export type CreatedGift = z.infer<typeof Created>;
export type ClaimAttempt = z.infer<typeof Claimed>;
type GiftEntry = z.infer<typeof Entry>;

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
function readAll(s: Storage | null = storage()): GiftEntry[] {
  if (s === null) return [];
  try {
    const raw: unknown = JSON.parse(s.getItem(KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((e) => {
      const parsed = Entry.safeParse(e);
      return parsed.success ? [parsed.data] : [];
    });
  } catch {
    return [];
  }
}
function writeAll(entries: GiftEntry[], s: Storage | null = storage()): boolean {
  if (s === null) return false;
  try {
    s.setItem(KEY, JSON.stringify(entries.slice(-MAX)));
    return true;
  } catch {
    return false;
  }
}
const same = (a: GiftEntry, b: GiftEntry) => a.kind === b.kind && a.id === b.id && (a.kind !== 'claim' || (b.kind === 'claim' && a.account === b.account));

/** Saved BEFORE the wallet opens, so a reload never loses the link of a funded gift. */
export function saveGift(entry: CreatedGift | ClaimAttempt, s: Storage | null = storage()): boolean {
  const all = readAll(s).filter((e) => !same(e, entry));
  return writeAll([...all, entry], s);
}
export function createdGift(id: string, s: Storage | null = storage()): CreatedGift | null {
  return readAll(s).find((e): e is CreatedGift => e.kind === 'created' && e.id === id) ?? null;
}
export function claimAttempt(id: string, account: string, s: Storage | null = storage()): ClaimAttempt | null {
  return readAll(s).find((e): e is ClaimAttempt => e.kind === 'claim' && e.id === id && e.account === account) ?? null;
}
export function createdGifts(s: Storage | null = storage()): CreatedGift[] {
  return readAll(s).filter((e): e is CreatedGift => e.kind === 'created').reverse();
}
