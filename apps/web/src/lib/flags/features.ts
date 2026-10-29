/**
 * Capability flags.
 *
 * Every flag defaults to OFF and may only be turned on once the capability is
 * actually verified on NEAR Testnet (freeze section 10, docs/EVIDENCE.md).
 * A flag is a statement about observed reality, not a wish.
 *
 * `socialLogin` and `milestonePay` have NO env override on purpose: freeze
 * section 1 and lead decision 10 keep them disabled until separate security and
 * proof gates pass, so they cannot be switched on by configuration alone.
 */

export const FEATURE_FLAGS = [
  'walletConnect',
  'instantPay',
  'merchantCheckout',
  'handshake',
  'protectedPay',
  'contacts',
  'splitPay',
  'recurring',
  'socialLogin',
  'milestonePay',
  'sponsoredGas',
] as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

export interface FlagState {
  readonly enabled: boolean;
  /**
   * Why it is off, shown verbatim in the UI so a disabled surface is honest
   * rather than mysterious. Mirrors docs/EVIDENCE.md status values.
   */
  readonly reason: 'not_implemented' | 'awaiting_testnet_proof' | 'security_gate' | 'enabled';
  /** True when no amount of configuration may enable it (gate is human-only). */
  readonly hardDisabled: boolean;
}

const OFF = (reason: FlagState['reason'], hardDisabled = false): FlagState => ({
  enabled: false,
  reason,
  hardDisabled,
});

/**
 * Phase 0 reality: nothing chain-facing exists yet in apps/web, and Codex has
 * not deployed a contract. Every payment capability is therefore off.
 */
const DEFAULTS: Readonly<Record<FeatureFlag, FlagState>> = {
  walletConnect: OFF('not_implemented'),
  instantPay: OFF('awaiting_testnet_proof'),
  merchantCheckout: OFF('not_implemented'),
  handshake: OFF('not_implemented'),
  // Freeze section 10 item 6: human review of escrow custody required first.
  protectedPay: OFF('security_gate'),
  contacts: OFF('not_implemented'),
  splitPay: OFF('not_implemented'),
  recurring: OFF('not_implemented'),
  // Lead decision 10 / freeze section 1: no env override.
  socialLogin: OFF('security_gate', true),
  milestonePay: OFF('security_gate', true),
  sponsoredGas: OFF('security_gate', true),
};

/** Env overrides may only ever turn a soft-disabled flag ON when explicitly 'on'. */
const ENV_KEYS: Partial<Record<FeatureFlag, string>> = {
  walletConnect: 'NEXT_PUBLIC_TAPLY_FLAG_WALLET',
  protectedPay: 'NEXT_PUBLIC_TAPLY_FLAG_PROTECTED_PAY',
  handshake: 'NEXT_PUBLIC_TAPLY_FLAG_HANDSHAKE',
  merchantCheckout: 'NEXT_PUBLIC_TAPLY_FLAG_MERCHANT',
};

export function resolveFlags(env: Record<string, string | undefined>): Readonly<Record<FeatureFlag, FlagState>> {
  const resolved: Record<FeatureFlag, FlagState> = { ...DEFAULTS };

  for (const flag of FEATURE_FLAGS) {
    const base = DEFAULTS[flag];
    if (base.hardDisabled) continue;

    const key = ENV_KEYS[flag];
    if (!key) continue;

    if (env[key] === 'on') {
      resolved[flag] = { enabled: true, reason: 'enabled', hardDisabled: false };
    }
  }

  return resolved;
}

export const FLAGS = resolveFlags({
  NEXT_PUBLIC_TAPLY_FLAG_WALLET: process.env.NEXT_PUBLIC_TAPLY_FLAG_WALLET,
  NEXT_PUBLIC_TAPLY_FLAG_PROTECTED_PAY: process.env.NEXT_PUBLIC_TAPLY_FLAG_PROTECTED_PAY,
  NEXT_PUBLIC_TAPLY_FLAG_HANDSHAKE: process.env.NEXT_PUBLIC_TAPLY_FLAG_HANDSHAKE,
  NEXT_PUBLIC_TAPLY_FLAG_MERCHANT: process.env.NEXT_PUBLIC_TAPLY_FLAG_MERCHANT,
});

export function isEnabled(flag: FeatureFlag): boolean {
  return FLAGS[flag].enabled;
}
