import { randomBytes, timingSafeEqual } from 'node:crypto';
import { AccountIdSchema } from '../../../packages/shared/dist/index.js';

export type Challenge = Readonly<{
  id: string; accountId: string; network: 'near-testnet'; purpose: 'merchant-login';
  origin: string; recipient: string; nonceBase64: string; state: string;
  expiresAtMs: number; message: string;
}>;
export interface Nep413Verifier {
  // Must verify exact NEP-413 bytes/signature AND finalized FullAccess key
  // association at the Testnet account. Unknown/RPC failure must throw.
  verify(challenge: Challenge, signed: unknown): Promise<never>;
}
// Deliberately no success type until a tested crypto/RPC implementation exists.
export const unavailableVerifier: Nep413Verifier = {
  async verify() { throw new Error('VERIFICATION_UNAVAILABLE'); },
};
const secret = () => randomBytes(32).toString('base64url');
const equal = (a: string, b: string) => {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/** Isolated single-process foundation; never wired to public mutation routes. */
export class Challenges {
  #records = new Map<string, Challenge>();
  #origin: string;
  #contract: string;
  #now: () => number;
  constructor(origin: string, contract: string, now = Date.now) {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin) throw new Error('INVALID_ARGUMENT');
    AccountIdSchema.parse(contract);
    this.#origin = origin; this.#contract = contract; this.#now = now;
  }
  issue(accountId: string): Challenge {
    AccountIdSchema.parse(accountId);
    const now = this.#now();
    for (const [id, item] of this.#records) if (item.expiresAtMs <= now) this.#records.delete(id);
    if (this.#records.size >= 1000) throw new Error('RATE_LIMITED');
    const fields = {
      id: secret(), accountId, network: 'near-testnet' as const,
      purpose: 'merchant-login' as const, origin: this.#origin, recipient: this.#origin,
      nonceBase64: randomBytes(32).toString('base64'), state: secret(), expiresAtMs: now + 120000,
    };
    const challenge = Object.freeze({ ...fields,
      message: JSON.stringify({ ...fields, contractId: this.#contract }),
    });
    this.#records.set(challenge.id, challenge);
    return challenge;
  }
  async consume(id: string, account: string, origin: string, state: string, signed: unknown,
    verifier: Nep413Verifier = unavailableVerifier): Promise<never> {
    const item = this.#records.get(id);
    if (!item) throw new Error('AUTH_CHALLENGE_USED');
    if (origin !== item.origin || account !== item.accountId || !equal(state, item.state))
      throw new Error('NOT_AUTHORIZED');
    // Remove before await: concurrent requests cannot both reach the verifier.
    this.#records.delete(id);
    if (this.#now() >= item.expiresAtMs) throw new Error('AUTH_CHALLENGE_EXPIRED');
    return verifier.verify(item, signed);
  }
}
