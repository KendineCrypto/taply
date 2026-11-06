import { VerifierRpcError } from '../rpc';
import type { LocatorMethod, LocatorRpc } from '../rpc';

/**
 * Synthetic block/chunk chain for the Phase 7G funding locator. NOT Testnet
 * evidence: heights, timestamps, chunk and transaction hashes are invented.
 */

export interface FakeTx {
  readonly hash: string;
  readonly signer_id: string;
  readonly receiver_id: string;
  readonly actions: ReadonlyArray<unknown>;
}

export interface FakeLocatorChain {
  readonly finalHeight: number;
  /** Timestamp of each existing height (ns). */
  readonly timestamps: Map<number, bigint>;
  /** Transactions in the NEW chunk of a height. */
  readonly txs: Map<number, FakeTx[]>;
  /** Heights below this are pruned (UNKNOWN_BLOCK). */
  prunedBelow: number;
  /** Methods called, in order. */
  readonly calls: string[];
  failWith: VerifierRpcError | null;
}

export function payCall(id: string, extra: Record<string, unknown> = {}): unknown {
  return { FunctionCall: { method_name: 'pay_instant_native', args: btoa(JSON.stringify({ id, expectedTermsHash: 'a'.repeat(64), ...extra })), gas: 1, deposit: '1' } };
}

/**
 * A chain of `finalHeight` blocks, ~1.1 s apart with a few skipped heights,
 * where block `fundingHeight` has exactly `fundedAtNs` as its timestamp.
 */
export function buildLocatorChain(input: {
  readonly fundedAtNs: string;
  readonly fundingHeight: number;
  readonly finalHeight?: number;
  readonly skipped?: ReadonlyArray<number>;
}): FakeLocatorChain {
  const finalHeight = input.finalHeight ?? input.fundingHeight + 500;
  const skipped = new Set(input.skipped ?? [input.fundingHeight - 7, input.fundingHeight + 3, input.fundingHeight + 120]);
  const timestamps = new Map<number, bigint>();
  const target = BigInt(input.fundedAtNs);
  for (let h = 1; h <= finalHeight; h++) {
    if (skipped.has(h) && h !== input.fundingHeight) continue;
    // Uneven spacing so interpolation must refine: 1.0 s or 1.3 s per block.
    const offset = BigInt(h - input.fundingHeight);
    timestamps.set(h, target + offset * 1_100_000_000n + (h % 3 === 0 ? 50_000_000n : 0n) - (input.fundingHeight % 3 === 0 ? 50_000_000n : 0n));
  }
  return { finalHeight, timestamps, txs: new Map(), prunedBelow: 0, calls: [], failWith: null };
}

export function fakeLocatorRpc(chain: FakeLocatorChain, providerId = 'fake-testnet'): LocatorRpc {
  const blockJson = (h: number) => ({
    header: { height: h, timestamp_nanosec: String(chain.timestamps.get(h)) },
    chunks: [
      { chunk_hash: `chunk-new-${h}-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`, height_included: h },
      { chunk_hash: `chunk-old-${h}-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`, height_included: h - 1 },
    ],
  });
  return {
    providerId,
    async call(method: LocatorMethod, params: unknown) {
      chain.calls.push(method);
      if (chain.failWith !== null) throw chain.failWith;
      const p = params as Record<string, unknown>;
      if (method === 'block') {
        const h = p['finality'] === 'final' ? chain.finalHeight : Number(p['block_id']);
        if (h < chain.prunedBelow || !chain.timestamps.has(h)) throw new VerifierRpcError('UNKNOWN_BLOCK');
        return blockJson(h);
      }
      const id = String(p['chunk_id']);
      const match = /^chunk-(new|old)-(\d+)-/.exec(id);
      if (match === null) throw new VerifierRpcError('UNKNOWN_BLOCK');
      const h = Number(match[2]);
      return { transactions: match[1] === 'new' ? (chain.txs.get(h) ?? []) : [{ hash: 'OLD', signer_id: 'x', receiver_id: 'y', actions: [] }] };
    },
  };
}
