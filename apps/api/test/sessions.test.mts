import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionEngine, MemorySessionPersistence } from '../src/sessions.mts';
import { calculateRequestId, calculateTermsHash, calculateSessionCommitment, comparisonCode,
  HandshakeSessionSchema, SessionEventSchema, type IntentTerms } from '../../../packages/shared/dist/index.js';

const merchant = 'merchant.testnet', payer = 'payer.testnet', other = 'other.testnet';
const key = (n: number) => `operation_key_${String(n).padStart(4, '0')}`;
async function fixture() {
  let now = 1793500000000;
  const store = new MemorySessionPersistence();
  let read: () => Promise<unknown> = async () => structuredClone(record);
  const deps = { contractId: 'next.testnet', now: () => now,
    authenticate: async (credential: unknown) => {
      if (![merchant, payer, other].includes(credential as string)) throw Error('AUTH_REQUIRED');
      return { accountId: credential as string };
    }, readCanonicalRequest: async () => read() };
  const engine = new SessionEngine(store, deps); const created = await engine.create(merchant, key(0));
  const terms: IntentTerms = { schemaVersion: 'taply.intent.v1', network: 'near-testnet', contractId: 'next.testnet',
    creatorAccountId: merchant, creationNonce: 'a'.repeat(64), assetId: 'near:native', amountBaseUnits: '1000',
    mode: 'instant', cancelDurationNs: null, fundingExpiresAtNs: String(BigInt(now + 180000) * 1000000n),
    permittedPayerAccountId: payer, merchantAccountId: merchant, memo: '', sessionBinding: {
      id: created.session.id, nonce: created.session.nonce, expiresAtNs: created.session.expiresAtNs }, id: '' };
  terms.id = calculateRequestId({ contractId: terms.contractId, creatorAccountId: terms.creatorAccountId,
    creationNonce: terms.creationNonce, network: 'near-testnet' });
  const record = { terms, termsHash: calculateTermsHash(terms), sessionCommitment: calculateSessionCommitment(terms),
    recipientAccountId: merchant, status: 'OPEN', revision: '1', createdAtNs: String(BigInt(now) * 1000000n),
    payerAccountId: null, fundedAtNs: null, cancelUntilNs: null, settlementBranch: null, latestOperation: null };
  const input = () => ({ intentId: record.terms.id, termsHash: record.termsHash });
  const bind = () => engine.bind(merchant, created.session.id, key(1), input());
  const join = (actor = payer, k = key(2)) => engine.join(actor, created.session.id, k, { joinToken: created.joinToken });
  return { engine, store, deps, created, record, input, bind, join,
    setNow: (value: number) => { now = value; }, now: () => now,
    setRead: (fn: () => Promise<unknown>) => { read = fn; } };
}

