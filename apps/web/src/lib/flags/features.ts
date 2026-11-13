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
  'gift',
  'giftClaimable',
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
  // Monday sprint E1: local-only address book. It reads and writes this
  // device's storage only and never signs; NEXT_PUBLIC_TAPLY_FLAG_CONTACTS=off hides it.
  contacts: ON,
  // Monday sprint E3: plans exact shares and PRE-FILLS one normal request per share.
  // Settlement uses the existing request flow and its gates; group "done" needs every
  // share Verified Paid. NEXT_PUBLIC_TAPLY_FLAG_SPLIT=off hides it.
  splitPay: ON,
  // Monday sprint E2: local templates that only PRE-FILL the normal request form.
  // Never signs, never charges. NEXT_PUBLIC_TAPLY_FLAG_RECURRING=off hides it.
  recurring: ON,
  // Lead decision 10 / freeze section 1: no env override.
  socialLogin: OFF('security_gate', true),
  milestonePay: OFF('security_gate', true),
  sponsoredGas: OFF('security_gate', true),
  // Taply Gift, Personal: a normal Taply Wallet transfer plus a gift page that
  // re-checks that exact transfer on chain. No new contract. Kill switch:
  // NEXT_PUBLIC_TAPLY_FLAG_GIFT=off.
  gift: ON,
  // Taply Gift, Open (claimable): needs the separate, UNREVIEWED gift contract
  // (contracts/gift) deployed, pinned by code hash, AND an explicit 'on'.
  giftClaimable: OFF('security_gate'),
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
  contacts: 'NEXT_PUBLIC_TAPLY_FLAG_CONTACTS',
  recurring: 'NEXT_PUBLIC_TAPLY_FLAG_RECURRING',
  splitPay: 'NEXT_PUBLIC_TAPLY_FLAG_SPLIT',
  gift: 'NEXT_PUBLIC_TAPLY_FLAG_GIFT',
  giftClaimable: 'NEXT_PUBLIC_TAPLY_FLAG_GIFT_CLAIMABLE',
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
  NEXT_PUBLIC_TAPLY_FLAG_CONTACTS: process.env.NEXT_PUBLIC_TAPLY_FLAG_CONTACTS,
  NEXT_PUBLIC_TAPLY_FLAG_RECURRING: process.env.NEXT_PUBLIC_TAPLY_FLAG_RECURRING,
  NEXT_PUBLIC_TAPLY_FLAG_SPLIT: process.env.NEXT_PUBLIC_TAPLY_FLAG_SPLIT,
  NEXT_PUBLIC_TAPLY_FLAG_GIFT: process.env.NEXT_PUBLIC_TAPLY_FLAG_GIFT,
  NEXT_PUBLIC_TAPLY_FLAG_GIFT_CLAIMABLE: process.env.NEXT_PUBLIC_TAPLY_FLAG_GIFT_CLAIMABLE,
});

export function isEnabled(flag: FeatureFlag): boolean {
  return FLAGS[flag].enabled;
}
