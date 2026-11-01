import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Challenges } from '../src/auth.mts';
import { handle } from '../src/http.mts';

test('challenge randomness, explicit scope, immutable fields and expiry', () => {
  const store = new Challenges('https://taply.example', 'pilot.testnet', () => 1000);
  const a = store.issue('merchant.testnet'); const b = store.issue('merchant.testnet');
  assert.notEqual(a.id, b.id); assert.notEqual(a.nonceBase64, b.nonceBase64);
  assert.notEqual(a.state, a.id); assert.equal(Buffer.from(a.nonceBase64, 'base64').length, 32);
  assert.equal(a.expiresAtMs, 121000); assert.ok(Object.isFrozen(a));
  const message = JSON.parse(a.message);
  assert.equal(message.network, 'near-testnet'); assert.equal(message.purpose, 'merchant-login');
  assert.equal(message.contractId, 'pilot.testnet'); assert.equal(message.accountId, a.accountId);
});
test('wrong account/origin/state cannot consume; verifier unavailable burns challenge', async () => {
  const store = new Challenges('https://taply.example', 'pilot.testnet');
  const a = store.issue('merchant.testnet');
  for (const [account, origin, state] of [
    ['evil.testnet', a.origin, a.state], [a.accountId, 'https://evil.example', a.state],
    [a.accountId, a.origin, 'wrong'],
  ]) await assert.rejects(store.consume(a.id, account!, origin!, state!, {}), /NOT_AUTHORIZED/);
  await assert.rejects(store.consume(a.id, a.accountId, a.origin, a.state, {}), /VERIFICATION_UNAVAILABLE/);
  await assert.rejects(store.consume(a.id, a.accountId, a.origin, a.state, {}), /AUTH_CHALLENGE_USED/);
});
test('concurrent replay reaches verifier at most once', async () => {
  const store = new Challenges('https://taply.example', 'pilot.testnet'); const a = store.issue('m.testnet');
  let calls = 0;
  const verifier = { async verify(): Promise<never> { calls++; throw Error('invalid'); } };
  await Promise.allSettled(Array.from({ length: 20 }, () =>
    store.consume(a.id, a.accountId, a.origin, a.state, {}, verifier)));
  assert.equal(calls, 1);
});
test('expiry boundary, restart and capacity fail closed', async () => {
  let now = 0; const store = new Challenges('https://taply.example', 'pilot.testnet', () => now);
  const a = store.issue('m.testnet'); now = a.expiresAtMs;
  await assert.rejects(store.consume(a.id, a.accountId, a.origin, a.state, {}), /EXPIRED/);
  const restarted = new Challenges(a.origin, 'pilot.testnet');
  await assert.rejects(restarted.consume(a.id, a.accountId, a.origin, a.state, {}), /USED/);
  for (let i = 0; i < 1000; i++) store.issue('m.testnet');
  assert.throws(() => store.issue('m.testnet'), /RATE_LIMITED/);
});
test('strict origin and account validation', () => {
  for (const origin of ['http://taply.example', 'https://taply.example/', 'https://u:p@taply.example'])
    assert.throws(() => new Challenges(origin, 'pilot.testnet'));
  assert.throws(() => new Challenges('https://taply.example', 'INVALID'));
});
test('all HTTP routes refuse service without accepting secrets or issuing cookies', async () => {
  for (const path of ['auth/challenges', 'auth/verify', 'auth/logout', 'merchants/m.testnet',
    'sessions', 'sessions/id/bind', 'sessions/id/join', 'sessions/id/review', 'sessions/id/close']) {
    const response = handle(new Request(`https://taply.example/api/v1/${path}`, { method: 'POST', body: 'malicious' }));
    assert.equal(response.status, 503); assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).error.code, 'VERIFICATION_UNAVAILABLE');
  }
  assert.equal(handle(new Request('https://taply.example/api/v1/auth/me')).status, 401);
});
