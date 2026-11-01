import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { Challenges, type Challenge, type Nep413Verifier, type VerifiedIdentity } from './auth.mts';
import { DurableStore } from './storage.mts';

const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
export const same = (a: string, b: string): boolean => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length > 256 || b.length > 256) return false;
  const l = Buffer.from(a), r = Buffer.from(b); return l.length === r.length && timingSafeEqual(l,r);
};
type AuthSession = { identity: VerifiedIdentity; csrf: string; expires: number };
export type AuthDatabase = { challenges: Map<string,{ challenge: Challenge; browserHash: string }>;
  sessions: Map<string,AuthSession>; rates: Map<string,{ count: number; until: number }> };
export const emptyAuth = (): AuthDatabase => ({ challenges:new Map(), sessions:new Map(), rates:new Map() });
export class DurableAuth {
  #store: DurableStore<AuthDatabase>; #origin: string; #contract: string; #verifier: Nep413Verifier; #now: () => number;
  constructor(store: DurableStore<AuthDatabase>, origin: string, contract: string, verifier: Nep413Verifier, now = Date.now) {
    new Challenges(origin, contract, now); this.#store=store; this.#origin=origin; this.#contract=contract; this.#verifier=verifier; this.#now=now;
  }
  cleanup(): void {
    this.#store.transaction(db => {
      for (const [id,c] of db.challenges) if (c.challenge.expiresAtMs <= this.#now()) db.challenges.delete(id);
      for (const [id,s] of db.sessions) if (s.expires <= this.#now()) db.sessions.delete(id);
      for (const [id,r] of db.rates) if (r.until <= this.#now()) db.rates.delete(id);
    });
  }
  rate(scope: string, limit = 60): void {
    if (scope.length > 256) throw Error('RATE_LIMITED');
    this.#store.transaction(db => {
      for (const [id,r] of db.rates) if (r.until <= this.#now()) db.rates.delete(id);
      const id = hash(scope), old = db.rates.get(id);
      if (old && old.count >= limit || !old && db.rates.size >= 2000) throw Error('RATE_LIMITED');
      db.rates.set(id,{count:(old?.count??0)+1,until:old?.until??this.#now()+60000});
    });
  }
  challenge(accountId: string, browserToken?: string): { challenge: Challenge; browserToken: string } {
    this.cleanup(); this.rate(`challenge:${accountId}`,5);
    const token = browserToken && /^[A-Za-z0-9_-]{43}$/.test(browserToken) ? browserToken : secret();
    const challenge = new Challenges(this.#origin,this.#contract,this.#now).issue(accountId);
    this.#store.transaction(db => {
      if (db.challenges.size >= 1000) throw Error('RATE_LIMITED');
      db.challenges.set(challenge.id,{challenge,browserHash:hash(token)});
    }); return { challenge,browserToken:token };
  }
  async verify(id: string, browserToken: string, signed: unknown): Promise<{ token: string; csrf: string; identity: VerifiedIdentity }> {
    // Durable commit before awaiting any crypto/RPC; failed verification burns challenge.
    const challenge = this.#store.transaction(db => {
      const item=db.challenges.get(id); if (!item) throw Error('AUTH_CHALLENGE_USED');
      if (!same(item.browserHash,hash(browserToken))) throw Error('CSRF_REJECTED');
      db.challenges.delete(id); return item.challenge;
    });
    if (this.#now() >= challenge.expiresAtMs) throw Error('AUTH_CHALLENGE_EXPIRED');
    const identity = await this.#verifier.verify(challenge,signed);
    if (this.#now() >= challenge.expiresAtMs) throw Error('AUTH_CHALLENGE_EXPIRED');
    const token=secret(), csrf=secret();
    this.#store.transaction(db => {
      for (const [id,s] of db.sessions) if (s.expires <= this.#now()) db.sessions.delete(id);
      if (db.sessions.size >= 1000) throw Error('RATE_LIMITED');
      db.sessions.set(hash(token),{identity,csrf,expires:this.#now()+900000});
    }); return { token,csrf,identity };
  }
  session(token: string): AuthSession {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw Error('AUTH_REQUIRED');
    return this.#store.transaction(db => {
      const s=db.sessions.get(hash(token)); if (!s || s.expires <= this.#now()) throw Error('AUTH_EXPIRED'); return s;
    });
  }
  logout(token: string): void { this.#store.transaction(db => { db.sessions.delete(hash(token)); }); }
}
