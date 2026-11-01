import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { UNAVAILABLE_HANDSHAKE, resolveHandshakeAdapter } from '../adapter';
import type { HandshakeAdapter } from '../adapter';
import { localComparisonCode, presentHandshake } from '../present';
import { resolveFlags } from '@/lib/flags/features';
import { HandshakeSessionSchema, calculateTermsHash, parseIntentTermsJson } from '@/lib/protocol';
import type { HandshakeSession, IntentTerms } from '@/lib/protocol';

const here = dirname(fileURLToPath(import.meta.url));
const vectors = resolve(here, '../../../../../../packages/shared/test-vectors');
const fixtureA = parseIntentTermsJson(readFileSync(join(vectors, 'intent-a.json')));
const fixtureB = parseIntentTermsJson(readFileSync(join(vectors, 'intent-b.json')));
const NOW = '1793520000000000000';

function sessionFor(terms: IntentTerms, over: Partial<HandshakeSession> = {}): HandshakeSession {
  const binding = terms.sessionBinding!;
  return HandshakeSessionSchema.parse({
    id: binding.id,
    nonce: binding.nonce,
    expiresAtNs: binding.expiresAtNs,
    state: 'PAIRED',
    merchantAccountId: terms.creatorAccountId,
    payerAccountId: 'bob.testnet',
    intentId: terms.id,
    termsHash: calculateTermsHash(terms),
    comparisonCode: localComparisonCode(terms),
    presence: { merchant: true, payer: true },
    ...over,
  });
}

describe('comparison code (canonical @taply/shared algorithm)', () => {
  it('matches the frozen fixtures: A -> XMBVTN, B (+1 base unit) -> 684MZB', () => {
    expect(localComparisonCode(fixtureA)).toBe('XMBVTN');
    expect(localComparisonCode(fixtureB)).toBe('684MZB');
  });

  it('is null for terms without a session binding (today’s Instant requests)', () => {
    expect(localComparisonCode({ ...fixtureA, sessionBinding: null } as IntentTerms)).toBeNull();
  });
});

describe('presentHandshake', () => {
  it('paired and reviewed states; only the customer may proceed, only after review', () => {
    const paired = presentHandshake({ role: 'customer', session: sessionFor(fixtureA), chainTerms: fixtureA, nowNs: NOW });
    expect(paired).toEqual({ phase: 'paired', code: 'XMBVTN', counterpartConnected: true, customerMayProceed: false });
    const reviewed = sessionFor(fixtureA, { state: 'REVIEWED' });
    expect(presentHandshake({ role: 'customer', session: reviewed, chainTerms: fixtureA, nowNs: NOW }).customerMayProceed).toBe(true);
    expect(presentHandshake({ role: 'merchant', session: reviewed, chainTerms: fixtureA, nowNs: NOW }).customerMayProceed).toBe(false);
  });

  it('blocks on any disagreement between the session and the chain terms', () => {
    const changedAmount = sessionFor(fixtureA, { termsHash: calculateTermsHash(fixtureB), comparisonCode: '684MZB' });
    const serverCode = sessionFor(fixtureA, { comparisonCode: '684MZB' });
    const otherIntent = sessionFor(fixtureA, { intentId: 'f'.repeat(64) });
    const otherMerchant = sessionFor(fixtureA, { merchantAccountId: 'mallory.testnet' });
    for (const session of [changedAmount, serverCode, otherIntent, otherMerchant]) {
      const view = presentHandshake({ role: 'customer', session, chainTerms: fixtureA, nowNs: NOW });
      expect(view.phase).toBe('mismatch');
      expect(view.customerMayProceed).toBe(false);
    }
    // The shown code always comes from the chain terms, not the server.
    expect(presentHandshake({ role: 'customer', session: serverCode, chainTerms: fixtureA, nowNs: NOW }).code).toBe('XMBVTN');
  });

  it('terms not bound to this session are a mismatch, never a code', () => {
    const unbound = { ...fixtureA, sessionBinding: null } as IntentTerms;
    const view = presentHandshake({ role: 'customer', session: sessionFor(fixtureA), chainTerms: unbound, nowNs: NOW });
    expect(view.phase).toBe('mismatch');
    expect(view.code).toBeNull();
  });

  it('presence is derived per role; disconnect is not a payment state', () => {
    const away = sessionFor(fixtureA, { presence: { merchant: true, payer: false } });
    expect(presentHandshake({ role: 'merchant', session: away, chainTerms: fixtureA, nowNs: NOW }).counterpartConnected).toBe(false);
    expect(presentHandshake({ role: 'customer', session: away, chainTerms: fixtureA, nowNs: NOW }).counterpartConnected).toBe(true);
  });

  it('expiry by chain time or state, closed, and unloaded terms', () => {
    const s = sessionFor(fixtureA);
    expect(presentHandshake({ role: 'customer', session: s, chainTerms: fixtureA, nowNs: s.expiresAtNs }).phase).toBe('expired');
    expect(presentHandshake({ role: 'customer', session: sessionFor(fixtureA, { state: 'EXPIRED' }), chainTerms: fixtureA, nowNs: NOW }).phase).toBe('expired');
    expect(presentHandshake({ role: 'customer', session: sessionFor(fixtureA, { state: 'CLOSED' }), chainTerms: fixtureA, nowNs: NOW }).phase).toBe('closed');
    expect(presentHandshake({ role: 'customer', session: s, chainTerms: null, nowNs: NOW }).phase).toBe('not_bound');
  });

  it('has no paid output of any kind', () => {
    const view = presentHandshake({ role: 'customer', session: sessionFor(fixtureA, { state: 'REVIEWED' }), chainTerms: fixtureA, nowNs: NOW });
    expect(Object.keys(view).sort()).toEqual(['code', 'counterpartConnected', 'customerMayProceed', 'phase']);
    expect(JSON.stringify(view)).not.toMatch(/paid|final/i);
  });
});

