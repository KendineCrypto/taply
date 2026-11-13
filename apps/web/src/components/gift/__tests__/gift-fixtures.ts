import type { GiftConfig, GiftReader, GiftView } from '@taply/near-client';
import { BLOCK_HASH, CODE_HASH } from '@/test/chain';

export const GIFT_CONTRACT = 'gift.fixture.testnet';
export const GIFT_ID = '0123456789abcdef0123456789abcdef';
export const NOW_NS = 1_794_000_000_000_000_000n;
export const READY = { status: 'ready' as const, contractId: GIFT_CONTRACT, expectedCodeHash: CODE_HASH };
export const ONE = '1000000000000000000000000';
/** seed [7; 32]: the same vector the contract and near-client tests pin. */
export const SECRET = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc';
export const PK7 = 'ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c';
export const CONFIG: GiftConfig = {
  contract: 'taply-gift', version: '0.1.0', reviewStatus: 'UNREVIEWED_NOT_FOR_REAL_FUNDS', asset: 'near:native',
  giftFeeYocto: '10000000000000000000000', minAmountYocto: '10000000000000000000000', maxAmountYocto: '100000000000000000000000000',
  minLifetimeS: '600', maxLifetimeS: '2592000', maxMessageBytes: 280, maxDesign: 7, claimDomain: 'taply-gift-claim:v1',
};

export function giftView(over: Partial<GiftView> = {}): GiftView {
  return {
    id: GIFT_ID, creator: 'alice.testnet', amountYocto: ONE, publicKey: PK7, message: 'Happy hacking 🎁', design: 1,
    createdAtNs: (NOW_NS - 60_000_000_000n).toString(), createdHeight: '990', expiresAtNs: (NOW_NS + 86_400_000_000_000n).toString(),
    status: 'AVAILABLE', beneficiary: null, settledAtNs: null, settledHeight: null, payout: null, payoutNonce: null, ...over,
  };
}
export function claimedBy(account: string, payout: 'PENDING' | 'CONFIRMED' | 'FAILED'): GiftView {
  return giftView({ status: 'CLAIMED', beneficiary: account, settledAtNs: NOW_NS.toString(), settledHeight: '1001', payout, payoutNonce: 1 });
}

const observation = { source: 'rpc' as const, assurance: 'verified_final' as const, observedBlock: { hash: BLOCK_HASH, height: '1000', timestampNs: NOW_NS.toString() },
  checkedAt: '2026-11-13T12:00:00.000Z', stale: false, rpcAvailable: true };

/** Synthetic reader: `state.gift` is what the "chain" shows; `state.fail` simulates an RPC outage. */
export function fakeGiftReader(state: { gift: GiftView | null; fail?: boolean; reads?: number }): GiftReader {
  return {
    client: {} as GiftReader['client'],
    readConfig: async () => ({ observation: { ...observation, data: CONFIG }, error: null }),
    readGift: async () => {
      state.reads = (state.reads ?? 0) + 1;
      if (state.fail) {
        return { observation: { ...observation, assurance: 'unknown', data: null, observedBlock: null, rpcAvailable: false },
          error: { code: 'RPC_UNAVAILABLE', retryable: true, providerId: 'synthetic' } } as unknown as Awaited<ReturnType<GiftReader['readGift']>>;
      }
      return { observation: { ...observation, data: { gift: state.gift, observedAtNs: NOW_NS.toString() } }, error: null };
    },
  };
}
