import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@taply/shared';
import { EncryptedMainnetVault } from '@taply/near-client';
import { MAINNET_INDEPENDENT_VERIFIER_AVAILABLE, MAINNET_SIGNING_RELEASE_APPROVED, ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED } from '../release-gates';
import type { MainnetAuthorityCommand, MainnetSigningProfiles } from '@taply/near-client';
import { AuthorityError, createHttpMainnetAuthority, nearConnectAuthoritySigner, policyHashOf, vaultAuthoritySigner } from '../authority-client';
import { resolveAuthority } from '../wallet-ops';

const profiles: MainnetSigningProfiles = { network: { network: 'near-mainnet', rpcUrl: 'https://rpc.mainnet.fastnear.com', rpcProviderId: 'fastnear-mainnet' } };
const KEY = 'ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp';
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (x) => x.toString(16).padStart(2, '0')).join('');

async function challengeFor(command: MainnetAuthorityCommand, patch: Record<string, unknown> = {}) {
  const fields = { id: crypto.randomUUID(), network: 'near-mainnet', purpose: 'taply-wallet-authority-v1', origin: 'https://mainnet.taplyapp.xyz',
    accountId: 'alice.near', publicKey: KEY, deviceId: crypto.randomUUID(), nonceBase64: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
    expiresAtMs: Date.now() + 60_000, commandHash: await sha(canonicalJson(command)), policyHash: await policyHashOf(profiles), recipient: 'https://mainnet.taplyapp.xyz', ...patch };
  return { ...fields, message: canonicalJson(fields) };
}
const signer = (calls: { n: number }) => ({ accountId: 'alice.near', publicKey: KEY, authorize: async () => { calls.n++; throw new AuthorityError('SIGNING_DISABLED'); } });
const fetchReturning = (bodies: Array<{ status: number; body: unknown }>) => {
  let i = 0;
  return async () => { const b = bodies[Math.min(i++, bodies.length - 1)]!; return new Response(JSON.stringify(b.body), { status: b.status, headers: { 'content-type': 'application/json' } }); };
};

describe('authority mode resolution', () => {
  it('isolated-http only when asked; both test modes at once is ambiguous → unavailable', () => {
    expect(resolveAuthority(undefined, true, null, 'isolated-http').kind).toBe('http');
    expect(resolveAuthority('on', true, null, 'isolated-http').kind).toBe('unavailable');
    expect(resolveAuthority(undefined, true, null, 'on').kind).toBe('unavailable');
    expect(resolveAuthority(undefined, true, null, 'off').kind).toBe('unavailable');
    expect(resolveAuthority(undefined, false, null, undefined).kind).toBe('unavailable');
  });
  it('the app release gates are closed (the protocol gate is proven by the wallet-signer tests below)', () => {
    expect([MAINNET_SIGNING_RELEASE_APPROVED, ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED, MAINNET_INDEPENDENT_VERIFIER_AVAILABLE]).toEqual([false, false, false]);
  });
});

describe('authority client fails closed', () => {
  it('policy hash is computed locally and changes with any pin', async () => {
    expect(await policyHashOf(profiles)).toMatch(/^[0-9a-f]{64}$/);
    expect(await policyHashOf({ ...profiles, usdcCodeHash: 'GMjfNNjfTPXSmeRaxgN1oS9srsmBSdS46R6y2kPv6JQf' })).not.toBe(await policyHashOf(profiles));
  });
  it('unmounted endpoint (404) → AUTHORITY_UNAVAILABLE, no wallet prompt', async () => {
    const calls = { n: 0 };
    const a = createHttpMainnetAuthority({ signer: signer(calls), profiles, fetcher: fetchReturning([{ status: 404, body: {} }]) });
    await expect(a.read('alice.near')).rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' });
    expect(calls.n).toBe(0);
  });
  it('a challenge for another command, account or policy is refused before the wallet is asked', async () => {
    for (const patch of [{ commandHash: 'e'.repeat(64) }, { accountId: 'mallory.near' }, { policyHash: 'f'.repeat(64) }, { expiresAtMs: Date.now() - 1 }]) {
      const calls = { n: 0 };
      const a = createHttpMainnetAuthority({ signer: signer(calls), profiles, fetcher: fetchReturning([{ status: 200, body: await challengeFor({ method: 'read' }, patch) }]) });
      await expect(a.read('alice.near')).rejects.toMatchObject({ code: 'INVALID_AUTHORITY_CHALLENGE' });
      expect(calls.n).toBe(0);
    }
  });
  it('a valid challenge reaches the wallet; the closed gate refuses; nothing is executed', async () => {
    const calls = { n: 0 };
    let executed = false;
    const ch = await challengeFor({ method: 'read' });
    const a = createHttpMainnetAuthority({ signer: signer(calls), profiles, fetcher: async (url) => { if (url.endsWith('/execute')) executed = true; return new Response(JSON.stringify(ch), { status: 200 }); } });
    await expect(a.read('alice.near')).rejects.toMatchObject({ code: 'SIGNING_DISABLED' });
    expect(calls.n).toBe(1);
    expect(executed).toBe(false);
    expect(a.deviceId()).toBe(ch.deviceId);
  });
  it('commands for another account are refused locally', async () => {
    const a = createHttpMainnetAuthority({ signer: signer({ n: 0 }), profiles, fetcher: fetchReturning([{ status: 200, body: {} }]) });
    await expect(a.read('bob.near')).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' });
  });
  it('server refusal (503) → AUTHORITY_REFUSED', async () => {
    const a = createHttpMainnetAuthority({ signer: signer({ n: 0 }), profiles, fetcher: fetchReturning([{ status: 503, body: { error: 'AUTHORITY_UNAVAILABLE' } }]) });
    await expect(a.read('alice.near')).rejects.toMatchObject({ code: 'AUTHORITY_REFUSED' });
  });
});

describe('wallet signers are Codex\'s fixed-purpose authorizations and stay gated', () => {
  it('Taply Wallet: vault.authorizeAuthorityCommand rejects with the gate closed → SIGNING_DISABLED, no confirmation shown', async () => {
    const vault = new EncryptedMainnetVault(window.localStorage);
    let confirmed = false;
    const s = vaultAuthoritySigner(vault, { accountId: 'alice.near', publicKey: KEY }, async () => { confirmed = true; return true; });
    await expect(s.authorize(await challengeFor({ method: 'read' }), { method: 'read' }, await policyHashOf(profiles))).rejects.toMatchObject({ code: 'SIGNING_DISABLED' });
    expect(confirmed).toBe(false);
  });
  it('NEAR Connect: authorizeMainnetNearConnectCommand rejects with the gate closed; signMessage never called', async () => {
    let signed = false;
    const wallet = { getAccounts: async () => [{ accountId: 'alice.near', publicKey: KEY }], signMessage: async () => { signed = true; return { accountId: 'alice.near', publicKey: KEY, signature: '' }; } };
    const s = nearConnectAuthoritySigner(wallet, { accountId: 'alice.near', publicKey: KEY }, async () => true);
    await expect(s.authorize(await challengeFor({ method: 'read' }), { method: 'read' }, await policyHashOf(profiles))).rejects.toMatchObject({ code: 'SIGNING_DISABLED' });
    expect(signed).toBe(false);
  });
});