describe('adapter gating', () => {
  const live: HandshakeAdapter = { ...UNAVAILABLE_HANDSHAKE, availability: { kind: 'available' } };

  it('flag off (default) ignores even a supplied backend', () => {
    expect(resolveHandshakeAdapter(resolveFlags({})).availability).toEqual({ kind: 'unavailable', reason: 'flag_off' });
    expect(resolveHandshakeAdapter(resolveFlags({}), live).availability.kind).toBe('unavailable');
  });

  it('flag on without a reviewed backend is still unavailable', () => {
    const on = resolveFlags({ NEXT_PUBLIC_TAPLY_FLAG_HANDSHAKE: 'on' });
    expect(resolveHandshakeAdapter(on).availability).toEqual({ kind: 'unavailable', reason: 'backend_not_connected' });
    expect(resolveHandshakeAdapter(on, live)).toBe(live);
  });

  it('the shipped adapter refuses every call and emits no events', async () => {
    const a = UNAVAILABLE_HANDSHAKE;
    for (const result of [
      await a.createSession({ merchantAccountId: 'shop.testnet' }),
      await a.bind('x', 'y'),
      await a.join('x', 'y'),
      await a.getSession('x'),
      await a.review('x', 'y'),
      await a.close('x'),
    ]) {
      expect(result).toEqual({ ok: false, error: 'unavailable' });
    }
    let events = 0;
    a.subscribe('x', () => events++)();
    expect(events).toBe(0);
  });

  it('the build does not turn Handshake on by default', () => {
    expect(resolveFlags({}).handshake.enabled).toBe(false);
  });
});

describe('mock containment', () => {
  it('handshake demo data is imported only by the /demo route component', () => {
    const src = resolve(here, '../../..');
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== '__tests__') walk(path);
        } else if (/\.tsx?$/.test(name) && readFileSync(path, 'utf8').includes('mock/handshake-demo')) {
          importers.push(relative(src, path).replaceAll('\\', '/'));
        }
      }
    };
    walk(src);
    expect(importers).toEqual(['components/handshake/HandshakeDemo.tsx']);
    const demoUsers: string[] = [];
    const walkDemo = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== '__tests__') walkDemo(path);
        } else if (/\.tsx?$/.test(name) && readFileSync(path, 'utf8').includes('HandshakeDemo')) {
          demoUsers.push(relative(src, path).replaceAll('\\', '/'));
        }
      }
    };
    walkDemo(src);
    expect(demoUsers.sort()).toEqual(['app/demo/handshake/page.tsx', 'components/handshake/HandshakeDemo.tsx']);
  });
});
