import { describe, expect, it, vi } from 'vitest';
import { verifyAcrossProviders } from '../fallback';
import type { VerificationResult } from '../instant-receipt';
import type { VerifierRpc } from '../rpc';
import { resolveChainConfig } from '@/lib/near/config';

const rpc = (providerId: string): VerifierRpc => ({ providerId, call: async () => null });
const input = { contractId: 'c.testnet', approvedCodeHash: 'h', requestId: 'r', fundingTransaction: { hash: 'x', signerAccountId: 'p.testnet' }, retryTransactions: [] };
const transient: VerificationResult = { kind: 'not_verified', reason: 'RPC_UNAVAILABLE', detail: 'down', transient: true };
const definitive: VerificationResult = { kind: 'not_verified', reason: 'EVIDENCE_INCONSISTENT', detail: 'mismatch', transient: false };
const verified = (p: string) => ({ kind: 'verified', receipt: { provider: p } }) as unknown as VerificationResult;

describe('verifyAcrossProviders', () => {
  it('a transient primary failure re-runs the WHOLE proof on the fallback', async () => {
    const verify = vi.fn(async ({ rpc }: { rpc: VerifierRpc }) => (rpc.providerId === 'a' ? transient : verified('b')));
    const out = await verifyAcrossProviders(input, [rpc('a'), rpc('b')], verify as never);
    expect(out.kind).toBe('verified');
    expect(verify.mock.calls.map(([i]) => i.rpc.providerId)).toEqual(['a', 'b']);
  });
  it('a definitive failure is final: no other provider can outvote it', async () => {
    const verify = vi.fn(async ({ rpc }: { rpc: VerifierRpc }) => (rpc.providerId === 'a' ? definitive : verified('b')));
    expect(await verifyAcrossProviders(input, [rpc('a'), rpc('b')], verify as never)).toBe(definitive);
    expect(verify).toHaveBeenCalledTimes(1);
  });
  it('primary success never touches the fallback; all-transient returns the last failure', async () => {
    const ok = vi.fn(async () => verified('a'));
    await verifyAcrossProviders(input, [rpc('a'), rpc('b')], ok as never);
    expect(ok).toHaveBeenCalledTimes(1);
    const down = vi.fn(async () => transient);
    expect(await verifyAcrossProviders(input, [rpc('a'), rpc('b')], down as never)).toBe(transient);
    expect((await verifyAcrossProviders(input, [], down as never)).kind).toBe('not_verified');
  });
});

describe('verifier fallback config', () => {
  const base = { verifierRpcUrl: 'https://archival-rpc.testnet.near.org', verifierRpcProviderId: 'near-archival' };
  it('defaults to FastNEAR archival, can be turned off, never duplicates the primary', () => {
    const on = resolveChainConfig(base);
    expect(on.ok && on.verifierFallback?.rpcUrl).toBe('https://archival-rpc.testnet.fastnear.com');
    const off = resolveChainConfig({ ...base, verifierFallbackRpcUrl: 'off' });
    expect(off.ok && off.verifierFallback).toBe(null);
    const same = resolveChainConfig({ verifierRpcUrl: 'https://archival-rpc.testnet.fastnear.com', verifierRpcProviderId: 'fastnear' });
    expect(same.ok && same.verifierFallback).toBe(null);
    expect(resolveChainConfig({ ...base, verifierFallbackRpcUrl: 'http://insecure', verifierFallbackRpcProviderId: 'x' }).ok).toBe(false);
  });
});
