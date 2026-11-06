// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createCoordinationReader } from '../http-reader';

const ORIGIN = 'https://taply.example';
const ID = '12345678-1234-4234-8234-123456789012';

describe('frontend reader / actual gated service integration (synthetic, no listener)', () => {
  it('an unavailable service stays unavailable and has no payment output', async () => {
    const reader = createCoordinationReader(ORIGIN, vi.fn().mockRejectedValue(new Error('offline')));
    expect(await reader.snapshot(ID)).toEqual({ ok: false, error: 'unavailable' });
    expect(await reader.events(ID)).toEqual({ ok: false, error: 'unavailable' });
    expect(Object.keys(reader).sort()).toEqual(['events', 'snapshot']);
  });

  it('rejects path/token injection and non-HTTPS/configured origins before transport', async () => {
    const transport = vi.fn();
    const reader = createCoordinationReader(ORIGIN, transport);
    for (const id of [`${ID}?token=secret`, `${ID}#secret`, '../auth/me']) {
      expect(await reader.snapshot(id)).toEqual({ ok: false, error: 'invalid' });
    }
    expect(await reader.events(ID, '1\r\nCookie: stolen')).toEqual({ ok: false, error: 'invalid' });
    expect(transport).not.toHaveBeenCalled();
    for (const origin of ['http://taply.example', `${ORIGIN}/`, `${ORIGIN}?token=x`, 'https://user@taply.example']) {
      expect(() => createCoordinationReader(origin, transport)).toThrow();
    }
  });

  it('rejects fake Paid events, foreign-session hints, malformed JSON and redirects', async () => {
    for (const data of [
      { reset: false, events: [], paid: true },
      { reset: false, events: [{ type: 'payment.paid', sessionId: ID, paid: true }] },
      { reset: false, events: [{ schemaVersion: 'taply.events.v1', eventId: '1', sessionId: '22345678-1234-4234-8234-123456789012', type: 'payment.changed', emittedAt: '2026-11-02T00:00:00.000Z', intentId: 'a'.repeat(64), intentRevisionHint: null }] },
    ]) {
      const reader = createCoordinationReader(ORIGIN, async () => Response.json(data));
      expect(await reader.events(ID)).toEqual({ ok: false, error: 'unavailable' });
    }
    for (const response of [new Response('{', { headers: { 'Content-Type': 'application/json' } }), new Response('', { status: 302, headers: { Location: 'https://attacker.example' } })]) {
      const reader = createCoordinationReader(ORIGIN, async () => response);
      expect(await reader.events(ID)).toEqual({ ok: false, error: 'unavailable' });
    }
  });

  it('accepts only the shared JSON event envelope and preserves hints as hints', async () => {
    const page = { reset: true, events: [{ schemaVersion: 'taply.events.v1', eventId: '1', sessionId: ID, type: 'payment.changed', emittedAt: '2026-11-02T00:00:00.000Z', intentId: 'a'.repeat(64), intentRevisionHint: null }] };
    const reader = createCoordinationReader(ORIGIN, async () => Response.json(page));
    expect(await reader.events(ID)).toEqual({ ok: true, value: page });
  });
});