test('CSPRNG independent ID/nonce/secret, authenticated create idempotency and snapshot isolation', async () => {
  const f = await fixture(); const again = await f.engine.create(merchant, key(0));
  assert.deepEqual(again, f.created); HandshakeSessionSchema.parse(again.session);
  const b = await f.engine.create(merchant, key(3));
  assert.notEqual(b.session.id, again.session.id); assert.notEqual(b.session.nonce, again.session.nonce);
  assert.notEqual(b.joinToken, again.joinToken); assert.equal(Buffer.from(b.joinToken, 'base64url').length, 32);
  again.session.merchantAccountId = other;
  assert.equal((await f.engine.read(merchant, f.created.session.id)).merchantAccountId, merchant);
  await assert.rejects(f.engine.create({}, key(4)), /AUTH_REQUIRED/);
});
test('canonical bind, pairing, independent explicit review and no payment-final state', async () => {
  const f = await fixture(); const bound = await f.bind(); assert.equal(bound.state, 'OPEN');
  assert.equal(bound.comparisonCode, comparisonCode(calculateSessionCommitment(f.record.terms)!));
  assert.equal((await f.join()).state, 'PAIRED');
  const input = { termsHash: bound.termsHash! };
  assert.equal((await f.engine.review(merchant, bound.id, key(4), input)).state, 'PAIRED');
  assert.equal((await f.engine.review(payer, bound.id, key(5), input)).state, 'REVIEWED');
  const events = await f.engine.events(payer, bound.id);
  for (const event of events.events) { SessionEventSchema.parse(event); assert.equal('paid' in event, false); }
  assert.ok(!JSON.stringify(events).includes(f.created.joinToken));
});
test('wrong merchant, outsider reads, merchant/payer separation and wrong restricted payer', async () => {
  const f = await fixture(), id = f.created.session.id;
  await assert.rejects(f.engine.bind(other, id, key(1), f.input()), /NOT_AUTHORIZED/);
  await assert.rejects(f.engine.read(other, id), /NOT_AUTHORIZED/); await f.bind();
  await assert.rejects(f.join(merchant), /NOT_AUTHORIZED/);
  await assert.rejects(f.join(other), /PAYER_MISMATCH/);
  await f.join(); await assert.rejects(f.engine.review(other, id, key(6), { termsHash: f.record.termsHash }), /NOT_AUTHORIZED/);
  await assert.rejects(f.engine.close(payer, id), /NOT_AUTHORIZED/);
});
test('token forgery, replay, idempotent retry and conflicting retry', async () => {
  const f = await fixture(), id = f.created.session.id; await f.bind();
  await assert.rejects(f.engine.join(payer, id, key(2), { joinToken: 'A'.repeat(43) }), /NOT_AUTHORIZED/);
  const joined = await f.join(); assert.deepEqual(await f.join(), joined);
  await assert.rejects(f.join(payer, key(3)), /JOIN_TOKEN_USED/);
  await assert.rejects(f.engine.join(payer, id, key(2), { joinToken: 'A'.repeat(43) }), /IDEMPOTENCY_CONFLICT/);
});
test('simultaneous binds reserve once, simultaneous joins consume once', async () => {
  const f = await fixture();
  const binds = await Promise.allSettled([f.bind(), f.engine.bind(merchant, f.created.session.id, key(4), f.input())]);
  assert.equal(binds.filter(v => v.status === 'fulfilled').length, 1);
  const joins = await Promise.allSettled([f.join(), f.join(payer, key(5))]);
  assert.equal(joins.filter(v => v.status === 'fulfilled').length, 1);
  assert.equal((await f.engine.events(payer, f.created.session.id)).events.filter(e => e.type === 'session.joined').length, 1);
});
test('two different eligible payers race for the same token; exactly one identity wins', async () => {
  const f = await fixture(); f.record.terms.permittedPayerAccountId = null;
  f.record.termsHash = calculateTermsHash(f.record.terms); f.record.sessionCommitment = calculateSessionCommitment(f.record.terms);
  await f.bind(); const results = await Promise.allSettled([f.join(payer), f.join(other)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const snapshot = await f.engine.read(merchant, f.created.session.id);
  assert.ok([payer, other].includes(snapshot.payerAccountId!));
});
test('approved contract substitution and mismatched requested ID are rejected', async () => {
  const f = await fixture(); f.record.terms.contractId = 'wrong.testnet';
  const t = f.record.terms;
  t.id = calculateRequestId({ contractId: t.contractId, creationNonce: t.creationNonce,
    creatorAccountId: t.creatorAccountId, network: t.network });
  f.record.termsHash = calculateTermsHash(t); f.record.sessionCommitment = calculateSessionCommitment(t);
  await assert.rejects(f.bind(), /MERCHANT_BINDING_INVALID/);
  const g = await fixture();
  await assert.rejects(g.engine.bind(merchant, g.created.session.id, key(1), { ...g.input(), intentId: '0'.repeat(64) }), /TERMS_MISMATCH/);
});
test('close while chain verification is pending prevents delayed bind commit', async () => {
  const f = await fixture();
  f.setRead(async () => { await f.engine.close(merchant, f.created.session.id); return f.record; });
  await assert.rejects(f.bind(), /NOT_AUTHORIZED/);
  assert.equal((await f.engine.read(merchant, f.created.session.id)).state, 'CLOSED');
});
test('logout during canonical RPC revokes pending bind before commit', async () => {
  const f=await fixture(); let revoked=false;
  const authenticate=f.deps.authenticate;
  f.deps.authenticate=async credential=>{if(revoked) throw Error('AUTH_EXPIRED');return authenticate(credential);};
  f.setRead(async()=>{revoked=true;return f.record;});
  await assert.rejects(f.bind(),/AUTH_EXPIRED/); revoked=false;
  assert.equal((await f.engine.read(merchant,f.created.session.id)).state,'DRAFT');
});
test('wrong hash, receiver, binding, contract and RPC outage never open draft', async () => {
  for (const mutate of [
    (r: any) => { r.recipientAccountId = other; },
    (r: any) => { r.terms.sessionBinding.nonce = 'b'.repeat(64); r.termsHash = calculateTermsHash(r.terms); r.sessionCommitment = calculateSessionCommitment(r.terms); },
    (r: any) => { r.terms.merchantAccountId = other; },
  ]) {
    const f = await fixture(); mutate(f.record); await assert.rejects(f.bind());
    assert.equal((await f.engine.read(merchant, f.created.session.id)).state, 'DRAFT');
  }
  const f = await fixture();
  await assert.rejects(f.engine.bind(merchant, f.created.session.id, key(1), { ...f.input(), termsHash: '0'.repeat(64) }), /TERMS_MISMATCH/);
  f.setRead(async () => { throw Error('RPC_UNAVAILABLE'); }); await assert.rejects(f.bind(), /RPC_UNAVAILABLE/);
  assert.equal((await f.engine.read(merchant, f.created.session.id)).state, 'DRAFT');
});
test('review before pairing rejected; duplicate review idempotent without duplicate event', async () => {
  const f = await fixture(); await f.bind(); const id = f.created.session.id;
  await assert.rejects(f.engine.review(merchant, id, key(7), { termsHash: f.record.termsHash }), /NOT_AUTHORIZED/);
  await f.join(); await assert.rejects(f.engine.review(payer, id, key(7), { termsHash: '0'.repeat(64) }), /TERMS_MISMATCH/);
  await f.engine.review(payer, id, key(7), { termsHash: f.record.termsHash });
  await f.engine.review(payer, id, key(7), { termsHash: f.record.termsHash });
  await f.engine.review(payer, id, key(8), { termsHash: f.record.termsHash });
  assert.equal((await f.engine.events(payer, id)).events.filter(e => e.type === 'session.reviewed').length, 1);
});
test('disconnect, lease timeout and reconnect preserve payer and review state', async () => {
  const f = await fixture(); await f.bind(); await f.join(); const id = f.created.session.id;
  assert.equal((await f.engine.presence(payer, id, true)).presence.payer, true);
  assert.equal((await f.engine.presence(payer, id, false)).presence.payer, false);
  await f.engine.presence(payer, id, true); f.setNow(f.now() + 30000);
  assert.equal((await f.engine.read(payer, id)).presence.payer, false);
  const reconnected = await f.engine.presence(payer, id, true);
  assert.equal(reconnected.payerAccountId, payer); assert.equal(reconnected.state, 'PAIRED');
});
test('bounded replay, stable ordering, duplicate delivery and gap reset', async () => {
  const f = await fixture(); await f.bind(); await f.join(); const id = f.created.session.id;
  for (let n = 0; n < 80; n++) await f.engine.presence(payer, id, n % 2 === 0);
  assert.deepEqual(await f.engine.events(payer, id), { reset: true, events: [] });
  const recent = await f.engine.events(payer, id, '75'); const duplicate = await f.engine.events(payer, id, '75');
  assert.deepEqual(recent, duplicate); assert.ok(recent.events.length <= 64);
  assert.deepEqual(recent.events.map(e => Number(e.eventId)), recent.events.map(e => Number(e.eventId)).sort((a,b) => a-b));
  // Transport reordering/duplicates cannot mutate the server snapshot.
  const shuffled = [...recent.events].reverse().concat(recent.events);
  assert.equal(new Set(shuffled.map(e => e.eventId)).size, recent.events.length);
  assert.equal((await f.engine.read(payer, id)).state, 'PAIRED');
});
test('exact expiry, token expiry, cleanup and bind verification expiration race', async () => {
  const f = await fixture(); await f.bind(); f.setNow(Number(BigInt(f.created.session.expiresAtNs)/1000000n));
  await assert.rejects(f.join(), /SESSION_EXPIRED/);
  assert.equal((await f.engine.read(merchant, f.created.session.id)).state, 'EXPIRED');
  f.setNow(f.now() + 300000); assert.equal(f.engine.cleanup(), 1);
  await assert.rejects(f.engine.read(merchant, f.created.session.id), /SESSION_NOT_FOUND/);
  const g = await fixture(); g.setRead(async () => { g.setNow(g.now() + 120000); return g.record; });
  await assert.rejects(g.bind(), /SESSION_EXPIRED/);
});
test('known memory restart loses sessions; uncertain persistence restart refuses all operations', async () => {
  const f = await fixture(); await f.bind();
  const restarted = new SessionEngine(new MemorySessionPersistence(), f.deps);
  await assert.rejects(restarted.read(merchant, f.created.session.id), /SESSION_NOT_FOUND/);
  f.store.invalidate(); await assert.rejects(f.join(), /VERIFICATION_UNAVAILABLE/);
  await assert.rejects(f.engine.create(merchant, key(8)), /VERIFICATION_UNAVAILABLE/);
});
test('malicious client status and false finality fields rejected; close is coordination only', async () => {
  const f = await fixture(), id = f.created.session.id;
  await assert.rejects(f.engine.bind(merchant, id, key(1), { ...f.input(), status: 'FINAL_PAID' }), /INVALID_ARGUMENT/);
  await f.bind(); await f.join();
  await assert.rejects(f.engine.review(payer, id, key(8), { termsHash: f.record.termsHash, paid: true }), /INVALID_ARGUMENT/);
  assert.equal((await f.engine.close(merchant, id)).state, 'CLOSED');
  await assert.rejects(f.engine.review(payer, id, key(8), { termsHash: f.record.termsHash }), /NOT_AUTHORIZED/);
});
