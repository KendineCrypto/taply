import { z } from 'zod';
import { MAINNET_GENESIS_HASH, MAINNET_GENESIS_HEIGHT } from '@taply/near-client';
import { ASSETS, type Chain, type Proof } from '@/lib/mainnet/crosschain/model';
import { boundedText } from '../oneclick/bounded-body';

export type Rpc = (method: string, params: unknown) => Promise<unknown>;
export function rpcClient(url: string, fetcher: typeof fetch = fetch): Rpc {
  if (new URL(url).protocol !== 'https:') throw new Error('RPC_CONFIG');
  let id = 0;
  return async (method, params) => {
    const r = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000) });
    const text = await boundedText(r.body, 2_097_152, AbortSignal.timeout(8000));
    const b = z.object({ result: z.unknown(), error: z.unknown().optional() }).parse(JSON.parse(text));
    if (!r.ok || b.error) throw new Error('RPC_UNAVAILABLE');
    return b.result;
  };
}
const U = z.string().regex(/^\d+$/), H = z.string().regex(/^0x[0-9a-fA-F]{64}$/), X = z.string().regex(/^0x[0-9a-fA-F]+$/);
const BaseBlock = z.object({ number: X, hash: H, timestamp: X });
const EvmLog = z.object({ address: z.string(), topics: z.array(z.string()), data: X, transactionHash: H, blockHash: H, removed: z.boolean().optional() });
const EvmReceipt = z.object({ transactionHash: H, status: X, blockNumber: X, blockHash: H, logs: z.array(EvmLog).max(512) });
const TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
async function baseAmount(rpc: Rpc, recipient: string, hashes: string[], since: number) {
  if (await rpc('eth_chainId', []) !== '0x2105') throw new Error('NETWORK_MISMATCH');
  const final = BaseBlock.parse(await rpc('eth_getBlockByNumber', ['finalized', false]));
  let amount = 0n;
  for (const hash of hashes) {
    H.parse(hash);
    const r = EvmReceipt.parse(await rpc('eth_getTransactionReceipt', [hash]));
    if (r.transactionHash.toLowerCase() !== hash.toLowerCase() || BigInt(r.status) !== 1n || BigInt(r.blockNumber) > BigInt(final.number)) throw new Error('NOT_FINAL');
    const block = BaseBlock.parse(await rpc('eth_getBlockByNumber', [r.blockNumber, false]));
    if (block.hash !== r.blockHash || block.number !== r.blockNumber || BigInt(block.timestamp) * 1000n < BigInt(since)) throw new Error('EVIDENCE_MISMATCH');
    for (const l of r.logs) {
      if (l.removed || l.blockHash !== r.blockHash || l.transactionHash.toLowerCase() !== hash.toLowerCase()) throw new Error('EVIDENCE_MISMATCH');
      if (l.address.toLowerCase() === ASSETS.base.contract && l.topics.length === 3 && l.topics[0]?.toLowerCase() === TOPIC && l.topics[2]?.toLowerCase() === `0x${'0'.repeat(24)}${recipient.slice(2).toLowerCase()}`) amount += BigInt(l.data);
    }
  }
  return amount;
}
const SolBalance = z.object({ accountIndex: z.number().int().nonnegative(), mint: z.string(), owner: z.string().optional(), uiTokenAmount: z.object({ amount: U, decimals: z.number().int() }) });
const SolTx = z.object({ blockTime: z.number(), transaction: z.object({ signatures: z.array(z.string()) }), meta: z.object({ err: z.null(), preTokenBalances: z.array(SolBalance), postTokenBalances: z.array(SolBalance) }) });
async function solAmount(rpc: Rpc, recipient: string, hashes: string[], since: number) {
  if (await rpc('getGenesisHash', []) !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw new Error('NETWORK_MISMATCH');
  let total = 0n;
  for (const hash of hashes) {
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(hash)) throw new Error('HASH_INVALID');
    const r = SolTx.parse(await rpc('getTransaction', [hash, { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]));
    if (r.transaction.signatures[0] !== hash || r.blockTime * 1000 < since) throw new Error('EVIDENCE_MISMATCH');
    let delta = 0n;
    const before = new Map(r.meta.preTokenBalances.map(b => [b.accountIndex, b]));
    const after = new Map(r.meta.postTokenBalances.map(b => [b.accountIndex, b]));
    if (before.size !== r.meta.preTokenBalances.length || after.size !== r.meta.postTokenBalances.length) throw new Error('EVIDENCE_MISMATCH');
    for (const index of new Set([...before.keys(), ...after.keys()])) {
      const pre = before.get(index), post = after.get(index);
      const belongs = [pre, post].some(b => b?.owner === recipient && b.mint === ASSETS.sol.contract);
      if (!belongs) continue;
      // Include closed source accounts as debits, not only positive post balances.
      for (const b of [pre, post]) if (b && (b.owner !== recipient || b.mint !== ASSETS.sol.contract || b.uiTokenAmount.decimals !== 6)) throw new Error('EVIDENCE_MISMATCH');
      delta += BigInt(post?.uiTokenAmount.amount ?? '0') - BigInt(pre?.uiTokenAmount.amount ?? '0');
    }
    total += delta;
  }
  return total;
}
const NearBlock = z.object({ header: z.object({ hash: z.string(), height: z.number().int().safe(), timestamp_nanosec: U }) });
const NearOutcome = z.object({ id: z.string(), block_hash: z.string(), outcome: z.object({ executor_id: z.string(), receipt_ids: z.array(z.string()).max(256), logs: z.array(z.string()).max(1024), status: z.record(z.string(), z.unknown()) }) });
const NearTx = z.object({ final_execution_status: z.literal('FINAL'), transaction: z.object({ hash: z.string() }), transaction_outcome: NearOutcome, receipts_outcome: z.array(NearOutcome).max(256) });
async function nearAmount(rpc: Rpc, recipient: string, hashes: string[], since: number, codeHash: string | undefined) {
  if (!codeHash) throw new Error('USDC_PIN_REQUIRED');
  const status = z.object({ chain_id: z.literal('mainnet') }).parse(await rpc('status', [])); void status;
  const genesis = NearBlock.parse(await rpc('block', { block_id: MAINNET_GENESIS_HEIGHT }));
  if (genesis.header.hash !== MAINNET_GENESIS_HASH) throw new Error('NETWORK_MISMATCH');
  const final = NearBlock.parse(await rpc('block', { finality: 'final' }));
  let amount = 0n;
  for (const hash of hashes) {
    if (!/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash)) throw new Error('HASH_INVALID');
    const r = NearTx.parse(await rpc('EXPERIMENTAL_tx_status', { tx_hash: hash, sender_account_id: 'intents.near', wait_until: 'FINAL' }));
    if (r.transaction.hash !== hash || r.transaction_outcome.id !== hash) throw new Error('EVIDENCE_MISMATCH');
    const nodes = new Map([r.transaction_outcome, ...r.receipts_outcome].map(n => [n.id, n]));
    if (nodes.size !== r.receipts_outcome.length + 1) throw new Error('EVIDENCE_MISMATCH');
    const visited = new Set<string>(), stack = [hash];
    while (stack.length) { const id = stack.pop()!; const n = nodes.get(id); if (!n || visited.has(id)) throw new Error('EVIDENCE_INCOMPLETE'); visited.add(id); stack.push(...n.outcome.receipt_ids); }
    if (visited.size !== nodes.size) throw new Error('EVIDENCE_MISMATCH');
    for (const blockHash of new Set(r.receipts_outcome.filter(n => n.outcome.executor_id === ASSETS.near.contract).map(n => n.block_hash))) {
      const b = NearBlock.parse(await rpc('block', { block_id: blockHash }));
      const a = z.object({ code_hash: z.string(), block_hash: z.string() }).parse(await rpc('query', { request_type: 'view_account', account_id: ASSETS.near.contract, block_id: blockHash }));
      if (b.header.hash !== blockHash || b.header.height > final.header.height || BigInt(b.header.timestamp_nanosec) < BigInt(since) * 1_000_000n || a.block_hash !== blockHash || a.code_hash !== codeHash) throw new Error('EVIDENCE_MISMATCH');
    }
    for (const n of r.receipts_outcome) {
      if (n.outcome.executor_id !== ASSETS.near.contract || !('SuccessValue' in n.outcome.status)) continue;
      for (const log of n.outcome.logs) {
        if (!log.startsWith('EVENT_JSON:')) continue;
        const e = JSON.parse(log.slice(11)) as { standard?: string; event?: string; data?: Array<{ new_owner_id?: string; amount?: string }> };
        if (e.standard !== 'nep141' || e.event !== 'ft_transfer' || !Array.isArray(e.data)) continue;
        for (const v of e.data) if (v.new_owner_id === recipient) amount += BigInt(U.parse(v.amount));
      }
    }
  }
  return amount;
}
export function deliveryVerifier(env: Readonly<Record<string, string | undefined>>, fetcher: typeof fetch = fetch) {
  return async (chain: Chain, recipient: string, min: string, rawHashes: string[], since: number): Promise<Proof> => {
    const hashes = [...new Set(rawHashes.map(h => chain === 'base' ? h.toLowerCase() : h))]; const pending: Proof = { state: 'pending', amount: null, chain, txs: hashes.slice(0, 8), trust: 'configured-rpc' };
    if (!hashes.length || hashes.length > 8) return pending;
    try {
      const url = chain === 'base' ? env['TAPLY_BASE_RPC_URL'] ?? 'https://mainnet.base.org' : chain === 'sol' ? env['TAPLY_SOLANA_RPC_URL'] ?? 'https://api.mainnet-beta.solana.com' : env['NEXT_PUBLIC_TAPLY_VERIFIER_RPC_URL'] ?? 'https://archival-rpc.mainnet.fastnear.com';
      const rpc = rpcClient(url, fetcher);
      const amount = chain === 'base' ? await baseAmount(rpc, recipient, hashes, since) : chain === 'sol' ? await solAmount(rpc, recipient, hashes, since) : await nearAmount(rpc, recipient, hashes, since, env['NEXT_PUBLIC_TAPLY_MAINNET_USDC_CODE_HASH']);
      return amount >= BigInt(min) ? { ...pending, state: 'verified', amount: amount.toString() } : pending;
    } catch { return pending; }
  };
}
