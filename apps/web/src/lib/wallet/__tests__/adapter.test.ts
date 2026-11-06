import { describe, expect, it } from 'vitest';
import { WalletError, classifyWalletError } from '../adapter';
import { resolveFlags } from '@/lib/flags/features';
import { fill } from '@/lib/i18n';

describe('classifyWalletError', () => {
  it('passes WalletError kinds through', () => {
    expect(classifyWalletError(new WalletError('unavailable'))).toBe('unavailable');
  });

  it('treats a closed picker as cancelled (near-connect throws "User rejected")', () => {
    expect(classifyWalletError(new Error('User rejected'))).toBe('cancelled');
    expect(classifyWalletError('Request was cancelled')).toBe('cancelled');
  });

  it('recognises missing accounts and missing wallets', () => {
    expect(classifyWalletError(new Error('Failed to sign in'))).toBe('no_account');
    expect(classifyWalletError(new Error('No accounts found'))).toBe('no_account');
    expect(classifyWalletError(new Error('Wallet not found'))).toBe('unavailable');
  });

  it('falls back to failed for anything else', () => {
    expect(classifyWalletError(new Error('boom'))).toBe('failed');
    expect(classifyWalletError(undefined)).toBe('failed');
  });
});

describe('capability flags', () => {
  it('enables read-only wallet connection by default and nothing that moves money', () => {
    const flags = resolveFlags({});
    expect(flags.walletConnect.enabled).toBe(true);
    for (const flag of ['instantPay', 'protectedPay', 'merchantCheckout', 'handshake'] as const) {
      expect(flags[flag].enabled, flag).toBe(false);
    }
  });

  it('lets configuration switch wallet connection off', () => {
    const flags = resolveFlags({ NEXT_PUBLIC_TAPLY_FLAG_WALLET: 'off' });
    expect(flags.walletConnect).toEqual({ enabled: false, reason: 'disabled_by_config', hardDisabled: false });
  });

  it('never lets configuration enable a hard-disabled capability', () => {
    const flags = resolveFlags({ NEXT_PUBLIC_TAPLY_FLAG_SOCIAL_LOGIN: 'on' });
    expect(flags.socialLogin.enabled).toBe(false);
    expect(flags.milestonePay.enabled).toBe(false);
  });
});

describe('fill', () => {
  it('replaces known placeholders and leaves unknown ones visible', () => {
    expect(fill('Connected with {wallet}', { wallet: 'HOT' })).toBe('Connected with HOT');
    expect(fill('#{height} at {time}', { height: '1' })).toBe('#1 at {time}');
  });
});
