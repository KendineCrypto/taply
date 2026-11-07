import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy, createNonce, hstsHeaderValue, parseCspMode } from '../csp';
import { pageCspNonce } from '@/lib/wallet/near-connect';

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(';').map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name as string, values];
    }),
  );
}

describe('Content-Security-Policy', () => {
  const nonce = 'q8hJ1n0bJm9mX0lJb0y3cA==';

  it('allows scripts only by nonce (+ strict-dynamic) in production, with no eval or inline', () => {
    const d = directives(buildContentSecurityPolicy({ nonce, dev: false }));
    expect(d.get('script-src')).toEqual(["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"]);
    const all = [...d.values()].flat();
    expect(all).not.toContain("'unsafe-eval'");
    expect(d.get('script-src')).not.toContain("'unsafe-inline'");
    expect(d.get('script-src')).not.toContain('https:');
    expect(d.get('script-src')).not.toContain('*');
  });

  it('locks down framing, plugins, base and form targets', () => {
    const d = directives(buildContentSecurityPolicy({ nonce, dev: false }));
    expect(d.get('frame-ancestors')).toEqual(["'none'"]);
    expect(d.get('object-src')).toEqual(["'none'"]);
    expect(d.get('base-uri')).toEqual(["'self'"]);
    expect(d.get('form-action')).toEqual(["'self'"]);
    expect(d.get('default-src')).toEqual(["'self'"]);
  });

  it('never allows plain http or wildcard network targets', () => {
    const d = directives(buildContentSecurityPolicy({ nonce, dev: false }));
    for (const name of ['connect-src', 'img-src', 'frame-src', 'font-src', 'worker-src']) {
      const values = d.get(name) ?? [];
      expect(values, name).not.toContain('http:');
      expect(values, name).not.toContain('*');
      expect(values, name).not.toContain('ws:');
    }
  });

  it("adds 'unsafe-eval' and ws: only for next dev", () => {
    const d = directives(buildContentSecurityPolicy({ nonce, dev: true }));
    expect(d.get('script-src')).toContain("'unsafe-eval'");
    expect(d.get('connect-src')).toContain('ws:');
  });

  it('refuses a nonce that could break out of the header', () => {
    for (const bad of ['', 'short', "abc'; script-src *", `${'a'.repeat(20)} 'unsafe-inline'`]) {
      expect(() => buildContentSecurityPolicy({ nonce: bad, dev: false })).toThrow();
    }
  });

  it('creates a fresh 128-bit base64 nonce each time', () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(() => buildContentSecurityPolicy({ nonce: a, dev: false })).not.toThrow();
  });

  it('defaults to enforce; only exact words switch it', () => {
    expect(parseCspMode(undefined)).toBe('enforce');
    expect(parseCspMode('OFF')).toBe('enforce');
    expect(parseCspMode('report-only')).toBe('report-only');
    expect(parseCspMode('off')).toBe('off');
  });
});

describe('HSTS', () => {
  it('is off unless a sane max-age is configured, and never adds includeSubDomains or preload', () => {
    expect(hstsHeaderValue(undefined)).toBeNull();
    expect(hstsHeaderValue('')).toBeNull();
    expect(hstsHeaderValue('abc')).toBeNull();
    expect(hstsHeaderValue('99999999')).toBeNull();
    expect(hstsHeaderValue('86400')).toBe('max-age=86400');
    expect(hstsHeaderValue('63072000')).toBe('max-age=63072000');
  });
});

describe('wallet iframe nonce hand-off', () => {
  it('reads the nonce property (nonce hiding) from a Next script', () => {
    document.head.innerHTML = '';
    const script = document.createElement('script');
    script.setAttribute('nonce', '');
    script.nonce = 'q8hJ1n0bJm9mX0lJb0y3cA==';
    document.head.appendChild(script);
    expect(pageCspNonce()).toBe('q8hJ1n0bJm9mX0lJb0y3cA==');
  });

  it('returns undefined without a usable nonce', () => {
    document.head.innerHTML = '<script nonce="bad nonce"></script>';
    expect(pageCspNonce()).toBeUndefined();
    document.head.innerHTML = '';
    expect(pageCspNonce()).toBeUndefined();
  });
});
