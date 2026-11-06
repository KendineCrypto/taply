import { afterEach, describe, expect, it, vi } from 'vitest';
import { approvedPayOrigins, canonicalPayUrl, resolveShareOrigin, validateShareOrigin } from '../origin';

const ID = '9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502';

afterEach(() => vi.unstubAllEnvs());

describe('validateShareOrigin: only public HTTPS origins become mobile-ready share links', () => {
  it('accepts public HTTPS origins and normalizes them', () => {
    expect(validateShareOrigin('https://taply.app')).toBe('https://taply.app');
    expect(validateShareOrigin('https://Pay.Taply.App/')).toBe('https://pay.taply.app');
    expect(validateShareOrigin('https://pilot-host.tail1234.ts.net')).toBe('https://pilot-host.tail1234.ts.net');
    expect(validateShareOrigin('https://taply.app:8443')).toBe('https://taply.app:8443');
    expect(validateShareOrigin('https://taply.app:443')).toBe('https://taply.app');
  });

  it('rejects localhost, IPs, private names, HTTP and anything that is not just an origin', () => {
    for (const value of [
      undefined,
      null,
      '',
      'taply.app',
      'http://taply.app',
      'http://localhost:3000',
      'https://localhost',
      'https://localhost:3000',
      'https://app.localhost',
      'https://127.0.0.1',
      'https://127.0.0.1:3000',
      'https://2130706433',
      'https://0x7f000001',
      'https://0177.0.0.1',
      'https://%6cocalhost',
      'https://10.0.0.5',
      'https://192.168.1.20:3000',
      'https://172.16.4.2',
      'https://100.101.102.103',
      'https://8.8.8.8',
      'https://[::1]',
      'https://[::ffff:127.0.0.1]',
      'https://[fd7a:115c:a1e0::1]',
      'https://my-laptop',
      'https://my-laptop.local',
      'https://nas.home.arpa',
      'https://box.internal',
      'https://site.test',
      'https://taply.example',
      'https://taply.app/pay',
      'https://taply.app/pay/..',
      'https://taply.app/.',
      'https:taply.app',
      'https:///taply.app',
      'https://taply.\napp',
      'https://taply.app\\',
      'https://taply.app/?x=1',
      'https://taply.app/#top',
      'https://taply.app?',
      'https://user@taply.app',
      'https://user:pw@taply.app',
      'javascript:alert(1)',
      'https://-bad.app',
      'https://taply.123',
    ]) {
      expect(validateShareOrigin(value), String(value)).toBeNull();
    }
  });
});

describe('resolveShareOrigin', () => {
  it('production uses its own HTTPS origin', () => {
    expect(resolveShareOrigin({ configured: undefined, current: 'https://taply.app' })).toEqual({
      kind: 'ok',
      origin: 'https://taply.app',
      source: 'current',
    });
  });

  it('a local pilot uses the configured public HTTPS origin, never localhost', () => {
    expect(resolveShareOrigin({ configured: 'https://pilot.taply.app', current: 'http://localhost:3000' })).toEqual({
      kind: 'ok',
      origin: 'https://pilot.taply.app',
      source: 'configured',
    });
  });

  it('localhost without a configured origin has no shareable link', () => {
    expect(resolveShareOrigin({ configured: undefined, current: 'http://localhost:3000' })).toEqual({
      kind: 'unavailable',
      reason: 'local_only',
    });
    expect(resolveShareOrigin({ configured: '', current: 'http://192.168.1.20:3000' })).toEqual({
      kind: 'unavailable',
      reason: 'local_only',
    });
  });

  it('a bad configured origin is never used; it falls back to a valid page origin or says why', () => {
    expect(resolveShareOrigin({ configured: 'http://192.168.1.20:3000', current: 'http://localhost:3000' })).toEqual({
      kind: 'unavailable',
      reason: 'invalid_config',
    });
    expect(resolveShareOrigin({ configured: 'https://localhost', current: 'https://taply.app' })).toEqual({
      kind: 'ok',
      origin: 'https://taply.app',
      source: 'current',
    });
  });
});

describe('canonicalPayUrl', () => {
  it('is the one link QR, copy and share use, with the request ID exactly', () => {
    expect(canonicalPayUrl('https://pilot.taply.app/', ID)).toBe(`https://pilot.taply.app/pay/${ID}`);
  });

  it('refuses unshareable origins and anything but a request ID', () => {
    expect(() => canonicalPayUrl('http://localhost:3000', ID)).toThrow();
    expect(() => canonicalPayUrl('https://taply.app', `${ID}/../x`)).toThrow();
    expect(() => canonicalPayUrl('https://taply.app', ID.toUpperCase())).toThrow();
  });
});

describe('approvedPayOrigins', () => {
  it('approves this page’s origin and the configured share origin only', () => {
    vi.stubEnv('NEXT_PUBLIC_TAPLY_SHARE_ORIGIN', 'https://pilot.taply.app');
    expect(approvedPayOrigins('http://localhost:3000')).toEqual(['http://localhost:3000', 'https://pilot.taply.app']);
    vi.stubEnv('NEXT_PUBLIC_TAPLY_SHARE_ORIGIN', 'http://10.0.0.5:3000');
    expect(approvedPayOrigins('https://taply.app')).toEqual(['https://taply.app']);
  });
});
