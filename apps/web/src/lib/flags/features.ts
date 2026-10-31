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
  readonly reason:
    | 'not_implemented'
    | 'awaiting_testnet_proof'
    | 'security_gate'
    | 'disabled_by_config'
    | 'enabled';
  /** True when no amount of configuration may enable it (gate is human-only). */
  readonly hardDisabled: boolean;
}

const OFF = (reason: FlagState['reason'], hardDisabled = false): FlagState => ({
  enabled: false,
  reason,
  hardDisabled,
});

const ON: FlagState = { enabled: true, reason: 'enabled', hardDisabled: false };

/**
 * Phase 2A reality: an external NEAR Testnet wallet can be connected and the
 * connected account's native balance is read from Testnet RPC. That capability
 * is read-only - it cannot sign or move anything - so it is on by default.
 *
 * Codex has not deployed a contract, so every PAYMENT capability stays off.
 */
const DEFAULTS: Readonly<Record<FeatureFlag, FlagState>> = {
  walletConnect: ON,
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

/**
 * Env overrides: 'on' may turn a soft-disabled flag on; 'off' always turns a
 * flag off (a kill switch). Hard-disabled flags ignore both.
 */
const ENV_KEYS: Partial<Record<FeatureFlag, string>> = {
  walletConnect: 'NEXT_PUBLIC_TAPLY_FLAG_WALLET',
  // Signing gate for Instant Pay transactions. Turning it on is a human decision
  // after Testnet review; it also needs a configured, verified contract.
  instantPay: 'NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY',
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
      resolved[flag] = ON;
    } else if (env[key] === 'off' && base.enabled) {
      resolved[flag] = OFF('disabled_by_config');
    }
  }

  return resolved;
}

export const FLAGS = resolveFlags({
  NEXT_PUBLIC_TAPLY_FLAG_WALLET: process.env.NEXT_PUBLIC_TAPLY_FLAG_WALLET,
  NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY: process.env.NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY,
  NEXT_PUBLIC_TAPLY_FLAG_PROTECTED_PAY: process.env.NEXT_PUBLIC_TAPLY_FLAG_PROTECTED_PAY,
  NEXT_PUBLIC_TAPLY_FLAG_HANDSHAKE: process.env.NEXT_PUBLIC_TAPLY_FLAG_HANDSHAKE,
  NEXT_PUBLIC_TAPLY_FLAG_MERCHANT: process.env.NEXT_PUBLIC_TAPLY_FLAG_MERCHANT,
});

export function isEnabled(flag: FeatureFlag): boolean {
  return FLAGS[flag].enabled;
}
