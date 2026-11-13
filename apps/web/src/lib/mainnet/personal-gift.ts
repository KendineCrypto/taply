import { z } from 'zod';
import { MainnetAccountSchema } from '@taply/shared';

/**
 * Personal Gift share payload (URL fragment `#p=`). Holds NO secret: it only
 * describes a plain NEAR transfer the recipient can check independently
 * (verifyMainnetDirectTransfer). The fragment is never sent to the server.
 * Anything in it is a claim to be verified, never evidence by itself.
 */
export const PersonalGiftPayloadSchema = z.strictObject({
  v: z.literal(1),
  network: z.literal('near-mainnet'),
  from: MainnetAccountSchema,
  to: MainnetAccountSchema,
  amountYocto: z.string().regex(/^[1-9][0-9]{0,38}$/),
  txHash: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/),
  message: z.string().refine((m) => new TextEncoder().encode(m).length <= 280, 'MESSAGE_TOO_LONG'),
  design: z.number().int().min(0).max(3),
}).refine((p) => p.from !== p.to, 'SELF_GIFT');
export type PersonalGiftPayload = z.infer<typeof PersonalGiftPayloadSchema>;

const b64url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

export function encodePersonalGift(payload: PersonalGiftPayload): string {
  return `#p=${b64url(JSON.stringify(PersonalGiftPayloadSchema.parse(payload)))}`;
}

/** Strict decode: size-capped, exact schema, no extra keys; anything else is null. */
export function decodePersonalGift(hash: string): PersonalGiftPayload | null {
  const m = /^#p=([A-Za-z0-9_-]{1,2000})$/.exec(hash);
  if (!m) return null;
  try {
    const r = PersonalGiftPayloadSchema.safeParse(JSON.parse(unb64url(m[1]!)));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
