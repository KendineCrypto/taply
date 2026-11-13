import { z } from 'zod';
import { decodeGiftSecret, encodeGiftSecret, isGiftId } from '@taply/near-client';
import { validateShareOrigin } from '@/lib/share/origin';

/**
 * Gift links.
 *
 * Open Gift:     <origin>/gift/<id>#k=<link secret>
 * Personal Gift: <origin>/gift/p#g=<base64url JSON>
 *
 * Both secrets/payloads live in the URL FRAGMENT, which browsers never send to
 * a server. An Open Gift's link secret lets whoever holds it sign a claim for
 * their own account; it cannot redirect anyone else's claim.
 */
export const GIFT_DESIGNS = [
  { id: 0, key: 'forest' },
  { id: 1, key: 'lime' },
  { id: 2, key: 'linen' },
  { id: 3, key: 'midnight' },
] as const;
export type GiftDesignKey = (typeof GIFT_DESIGNS)[number]['key'];
export function designKey(id: number): GiftDesignKey {
  return GIFT_DESIGNS.find((d) => d.id === id)?.key ?? 'forest';
}

/** Lifetimes offered in the UI (the contract allows 10 minutes to 30 days). */
export const GIFT_LIFETIMES = { '1h': 3600, '24h': 86_400, '7d': 604_800 } as const;
export type GiftLifetime = keyof typeof GIFT_LIFETIMES;

export const MAX_GIFT_MESSAGE_BYTES = 280;

function origin(value: string): string {
  const normalized = validateShareOrigin(value);
  if (normalized === null) throw new Error('origin is not shareable');
  return normalized;
}

export function openGiftUrl(shareOrigin: string, giftId: string, seed: Uint8Array): string {
  if (!isGiftId(giftId)) throw new Error('invalid gift id');
  return `${origin(shareOrigin)}/gift/${giftId}#k=${encodeGiftSecret(seed)}`;
}

/** The link secret from a `#k=` fragment, or null. Never throws. */
export function giftSecretFromHash(hash: string): Uint8Array | null {
  const match = /^#?k=([A-Za-z0-9_-]{43})$/.exec(hash);
  return match?.[1] === undefined ? null : decodeGiftSecret(match[1]);
}

const TX_HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export const PersonalGiftSchema = z.strictObject({
  v: z.literal(1),
  tx: z.string().regex(TX_HASH),
  from: z.string().regex(ACCOUNT),
  to: z.string().regex(ACCOUNT),
  amt: z.string().regex(/^[1-9][0-9]{0,38}$/),
  msg: z.string().refine((m) => new TextEncoder().encode(m).byteLength <= MAX_GIFT_MESSAGE_BYTES),
  d: z.number().int().min(0).max(3),
});
export type PersonalGift = z.infer<typeof PersonalGiftSchema>;

function b64url(text: string): string {
  let bin = '';
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(text: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

export function personalGiftUrl(shareOrigin: string, gift: PersonalGift): string {
  const parsed = PersonalGiftSchema.parse(gift);
  return `${origin(shareOrigin)}/gift/p#g=${b64url(JSON.stringify(parsed))}`;
}

/** The payload from a `#g=` fragment, or null. The page still checks the chain. */
export function personalGiftFromHash(hash: string): PersonalGift | null {
  const match = /^#?g=([A-Za-z0-9_-]{1,2048})$/.exec(hash);
  if (match?.[1] === undefined) return null;
  const json = unb64url(match[1]);
  if (json === null) return null;
  try {
    const parsed = PersonalGiftSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** X (Twitter) web intent. Opens a prefilled post; nothing is posted automatically. */
export function xShareUrl(text: string, url: string): string {
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}
