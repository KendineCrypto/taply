/**
 * DEMO JOURNEY FIXTURES - /demo product tour only.
 *
 * Deterministic, invented values that drive the real Taply components through a
 * complete Instant Pay journey. NONE of this is Testnet evidence: no account,
 * contract, transaction or receipt below exists, and every screen that uses
 * these values carries a visible DEMO marker. Explorer links are never rendered
 * for these hashes.
 */

export const DEMO_RECIPIENT = 'mira-demo.testnet';
export const DEMO_PAYER = 'alex-demo.testnet';
export const DEMO_CONTRACT = 'taply-pay-demo.testnet';

/** 248.75 NEAR, shown as the demo wallet balance. */
export const DEMO_BALANCE_YOCTO = '248750000000000000000000000';
/** Default request amount: 12.5 NEAR. */
export const DEMO_AMOUNT_NEAR = '12.5';
export const DEMO_MEMO_EN = 'Dinner split · Friday';
export const DEMO_MEMO_TR = 'Akşam yemeği paylaşımı · Cuma';

/** Storage bond for a 586-byte request at 10^19 yoctoNEAR/byte (sandbox-measured size). */
export const DEMO_STORAGE_BOND_YOCTO = '5860000000000000000000';

/** 2026-11-14T18:00:00Z, the hackathon deadline evening. */
export const DEMO_EXPIRES_AT_NS = '1794679200000000000';
/** 2026-11-13T19:42:10Z */
export const DEMO_SETTLED_AT_NS = '1794598930000000000';

/** Clearly synthetic references (base58 alphabet, start with "Demo"). */
export const DEMO_REFERENCES = {
  fundingTx: 'DemoFundingTx9qWv4kZr8Yp2Ns6Hd3Jf7Lm5Bc1Xa2E',
  transferReceipt: 'DemoTransferRcpt3Kq8Vw2Zs5Ty7Hn4Jp6Mb9Cd1Fg',
  callbackReceipt: 'DemoCallbackRcpt7Rt2Xy5Wq8Ks3Hm6Np9Bv4Cz1Dj',
  stateBlock: '#219874421',
} as const;

export const DEMO_PROVIDER = 'demo-rpc (synthetic)';

export const DEMO_STEPS = ['home', 'receive', 'send', 'create', 'share', 'review', 'progress', 'receipt'] as const;

/** Demo transfer for the Send step: 3.2 NEAR to the demo payer. */
export const DEMO_SEND_AMOUNT_YOCTO = '3200000000000000000000000';
export type DemoStep = (typeof DEMO_STEPS)[number];

export function isDemoStep(value: string | null): value is DemoStep {
  return value !== null && (DEMO_STEPS as ReadonlyArray<string>).includes(value);
}

/** Parses "12.5" -> yoctoNEAR without floating point. null for invalid or zero input. */
export function demoAmountToYocto(text: string): string | null {
  const normalized = text.trim().replace(',', '.');
  const match = /^(\d{1,9})(?:\.(\d{1,24}))?$/.exec(normalized);
  if (match === null) return null;
  const yocto = BigInt(match[1] ?? '0') * 10n ** 24n + BigInt((match[2] ?? '').padEnd(24, '0'));
  return yocto > 0n ? yocto.toString() : null;
}
