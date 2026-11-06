import { HandshakeSessionSchema } from '@/lib/protocol';
import type { IntentTerms } from '@/lib/protocol';
import type { ChainSide, RoomSnapshot, RoomUnavailable } from '@/lib/handshake/room';
import { DEMO_NOW_NS, DEMO_TERMS, DEMO_TERMS_SUBSTITUTED, demoSession } from './handshake-demo';

/**
 * MOCK. Synthetic room snapshots for the /demo/handshake room adapter preview
 * only, shaped like apps/api `taply.room.v1`. Nothing here came from a session
 * service, a wallet or the chain; `chain` is a synthetic stand-in for what a
 * device's own chain read would say. Imported only by the demo route.
 */

export const ROOM_SCENARIOS = [
  'waiting',
  'joined',
  'interrupted',
  'reconnected',
  'reviewing',
  'wallet',
  'pending',
  'unknown',
  'mismatch',
  'expired',
  'unsupported',
  'verification',
] as const;
export type RoomScenario = (typeof ROOM_SCENARIOS)[number];

export type ScenarioData =
  | { readonly kind: 'unavailable'; readonly reason: RoomUnavailable }
  | {
      readonly kind: 'room';
      readonly room: RoomSnapshot;
      readonly merchantTerms: IntentTerms;
      readonly customerTerms: IntentTerms;
      readonly nowNs: string;
      readonly chain: ChainSide;
    };

const room = (over: Partial<RoomSnapshot>): RoomSnapshot => ({
  schemaVersion: 'taply.room.v1',
  authority: 'coordination_only',
  session: demoSession(0, false),
  phase: 'WAITING_FOR_CUSTOMER',
  reviews: { merchant: false, payer: false },
  presence: { merchant: 'active', payer: null },
  payerProgress: null,
  ...over,
});

const ok = (snapshot: RoomSnapshot, extra: Partial<Extract<ScenarioData, { kind: 'room' }>> = {}): ScenarioData => ({
  kind: 'room',
  room: snapshot,
  merchantTerms: DEMO_TERMS,
  customerTerms: DEMO_TERMS,
  nowNs: DEMO_NOW_NS,
  chain: 'open',
  ...extra,
});

const SYNTHETIC_HASH = '9x5BWFTV7ZcFDXxHyLsdNFHD5KQdXLfwQdgs6GPdShfJ';

export function roomScenario(scenario: RoomScenario): ScenarioData {
  const joined = demoSession(1, false);
  const reviewed = demoSession(3, true);
  switch (scenario) {
    case 'waiting':
      return ok(room({}));
    case 'joined':
      return ok(room({ session: joined, phase: 'WAITING_FOR_REVIEW', presence: { merchant: 'active', payer: 'joined' } }));
    case 'interrupted':
      return ok(room({ session: joined, phase: 'WAITING_FOR_REVIEW', presence: { merchant: 'active', payer: 'disconnected' } }));
    case 'reconnected':
      return ok(room({ session: joined, phase: 'WAITING_FOR_REVIEW', presence: { merchant: 'active', payer: 'resumed' } }));
    case 'reviewing':
      return ok(room({ session: joined, phase: 'WAITING_FOR_REVIEW', reviews: { merchant: true, payer: false }, presence: { merchant: 'active', payer: 'active' } }));
    case 'wallet':
      return ok(
        room({
          session: reviewed,
          phase: 'WAITING_FOR_WALLET',
          reviews: { merchant: true, payer: true },
          presence: { merchant: 'active', payer: 'active' },
          payerProgress: { phase: 'AWAITING_WALLET', transactionHash: null },
        }),
      );
    case 'pending':
      return ok(
        room({
          session: reviewed,
          phase: 'PENDING_CHAIN',
          reviews: { merchant: true, payer: true },
          presence: { merchant: 'active', payer: 'active' },
          payerProgress: { phase: 'SUBMITTED', transactionHash: SYNTHETIC_HASH },
        }),
      );
    case 'unknown':
      return ok(
        room({
          session: reviewed,
          phase: 'BLOCKED',
          reviews: { merchant: true, payer: true },
          presence: { merchant: 'active', payer: 'active' },
          payerProgress: { phase: 'OUTCOME_UNKNOWN', transactionHash: null },
        }),
      );
    case 'mismatch':
      return ok(
        room({ session: reviewed, phase: 'WAITING_FOR_WALLET', reviews: { merchant: true, payer: true }, presence: { merchant: 'active', payer: 'active' } }),
        { customerTerms: DEMO_TERMS_SUBSTITUTED },
      );
    case 'expired':
      return ok(room({ session: HandshakeSessionSchema.parse({ ...joined, state: 'EXPIRED' }), phase: 'EXPIRED', presence: { merchant: 'active', payer: 'disconnected' } }));
    case 'unsupported':
      return { kind: 'unavailable', reason: 'unsupported_version' };
    case 'verification':
      return { kind: 'unavailable', reason: 'verification_unavailable' };
  }
}
