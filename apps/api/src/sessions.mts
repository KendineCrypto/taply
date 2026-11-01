import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { AccountIdSchema, HashHexSchema, ContractRequestSchema, HandshakeSessionSchema,
  SessionEventSchema, calculateTermsHash, calculateSessionCommitment, comparisonCode,
  type HandshakeSession, type SessionEvent } from '../../../packages/shared/dist/index.js';

type EventType = SessionEvent['type'];
type Entry = { snapshot: HandshakeSession; tokenHash: string | null; reviews: string[];
  permittedPayer: string | null;
  leases: Record<string, number>; events: SessionEvent[]; sequence: number;
  replay: Record<string, { digest: string; result: unknown }> };
export type SessionDatabase = { entries: Map<string, Entry>; creates: Map<string, { digest: string; result: unknown }> };
/** Atomic serializable transaction with rollback on throw; never run async work inside.
 * Implementations must refuse uncertain commits/recovery. Encryption/access controls
 * required: merchant create-idempotency records retain the returned join secret. */
export interface SessionPersistence {
  transaction<T>(action: (db: SessionDatabase) => T): T;
}
export class MemorySessionPersistence implements SessionPersistence {
  #db: SessionDatabase = { entries: new Map(), creates: new Map() };
  #certain = true;
  invalidate(): void { this.#certain = false; }
  transaction<T>(action: (db: SessionDatabase) => T): T {
    if (!this.#certain) throw Error('VERIFICATION_UNAVAILABLE');
    const next = structuredClone(this.#db);
    const result = action(next);
    this.#db = next;
    return structuredClone(result);
  }
}
export interface SessionDependencies {
  authenticate(credential: unknown): Promise<{ accountId: string }>;
  // Trusted adapter must anchor approved code/network/terms to finalized chain.
  // A client-supplied record or status must never implement this boundary.
  readCanonicalRequest(id: string): Promise<unknown>;
  contractId: string;
  now?: () => number;
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = (code: string): never => { throw Error(code); };
function exact(value: unknown, fields: string[]): asserts value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join() !== [...fields].sort().join()
    || Object.values(value).some(v => typeof v !== 'string')) fail('INVALID_ARGUMENT');
}

/** Local coordination only. No payment authority and no public HTTP wiring. */
export class SessionEngine {
  #store: SessionPersistence; #deps: SessionDependencies; #now: () => number;
  constructor(store: SessionPersistence, dependencies: SessionDependencies) {
    AccountIdSchema.parse(dependencies.contractId);
    this.#store = store; this.#deps = dependencies; this.#now = dependencies.now ?? Date.now;
  }
  async #actor(credential: unknown): Promise<string> {
    return AccountIdSchema.parse((await this.#deps.authenticate(credential)).accountId);
  }
  #emit(entry: Entry, type: EventType): void {
    if (entry.sequence >= Number.MAX_SAFE_INTEGER) fail('RATE_LIMITED');
    entry.events.push(SessionEventSchema.parse({ schemaVersion: 'taply.events.v1',
      eventId: String(++entry.sequence), sessionId: entry.snapshot.id, type,
      emittedAt: new Date(this.#now()).toISOString(), intentId: entry.snapshot.intentId,
      intentRevisionHint: null }));
    entry.events = entry.events.slice(-64);
  }
  #refresh(entry: Entry): void {
    const s = entry.snapshot;
    if (!['EXPIRED', 'CLOSED'].includes(s.state) && BigInt(this.#now()) * 1000000n >= BigInt(s.expiresAtNs)) {
      s.state = 'EXPIRED'; entry.tokenHash = null; this.#emit(entry, 'session.expired');
    }
    const merchant = !['EXPIRED', 'CLOSED'].includes(s.state) && (entry.leases[s.merchantAccountId] ?? 0) > this.#now();
    const payer = !['EXPIRED', 'CLOSED'].includes(s.state) && s.payerAccountId !== null && (entry.leases[s.payerAccountId] ?? 0) > this.#now();
    if (merchant !== s.presence.merchant || payer !== s.presence.payer) {
      s.presence = { merchant, payer }; this.#emit(entry, 'session.presence');
    }
  }
  #entry(db: SessionDatabase, id: string): Entry {
    const entry = db.entries.get(id) ?? fail('SESSION_NOT_FOUND'); this.#refresh(entry); return entry;
  }
  #live(entry: Entry): void {
    if (entry.snapshot.state === 'EXPIRED') fail('SESSION_EXPIRED');
    if (entry.snapshot.state === 'CLOSED') fail('NOT_AUTHORIZED');
  }
  #participant(entry: Entry, actor: string): void {
    if (![entry.snapshot.merchantAccountId, entry.snapshot.payerAccountId].includes(actor)) fail('NOT_AUTHORIZED');
  }
  #once<T>(entry: Entry, actor: string, action: string, key: string, body: unknown, work: () => T): T {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) fail('INVALID_ARGUMENT');
    const scoped = `${actor}:${action}:${key}`; const hash = digest(JSON.stringify(body));
    const previous = entry.replay[scoped];
    if (previous) return previous.digest === hash ? structuredClone(previous.result) as T : fail('IDEMPOTENCY_CONFLICT');
    if (Object.keys(entry.replay).length >= 128) fail('RATE_LIMITED');
    const result = work(); entry.replay[scoped] = { digest: hash, result: structuredClone(result) }; return result;
  }
  async create(credential: unknown, key: string): Promise<{ session: HandshakeSession; joinToken: string }> {
    const actor = await this.#actor(credential);
    return this.#store.transaction(db => {
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) fail('INVALID_ARGUMENT');
      const scoped = `${actor}:${key}`; const previous = db.creates.get(scoped);
      if (previous) return structuredClone(previous.result) as { session: HandshakeSession; joinToken: string };
      if (db.entries.size >= 1000 || db.creates.size >= 1000) fail('RATE_LIMITED');
      const token = randomBytes(32).toString('base64url');
      const session = HandshakeSessionSchema.parse({ id: randomUUID(), nonce: randomBytes(32).toString('hex'),
        expiresAtNs: (BigInt(this.#now() + 120000) * 1000000n).toString(), state: 'DRAFT',
        merchantAccountId: actor, payerAccountId: null, intentId: null, termsHash: null,
        comparisonCode: null, presence: { merchant: false, payer: false } });
      db.entries.set(session.id, { snapshot: session, tokenHash: digest(token), permittedPayer: null, reviews: [], leases: {}, events: [], sequence: 0, replay: {} });
      const result = { session, joinToken: token }; db.creates.set(scoped, { digest: '', result: structuredClone(result) }); return result;
    });
  }
  async bind(credential: unknown, id: string, key: string, input: unknown): Promise<HandshakeSession> {
    input = structuredClone(input);
    exact(input, ['intentId', 'termsHash']); HashHexSchema.parse(input.intentId); HashHexSchema.parse(input.termsHash);
    const actor = await this.#actor(credential);
    // Authorize before expensive RPC; transaction checks everything again after await.
    this.#store.transaction(db => { const e = this.#entry(db, id); this.#live(e);
      if (actor !== e.snapshot.merchantAccountId) fail('NOT_AUTHORIZED'); });
    const request = ContractRequestSchema.parse(await this.#deps.readCanonicalRequest(input.intentId));
    return this.#store.transaction(db => {
      const e = this.#entry(db, id); this.#live(e); const s = e.snapshot;
      if (actor !== s.merchantAccountId) fail('NOT_AUTHORIZED');
      return this.#once(e, actor, 'bind', key, input, () => {
        if (s.state !== 'DRAFT') fail('SESSION_ALREADY_BOUND');
        const t = request.terms; const binding = t.sessionBinding;
        if (t.id !== input.intentId || request.termsHash !== input.termsHash || calculateTermsHash(t) !== input.termsHash) fail('TERMS_MISMATCH');
        if (t.contractId !== this.#deps.contractId || t.network !== 'near-testnet' || t.mode !== 'instant'
          || t.creatorAccountId !== actor || t.merchantAccountId !== actor || request.recipientAccountId !== actor) fail('MERCHANT_BINDING_INVALID');
        if (!binding || binding.id !== id || binding.nonce !== s.nonce || binding.expiresAtNs !== s.expiresAtNs) fail('SESSION_MISMATCH');
        if (request.status !== 'OPEN' || BigInt(t.fundingExpiresAtNs) < BigInt(s.expiresAtNs)) fail('REQUEST_NOT_OPEN');
        s.intentId = t.id; s.termsHash = request.termsHash; s.comparisonCode = comparisonCode(calculateSessionCommitment(t)!);
        // Retain payer restriction separately from public snapshot.
        e.permittedPayer = t.permittedPayerAccountId;
        s.state = 'OPEN'; this.#emit(e, 'session.bound'); return s;
      });
    });
  }
  async join(credential: unknown, id: string, key: string, input: unknown): Promise<HandshakeSession> {
    exact(input, ['joinToken']); if (!/^[A-Za-z0-9_-]{43}$/.test(input.joinToken)) fail('INVALID_ARGUMENT');
    const actor = await this.#actor(credential);
    return this.#store.transaction(db => {
      const e = this.#entry(db, id); this.#live(e); const s = e.snapshot;
      if (actor === s.merchantAccountId) fail('NOT_AUTHORIZED');
      return this.#once(e, actor, 'join', key, input, () => {
        if (s.state !== 'OPEN' || e.tokenHash === null) fail('JOIN_TOKEN_USED');
        if (!timingSafeEqual(Buffer.from(digest(input.joinToken)), Buffer.from(e.tokenHash!))) fail('NOT_AUTHORIZED');
        if (e.permittedPayer !== null && e.permittedPayer !== actor) fail('PAYER_MISMATCH');
        e.tokenHash = null; s.payerAccountId = actor; s.state = 'PAIRED'; this.#emit(e, 'session.joined'); return s;
      });
    });
  }
  async review(credential: unknown, id: string, key: string, input: unknown): Promise<HandshakeSession> {
    exact(input, ['termsHash']); HashHexSchema.parse(input.termsHash); const actor = await this.#actor(credential);
    return this.#store.transaction(db => {
      const e = this.#entry(db, id); this.#live(e); this.#participant(e, actor);
      return this.#once(e, actor, 'review', key, input, () => {
        if (!['PAIRED', 'REVIEWED'].includes(e.snapshot.state)) fail('NOT_AUTHORIZED');
        if (input.termsHash !== e.snapshot.termsHash) fail('TERMS_MISMATCH');
        if (!e.reviews.includes(actor)) { e.reviews.push(actor); this.#emit(e, 'session.reviewed'); }
        if (e.reviews.length === 2) e.snapshot.state = 'REVIEWED'; return e.snapshot;
      });
    });
  }
  async presence(credential: unknown, id: string, connected: boolean): Promise<HandshakeSession> {
    if (typeof connected !== 'boolean') fail('INVALID_ARGUMENT'); const actor = await this.#actor(credential);
    return this.#store.transaction(db => { const e = this.#entry(db, id); this.#live(e); this.#participant(e, actor);
      e.leases[actor] = connected ? this.#now() + 30000 : 0; this.#refresh(e); return e.snapshot; });
  }
  async close(credential: unknown, id: string): Promise<HandshakeSession> {
    const actor = await this.#actor(credential);
    return this.#store.transaction(db => { const e = this.#entry(db, id);
      if (actor !== e.snapshot.merchantAccountId) fail('NOT_AUTHORIZED');
      if (!['CLOSED', 'EXPIRED'].includes(e.snapshot.state)) { e.snapshot.state = 'CLOSED'; e.tokenHash = null; this.#emit(e, 'session.closed'); this.#refresh(e); }
      return e.snapshot; });
  }
  async read(credential: unknown, id: string): Promise<HandshakeSession> {
    const actor = await this.#actor(credential);
    return this.#store.transaction(db => { const e = this.#entry(db, id); this.#participant(e, actor); return e.snapshot; });
  }
  /** SSE adapter may serialize these shared events; they contain hints only.
   * Duplicate/reordered delivery must be deduplicated by eventId by clients. */
  async events(credential: unknown, id: string, after = '0'): Promise<{ reset: boolean; events: SessionEvent[] }> {
    if (!/^(0|[1-9][0-9]{0,15})$/.test(after)) fail('INVALID_ARGUMENT'); const actor = await this.#actor(credential);
    return this.#store.transaction(db => { const e = this.#entry(db, id); this.#participant(e, actor);
      const cursor = Number(after); const oldest = Number(e.events[0]?.eventId ?? 1);
      const reset = cursor < oldest - 1 || cursor > e.sequence;
      return { reset, events: reset ? [] : e.events.filter(event => Number(event.eventId) > cursor) }; });
  }
  cleanup(): number {
    return this.#store.transaction(db => { let count = 0;
      for (const [id, e] of db.entries) { this.#refresh(e);
        if (BigInt(this.#now() - 300000) * 1000000n >= BigInt(e.snapshot.expiresAtNs)) { db.entries.delete(id); count++; } }
      // Create keys stay bounded until their corresponding session is removed.
      for (const [key, record] of db.creates) {
        const result = record.result as { session: HandshakeSession };
        if (!db.entries.has(result.session.id)) db.creates.delete(key);
      } return count; });
  }
}
