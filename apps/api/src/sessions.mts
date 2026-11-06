import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { AccountIdSchema, HashHexSchema, ContractRequestSchema, HandshakeSessionSchema,
  SessionEventSchema, SessionIdSchema, calculateTermsHash, calculateSessionCommitment, comparisonCode,
  ChainHashSchema, canonicalJson, type HandshakeSession, type SessionEvent } from '../../../packages/shared/dist/index.js';
import { SESSION_FORMAT, roomSnapshot, type RoomRecord, type RoomSync, type RoomEvent, type PayerProgress } from './room.mts';

type EventType = SessionEvent['type'];
type Entry = { snapshot: HandshakeSession; tokenHash: string | null; reviews: string[];
  permittedPayer: string | null;
  leases: Record<string, { actor: string; until: number; sequence: number; connected: boolean }>; events: SessionEvent[]; sequence: number;
  room: RoomRecord;
  replay: Record<string, { digest: string; result: unknown }> };
export type SessionDatabase = { format: typeof SESSION_FORMAT; entries: Map<string, Entry>; creates: Map<string, { digest: string; result: unknown }> };
export const emptySessions = (): SessionDatabase => ({ format: SESSION_FORMAT, entries: new Map(), creates: new Map() });
/** Atomic serializable transaction with rollback on throw; never run async work inside.
 * Implementations must refuse uncertain commits/recovery. Encryption/access controls
 * required: merchant create-idempotency records retain the returned join secret. */
