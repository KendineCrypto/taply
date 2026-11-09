import { describe, expect, it, vi } from 'vitest';
import { normalizeUsername, requestTestnetAccount, TESTNET_HELPER_ACCOUNT_URL, usernameAccountId, usernameProblem } from '../testnet-account';

describe('username.testnet rules', () => {
  it('normalizes case, whitespace and a typed .testnet suffix only', () => {
    expect(normalizeUsername('  Alice.TESTNET ')).toBe('alice');
    expect(normalizeUsername('bob')).toBe('bob');
    expect(normalizeUsername('a.b')).toBe('a.b');
    expect(usernameAccountId('alice')).toBe('alice.testnet');
  });
  it('accepts NEAR name syntax 2-40 chars and explains every refusal', () => {
    for (const ok of ['al', 'alice', 'alice_01', 'a-b-c', '0x1', 'a'.repeat(40)]) expect(usernameProblem(ok)).toBeNull();
    expect(usernameProblem('a')).toBe('too_short');
    expect(usernameProblem('a'.repeat(41))).toBe('too_long');
    for (const bad of ['a.b', 'ali ce', 'ålice', 'alice!', 'ALICE']) expect(usernameProblem(bad)).toBe('invalid_chars');
    for (const bad of ['-alice', 'alice_', 'a__b', 'a-_b']) expect(usernameProblem(bad)).toBe('bad_separator');
  });
});

describe('Testnet faucet request', () => {
  const key = 'ed25519:' + '1'.repeat(44);
  it('posts exactly the account and public key, without credentials or referrer', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{"secret":"ignored"}', { status: 200 }));
    expect(await requestTestnetAccount('alice.testnet', key, { fetcher })).toEqual({ ok: true });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(TESTNET_HELPER_ACCOUNT_URL);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ newAccountId: 'alice.testnet', newAccountPublicKey: key });
    expect(init?.credentials).toBe('omit');
    expect(init?.redirect).toBe('error');
    expect(init?.referrerPolicy).toBe('no-referrer');
  });
  it('classifies rate limits, refusals, outages and network errors coarsely', async () => {
    const status = (code: number) => ({ fetcher: (async () => new Response('x', { status: code })) as typeof fetch });
    expect(await requestTestnetAccount('a.testnet', key, status(429))).toEqual({ ok: false, reason: 'rate_limited' });
    expect(await requestTestnetAccount('a.testnet', key, status(400))).toEqual({ ok: false, reason: 'rejected' });
    expect(await requestTestnetAccount('a.testnet', key, status(503))).toEqual({ ok: false, reason: 'unavailable' });
    const offline = { fetcher: (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch };
    expect(await requestTestnetAccount('a.testnet', key, offline)).toEqual({ ok: false, reason: 'unavailable' });
  });
  it('times out instead of hanging', async () => {
    const hang = ((_u: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_r, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as typeof fetch;
    expect(await requestTestnetAccount('a.testnet', key, { fetcher: hang, timeoutMs: 5 })).toEqual({ ok: false, reason: 'unavailable' });
  });
});
