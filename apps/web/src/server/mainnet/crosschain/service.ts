import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ASSETS, address, normalized, type PublicQuote, type SwapInput, type PublicSession, Secret } from '@/lib/mainnet/crosschain/model';
import { QuoteResponseSchema } from '../oneclick/verify';
import { ONE_CLICK_MANAGER_PUB_KEY, verifyQuoteSignatureSdk, type OneClickQuoteResponse } from '../oneclick/sdk';
import type { OneClickClient } from '../oneclick/client';
import type { RedisCommand } from '@/server/handshake/redis';
import type { Proof } from '@/lib/mainnet/crosschain/model';

export const PREFIX = 'taply:mainnet:crosschain:v1:';
export interface Store { get(owner: string): Promise<RecordState | null>; reserve(owner: string, r: RecordState): Promise<boolean>; finish(owner: string, r: RecordState): Promise<void>; archive(owner: string, r: RecordState): Promise<boolean> }
export interface RecordState { state: 'reserving' | 'ready' | 'uncertain'; input: SwapInput; payload: Record<string, unknown>; quote: PublicQuote | null; signedResponse?: unknown }
export function redisStore(redis: RedisCommand): Store {
  const key = (o: string) => PREFIX + o;
  return {
    async get(o) { const r = await redis(['GET', key(o)]); return typeof r === 'string' ? JSON.parse(r) as RecordState : null; },
    async reserve(o, r) { return await redis(['SET', key(o), JSON.stringify(r), 'NX']) === 'OK'; },
    async finish(o, r) { await redis(['SET', key(o), JSON.stringify(r)]); },
    async archive(o, r) {
      return await redis(['EVAL', `local raw=redis.call('GET',KEYS[1]); if raw~=ARGV[1] then return 0 end; redis.call('SET',KEYS[2],raw); redis.call('DEL',KEYS[1]); return 1`, 2, key(o), `${PREFIX}history:${o}:${r.quote?.correlationId}`, JSON.stringify(r)]) === 1;
    },
  };
}
export function ownerId(secret: string) { return createHash('sha256').update(Secret.parse(secret)).digest('hex'); }
export type VerifyDelivery = (chain: SwapInput['to'], recipient: string, minAmount: string, hashes: string[], since: number) => Promise<Proof>;
const List = z.array(z.object({ assetId: z.string(), blockchain: z.string(), symbol: z.string(), decimals: z.number(), contractAddress: z.string().nullable().optional() })).max(5000);
const Status = z.object({ status: z.enum(['PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'PROCESSING', 'SUCCESS', 'INCOMPLETE_DEPOSIT', 'REFUNDED', 'FAILED']), quoteResponse: z.object({ correlationId: z.string(), quote: z.object({ depositAddress: z.string(), depositMemo: z.string().optional() }) }),
  swapDetails: z.object({ destinationChainTxHashes: z.array(z.object({ hash: z.string() })).max(16).optional(), originChainTxHashes: z.array(z.object({ hash: z.string() })).max(16).optional(), refundedAmount: z.string().regex(/^\d+$/).optional() }).optional() });
export function createCrosschainService(deps: { client: OneClickClient; store: Store | null; now: () => number; mode: 'off' | 'dry' | 'funded'; verify: VerifyDelivery; registered: (account: string) => Promise<boolean>; managerKey?: string }) {
  const checkMode = () => { if (deps.mode === 'off') throw new Error('SWAP_UNAVAILABLE'); };
  async function listed(input: SwapInput) {
    const ts = List.parse(await deps.client.tokens());
    for (const chain of [input.from, input.to]) {
      const a = ASSETS[chain]; const matches = ts.filter(t => t.assetId === a.assetId && t.blockchain === chain && t.symbol === a.symbol && t.decimals === a.decimals && (chain === 'base' ? t.contractAddress?.toLowerCase() === a.contract : t.contractAddress === a.contract));
      if (matches.length !== 1) throw new Error('TOKEN_UNAVAILABLE');
    }
    if (input.to === 'near' && !await deps.registered(input.recipient)) throw new Error('REGISTER_USDC');
    if (input.from === 'near' && !await deps.registered(input.refundTo)) throw new Error('REGISTER_USDC');
  }
  function payload(input: SwapInput, dry: boolean): Record<string, unknown> {
    return { dry, swapType: 'EXACT_INPUT', slippageTolerance: input.slippageBps, originAsset: ASSETS[input.from].assetId, destinationAsset: ASSETS[input.to].assetId,
      amount: input.amount, recipient: input.recipient, refundTo: input.refundTo, recipientType: 'DESTINATION_CHAIN', refundType: 'ORIGIN_CHAIN', depositType: 'ORIGIN_CHAIN', deadline: new Date(deps.now() + 15 * 60_000).toISOString() };
  }
  function accepted(raw: unknown, sent: Record<string, unknown>, input: SwapInput): PublicQuote {
    const r = QuoteResponseSchema.parse(raw);
    if (!verifyQuoteSignatureSdk(raw as OneClickQuoteResponse, deps.managerKey ?? ONE_CLICK_MANAGER_PUB_KEY)) throw new Error('QUOTE_INVALID');
    for (const [k,v] of Object.entries(sent)) {
      if (k === 'deadline' ? Date.parse(String(r.quoteRequest[k])) !== Date.parse(String(v)) : r.quoteRequest[k] !== v) throw new Error('QUOTE_INVALID');
    }
    const now = deps.now(); const deadline = Date.parse(r.quote.deadline ?? String(sent['deadline']));
    if (!Number.isFinite(deadline) || deadline <= now + 30_000 || deadline > Date.parse(String(sent['deadline'])) || Math.abs(Date.parse(r.timestamp) - now) > 120_000 || !Number.isFinite(Date.parse(r.timestamp))) throw new Error('QUOTE_EXPIRED');
    if (r.quote.amountIn !== input.amount || BigInt(r.quote.amountOut) === 0n || BigInt(r.quote.minAmountOut) === 0n || BigInt(r.quote.minAmountOut) > BigInt(r.quote.amountOut) || BigInt(r.quote.minAmountOut) < BigInt(r.quote.amountOut) * BigInt(10_000 - input.slippageBps) / 10_000n) throw new Error('QUOTE_INVALID');
    const funded = sent['dry'] === false;
    const deposit = funded ? r.quote.depositAddress ?? null : null;
    if (funded && (!deposit || !address(input.from, deposit) || deposit.toLowerCase() === input.refundTo.toLowerCase())) throw new Error('QUOTE_INVALID');
    if (!funded && r.quote.depositAddress) throw new Error('QUOTE_INVALID');
    return { input, correlationId: r.correlationId, amountIn: r.quote.amountIn, amountOut: r.quote.amountOut, minAmountOut: r.quote.minAmountOut, deadline: new Date(deadline).toISOString(), createdAt: now, estimate: r.quote.timeEstimate ?? null, deposit, memo: r.quote.depositMemo ?? null, funded };
  }
  async function quote(raw: unknown, secret: string, fund: boolean, approvedMinimum?: string) {
    checkMode(); const owner = ownerId(secret); const input = normalized(raw);
    if (fund && deps.mode !== 'funded') throw new Error('FUNDING_DISABLED');
    if (fund && (!approvedMinimum || !/^\d{1,39}$/.test(approvedMinimum) || BigInt(approvedMinimum) === 0n)) throw new Error('REVIEW_REQUIRED');
    if (fund) {
      if (!deps.store) throw new Error('STORE_UNAVAILABLE');
      const existing = await deps.store.get(owner);
      if (existing) throw new Error('ATTEMPT_EXISTS');
    }
    await listed(input);
    const sent = payload(input, !fund);
    let record: RecordState = { state: 'reserving', input, payload: sent, quote: null };
    if (fund && !await deps.store!.reserve(owner, record)) throw new Error('ATTEMPT_EXISTS');
    try {
      const response = await deps.client.quote(sent);
      const q = accepted(response, sent, input);
      if (fund && BigInt(q.minAmountOut) < BigInt(approvedMinimum!)) throw new Error('PRICE_CHANGED');
      record = { ...record, state: 'ready', quote: q, signedResponse: response };
      if (fund) await deps.store!.finish(owner, record);
      return q;
    } catch (e) {
      if (fund) await deps.store!.finish(owner, { ...record, state: 'uncertain' });
      throw e;
    }
  }
  async function session(secret: string): Promise<PublicSession | null> {
    checkMode(); if (!deps.store) throw new Error('STORE_UNAVAILABLE');
    const record = await deps.store.get(ownerId(secret));
    if (!record) return null;
    const base: PublicSession = { state: record.state, quote: record.quote, upstream: null, proof: null, refundProof: null };
    if (record.state !== 'ready' || !record.quote?.deposit) return base;
    const q = record.quote;
    const raw = Status.parse(await deps.client.status(q.deposit!, q.memo));
    if (raw.quoteResponse.correlationId !== q.correlationId || raw.quoteResponse.quote.depositAddress !== q.deposit || (raw.quoteResponse.quote.depositMemo ?? null) !== q.memo) throw new Error('STATUS_MISMATCH');
    const detail = raw.swapDetails;
    const proof = raw.status === 'SUCCESS' ? await deps.verify(q.input.to, q.input.recipient, q.minAmountOut, detail?.destinationChainTxHashes?.map(x => x.hash) ?? [], q.createdAt) : null;
    // REFUNDED is an upstream claim until all input is proved returned. Fee-deducted/partial refunds stay unresolved.
    const refundProof = raw.status === 'REFUNDED' ? await deps.verify(q.input.from, q.input.refundTo, q.amountIn, detail?.originChainTxHashes?.map(x => x.hash) ?? [], q.createdAt) : null;
    return { ...base, upstream: raw.status, proof, refundProof };
  }
  async function archive(secret: string) {
    const owner = ownerId(secret); if (!deps.store) throw new Error('STORE_UNAVAILABLE');
    const record = await deps.store.get(owner); if (!record) return;
    const result = await session(secret);
    if (result?.proof?.state !== 'verified' && result?.refundProof?.state !== 'verified') throw new Error('ATTEMPT_EXISTS');
    if (!await deps.store.archive(owner, record)) throw new Error('ATTEMPT_EXISTS');
  }
  return { quote, session, archive };
}