export interface SessionPersistence {
  transaction<T>(action: (db: SessionDatabase) => T): T;
}
export class MemorySessionPersistence implements SessionPersistence {
  #db: SessionDatabase = emptySessions();
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
    if (type !== 'payment.changed' && type !== 'stream.reset') this.#roomEmit(entry, type);
  }
  #roomEmit(entry: Entry, type: RoomEvent['type']): void {
    if (entry.room.sequence >= Number.MAX_SAFE_INTEGER) fail('RATE_LIMITED');
    entry.room.events.push({ schemaVersion: 'taply.room-event.v1', eventId: String(++entry.room.sequence),
      sessionId: entry.snapshot.id, type, emittedAt: new Date(this.#now()).toISOString(),
      room: roomSnapshot(entry.snapshot, entry.reviews, entry.room) });
    entry.room.events = entry.room.events.slice(-64);
  }
  #refresh(entry: Entry): void {
    const s = entry.snapshot;
    const expired = !['EXPIRED', 'CLOSED'].includes(s.state) && BigInt(this.#now()) * 1000000n >= BigInt(s.expiresAtNs);
    if (expired) { s.state = 'EXPIRED'; entry.tokenHash = null; }
    const active = (actor: string | null) => !['EXPIRED', 'CLOSED'].includes(s.state) && actor !== null &&
      Object.values(entry.leases).some(l => l.actor === actor && l.until > this.#now());
    const merchant = active(s.merchantAccountId), payer = active(s.payerAccountId);
    for (const role of ['merchant', 'payer'] as const) {
      const before = entry.room.presence[role], online = role === 'merchant' ? merchant : payer;
      if (online && before !== 'active' && before !== 'resumed') entry.room.presence[role] = before === 'disconnected' ? 'resumed' : 'active';
      if (!online && (before === 'active' || before === 'resumed')) entry.room.presence[role] = 'disconnected';
    }
    const changed = merchant !== s.presence.merchant || payer !== s.presence.payer;
    s.presence = { merchant, payer };
    if (expired) this.#emit(entry, 'session.expired');
    if (changed) this.#emit(entry, 'session.presence');
  }
  #entry(db: SessionDatabase, id: string): Entry {
    SessionIdSchema.parse(id);
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
    const scoped = `${actor}:${action}:${key}`; const hash = digest(canonicalJson(body));
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
      const entry: Entry = { snapshot: session, tokenHash: digest(token), permittedPayer: null, reviews: [], leases: {}, events: [], sequence: 0, replay: {},
        room: { sequence: 0, events: [], progress: null, presence: { merchant: 'joined', payer: null } } };
      db.entries.set(session.id, entry); this.#roomEmit(entry, 'session.created');
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
    // A logout during RPC must revoke the pending bind before its commit.
    if (await this.#actor(credential) !== actor) fail('NOT_AUTHORIZED');
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
    input = structuredClone(input);
    exact(input, ['joinToken']); if (!/^[A-Za-z0-9_-]{43}$/.test(input.joinToken)) fail('INVALID_ARGUMENT');
    const actor = await this.#actor(credential);
    return this.#store.transaction(db => {
      const e = this.#entry(db, id); this.#live(e); const s = e.snapshot;
      if (actor === s.merchantAccountId) fail('NOT_AUTHORIZED');
      return this.#once(e, actor, 'join', key, input, () => {
        if (s.state !== 'OPEN' || e.tokenHash === null) fail('JOIN_TOKEN_USED');
        if (!timingSafeEqual(Buffer.from(digest(input.joinToken)), Buffer.from(e.tokenHash!))) fail('NOT_AUTHORIZED');
        if (e.permittedPayer !== null && e.permittedPayer !== actor) fail('PAYER_MISMATCH');
        e.tokenHash = null; s.payerAccountId = actor; s.state = 'PAIRED'; e.room.presence.payer = 'joined'; this.#emit(e, 'session.joined'); return s;
      });
    });
  }
  async review(credential: unknown, id: string, key: string, input: unknown): Promise<HandshakeSession> {
    input = structuredClone(input);
    exact(input, ['termsHash']); HashHexSchema.parse(input.termsHash); const actor = await this.#actor(credential);
    return this.#store.transaction(db => {
      const e = this.#entry(db, id); this.#live(e); this.#participant(e, actor);
      return this.#once(e, actor, 'review', key, input, () => {
        if (!['PAIRED', 'REVIEWED'].includes(e.snapshot.state)) fail('NOT_AUTHORIZED');
        if (input.termsHash !== e.snapshot.termsHash) fail('TERMS_MISMATCH');
        if (!e.reviews.includes(actor)) {
          e.reviews.push(actor); if (e.reviews.length === 2) e.snapshot.state = 'REVIEWED'; this.#emit(e, 'session.reviewed');
        }
        return e.snapshot;
      });
    });
  }
  async presence(credential: unknown, id: string, connected: boolean): Promise<HandshakeSession> {
    if (typeof connected !== 'boolean') fail('INVALID_ARGUMENT'); const actor = await this.#actor(credential);
    return this.#store.transaction(db => { const e = this.#entry(db, id); this.#live(e); this.#participant(e, actor);
      const scope = digest(JSON.stringify(credential)) + ':legacy';
      this.#lease(e, actor, scope, (e.leases[scope]?.sequence ?? 0) + 1, connected); return e.snapshot; });
  }
  #lease(e: Entry, actor: string, scope: string, sequence: number, connected: boolean): void {
    const old = e.leases[scope];
    if (old && sequence <= old.sequence) {
      if (sequence === old.sequence && connected !== old.connected) fail('IDEMPOTENCY_CONFLICT');
      return;
    }
    // Keep tombstones until session cleanup: old disconnects cannot resurrect a
    // retired sequence. Bound total authenticated connection slots per room.
    if (!old && Object.values(e.leases).filter(l => l.actor === actor).length >= 8) fail('RATE_LIMITED');
    e.leases[scope] = { actor, sequence, connected, until: connected ? this.#now() + 30000 : 0 };
    this.#refresh(e);
  }
  async roomPresence(credential: unknown, id: string, input: unknown): Promise<RoomSync> {
    input = structuredClone(input);
    exact(input, ['connectionId', 'sequence', 'state']);
    SessionIdSchema.parse(input.connectionId);
    if (!/^[1-9][0-9]{0,14}$/.test(input.sequence) || !['active', 'disconnected'].includes(input.state)) fail('INVALID_ARGUMENT');
    const actor = await this.#actor(credential);
    return this.#store.transaction(db => {
      const e = this.#entry(db, id); this.#live(e); this.#participant(e, actor);
      this.#lease(e, actor, digest(JSON.stringify(credential)) + ':' + input.connectionId, Number(input.sequence), input.state === 'active');
      return this.#sync(e, '0');
    });
  }
  async progress(credential: unknown, id: string, key: string, input: unknown): Promise<RoomSync> {
    input = structuredClone(input);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join() !== 'expectedCursor,phase,termsHash,transactionHash') fail('INVALID_ARGUMENT');
    const data = input as Record<string, unknown>;
    HashHexSchema.parse(data.termsHash);
    const phase = typeof data.phase === 'string' ? data.phase : fail('INVALID_ARGUMENT');
    const phases = ['AWAITING_WALLET', 'SUBMITTED', 'OUTCOME_UNKNOWN', 'USER_REJECTED'];
    if (!phases.includes(phase) || typeof data.expectedCursor !== 'string' || !/^(0|[1-9][0-9]{0,15})$/.test(data.expectedCursor)) fail('INVALID_ARGUMENT');
    if (data.transactionHash !== null) ChainHashSchema.parse(data.transactionHash);
    if (phase === 'SUBMITTED' && data.transactionHash === null || ['AWAITING_WALLET', 'USER_REJECTED'].includes(phase) && data.transactionHash !== null) fail('INVALID_ARGUMENT');
    const actor = await this.#actor(credential);
    return this.#store.transaction(db => {
      const e = this.#entry(db, id); this.#live(e);
      if (actor !== e.snapshot.payerAccountId || e.snapshot.state !== 'REVIEWED') fail('NOT_AUTHORIZED');
      return this.#once(e, actor, 'progress', key, data, () => {
        if (data.termsHash !== e.snapshot.termsHash) fail('TERMS_MISMATCH');
        if (data.expectedCursor !== String(e.room.sequence)) fail('IDEMPOTENCY_CONFLICT');
        const old = e.room.progress;
        if (old?.phase === 'SUBMITTED' || old?.phase === 'OUTCOME_UNKNOWN') fail('RECONCILIATION_REQUIRED');
        if (old?.phase === phase && old.transactionHash === data.transactionHash) return this.#sync(e, String(e.room.sequence));
        if (phase !== 'AWAITING_WALLET' && old?.phase !== 'AWAITING_WALLET') fail('NOT_AUTHORIZED');
        e.room.progress = { phase: phase as PayerProgress['phase'], transactionHash: data.transactionHash as string | null };
        this.#roomEmit(e, 'payer.progress'); return this.#sync(e, String(e.room.sequence - 1));
      });
    });
  }
  /** Internal logout hook: remove only this credential's liveness, never another
   * tab/login's lease or payer identity. Call after revoking auth authority. */
  disconnectCredential(credential: unknown): void {
    const prefix = digest(JSON.stringify(credential)) + ':';
    this.#store.transaction(db => {
      for (const e of db.entries.values()) {
        for (const [scope, lease] of Object.entries(e.leases)) if (scope.startsWith(prefix)) lease.until = 0;
        this.#refresh(e);
      }
    });
  }
  #sync(e: Entry, after: string): RoomSync {
    const cursor = BigInt(after), oldest = BigInt(e.room.events[0]?.eventId ?? '1');
    const reset = cursor < oldest - 1n || cursor > BigInt(e.room.sequence);
    return { schemaVersion: 'taply.room-sync.v1', sessionId: e.snapshot.id, cursor: String(e.room.sequence), reset,
      serverTimeMs: this.#now(), room: roomSnapshot(e.snapshot, e.reviews, e.room),
      events: reset ? [] : e.room.events.filter(event => BigInt(event.eventId) > cursor) };
  }
  async sync(credential: unknown, id: string, after = '0'): Promise<RoomSync> {
    if (!/^(0|[1-9][0-9]{0,15})$/.test(after)) fail('INVALID_ARGUMENT');
    const actor = await this.#actor(credential);
    return this.#store.transaction(db => { const e = this.#entry(db, id); this.#participant(e, actor); return this.#sync(e, after); });
  }
  async close(credential: unknown, id: string): Promise<HandshakeSession> {
    const actor = await this.#actor(credential);
    return this.#store.transaction(db => { const e = this.#entry(db, id);
      if (actor !== e.snapshot.merchantAccountId) fail('NOT_AUTHORIZED');
      if (!['CLOSED', 'EXPIRED'].includes(e.snapshot.state)) { e.snapshot.state = 'CLOSED'; e.tokenHash = null; this.#refresh(e); this.#emit(e, 'session.closed'); }
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
