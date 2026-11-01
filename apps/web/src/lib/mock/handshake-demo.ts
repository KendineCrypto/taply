import { HandshakeSessionSchema, IntentTermsSchema, calculateRequestId, calculateTermsHash } from '@/lib/protocol';
import type { HandshakeSession, IntentTerms } from '@/lib/protocol';
import { localComparisonCode } from '@/lib/handshake/present';

/**
 * MOCK. Synthetic data for the /demo/handshake preview only.
 *
 * Accounts sit under `demo.testnet`, the nonces are fixed patterns and nothing
 * here was ever signed or sent. The comparison code is computed live with the
 * canonical @taply/shared algorithm so the preview shows real behavior, not a
 * hard-coded string. Imported only by the demo route (see the guard test).
 */

export const DEMO_MERCHANT = 'cafe.demo.testnet';
export const DEMO_CUSTOMER = 'guest.demo.testnet';
const DEMO_CONTRACT = 'payments.demo.testnet';
const NONCE = '0000000000000000000000000000000000000000000000000000000000000d01';
const SESSION_NONCE = '0000000000000000000000000000000000000000000000000000000000000d02';
const SESSION_ID = '00000000-0000-4000-8000-00000000d0e0';
/** Fixed synthetic chain time; the session expires 10 minutes later. */
export const DEMO_NOW_NS = '1793520000000000000';
const EXPIRES_NS = '1793520600000000000';

export const DEMO_TERMS: IntentTerms = IntentTermsSchema.parse({
  schemaVersion: 'taply.intent.v1',
  id: calculateRequestId({ contractId: DEMO_CONTRACT, creationNonce: NONCE, creatorAccountId: DEMO_MERCHANT, network: 'near-testnet' }),
  network: 'near-testnet',
  contractId: DEMO_CONTRACT,
  creationNonce: NONCE,
  creatorAccountId: DEMO_MERCHANT,
  assetId: 'near:native',
  amountBaseUnits: '2500000000000000000000000',
  mode: 'instant',
  cancelDurationNs: null,
  fundingExpiresAtNs: EXPIRES_NS,
  permittedPayerAccountId: null,
  merchantAccountId: DEMO_MERCHANT,
  memo: '',
  sessionBinding: { id: SESSION_ID, nonce: SESSION_NONCE, expiresAtNs: EXPIRES_NS },
});

const DEMO_CODE = localComparisonCode(DEMO_TERMS);

export type DemoStep = 0 | 1 | 2 | 3 | 4;

/** The synthetic session snapshot at each demo step. `tampered` simulates a substituted code. */
export function demoSession(step: DemoStep, reviewed: boolean, tampered: boolean): HandshakeSession {
  const joined = step >= 1;
  const state = !joined ? 'OPEN' : reviewed && step >= 3 ? 'REVIEWED' : 'PAIRED';
  return HandshakeSessionSchema.parse({
    id: SESSION_ID,
    nonce: SESSION_NONCE,
    expiresAtNs: EXPIRES_NS,
    state,
    merchantAccountId: DEMO_MERCHANT,
    payerAccountId: joined ? DEMO_CUSTOMER : null,
    intentId: DEMO_TERMS.id,
    termsHash: calculateTermsHash(DEMO_TERMS),
    comparisonCode: tampered ? flip(DEMO_CODE ?? '000000') : DEMO_CODE,
    presence: { merchant: true, payer: joined },
  });
}

function flip(code: string): string {
  const last = code.slice(-1) === 'A' ? 'B' : 'A';
  return `${code.slice(0, -1)}${last}`;
}
