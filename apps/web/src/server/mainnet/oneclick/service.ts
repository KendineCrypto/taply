import { HashHexSchema, MAINNET_USDC_ASSET } from '@taply/shared';
import { z } from 'zod';
import { BASE_USDC, isStillListed, originAssetById, originFromTokens, resolveDynamicOrigins } from '@/lib/mainnet/oneclick/allowlist';
import type { OriginAsset } from '@/lib/mainnet/oneclick/allowlist';
import type { ListedToken } from '@/lib/mainnet/oneclick/allowlist';
import { validateRefundAddress } from '@/lib/mainnet/oneclick/refund-address';
import { ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED } from '@/lib/mainnet/release-gates';
import { ONECLICK_STATUSES } from '@/lib/mainnet/status';
import type { OneClickStatus } from '@/lib/mainnet/status';
import { baseTxUrl, nearTxUrl } from '@/lib/mainnet/explorer';
import { nsToDate } from '@/lib/format/time';
import type { ChainView } from '../chain';
import { OneClickHttpError } from './client';
import type { OneClickClient, OneClickErrorCode } from './client';
import { buildQuoteRequest } from './quote-request';
import type { QuoteRecord, QuoteStore } from './store';
import { MAX_ATTEMPTS } from './store';
import { EXPIRY_MARGIN_MS, verifyQuoteResponse } from './verify';
import type { QuoteRejection } from './verify';

/**
 * Server-side 1Click orchestration (docs/MAINNET_BRIEF.md §7).
 *
 * Modes:
 *  - off     — every call answers ONECLICK_DISABLED (default).
 *  - fixture — FIXTURE chain + synthetic signed responses; dry quotes only.
 *  - dry     — real chain reads + real 1Click DRY quotes (no deposit address).
 *  - funded  — refused in code until ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED.
 *
 * The browser never receives a deposit address while funding is not approved,
 * and never receives the API key, the raw upstream error or 1Click's own
 * explorer URLs.
 */
export type OneClickMode = 'off' | 'fixture' | 'dry' | 'funded';

export function parseOneClickMode(value: string | undefined): OneClickMode {
  return value === 'fixture' || value === 'dry' || value === 'funded' ? value : 'off';
}

export type ServiceError =
  | 'ONECLICK_DISABLED'
  | 'FUNDED_QUOTES_NOT_APPROVED'
  | 'CONTRACT_NOT_CONFIGURED'
  | 'STORE_UNAVAILABLE'
  | 'ATTEMPT_UNCERTAIN'
  | 'RATE_LIMITED'
  | 'INVALID_INPUT'
  | 'ORIGIN_NOT_ALLOWED'
  | 'REFUND_ADDRESS_INVALID'
  | 'CONTRACT_CONFIG_REJECTED'
  | 'CHAIN_UNAVAILABLE'
  | 'REQUEST_NOT_FOUND'
  | 'REQUEST_NOT_OPEN'
  | 'REQUEST_NOT_USDC'
  | 'REQUEST_NOT_INSTANT'
  | 'REQUEST_PAYER_RESTRICTED'
  | 'REQUEST_EXPIRES_TOO_SOON'
  | 'AMOUNT_BELOW_MINIMUM'
  | 'CONTRACT_NOT_REGISTERED'
  | 'MERCHANT_NOT_REGISTERED'
  | 'ORIGIN_NOT_LISTED'
  | 'ACTIVE_QUOTE_EXISTS'
  | 'PREVIOUS_QUOTE_IN_PROGRESS'
  | 'QUOTE_LIMIT_REACHED'
  | 'BUSY'
  | 'QUOTE_REJECTED'
  | 'NO_QUOTE'
  | 'STATUS_MISMATCH'
  | `UPSTREAM_${OneClickErrorCode}`;

export const HTTP_STATUS: Readonly<Record<string, number>> = {
  ONECLICK_DISABLED: 503,
  FUNDED_QUOTES_NOT_APPROVED: 503,
  CONTRACT_NOT_CONFIGURED: 503,
  STORE_UNAVAILABLE: 503,
  ATTEMPT_UNCERTAIN: 409,
  RATE_LIMITED: 429,
  INVALID_INPUT: 400,
  ORIGIN_NOT_ALLOWED: 400,
  REFUND_ADDRESS_INVALID: 400,
  CONTRACT_CONFIG_REJECTED: 503,
  CHAIN_UNAVAILABLE: 503,
  REQUEST_NOT_FOUND: 404,
  NO_QUOTE: 404,
  QUOTE_LIMIT_REACHED: 429,
  QUOTE_REJECTED: 502,
  STATUS_MISMATCH: 502,
  UPSTREAM_MIN_AMOUNT: 422,
  UPSTREAM_NO_LIQUIDITY: 422,
  UPSTREAM_BAD_REQUEST: 502,
  UPSTREAM_UNAUTHORIZED: 502,
  UPSTREAM_RATE_LIMITED: 503,
  UPSTREAM_UNAVAILABLE: 503,
};
export const httpStatusOf = (code: ServiceError): number => HTTP_STATUS[code] ?? 409;

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: ServiceError; readonly reason?: QuoteRejection };

/** What the browser receives for a prepared quote. No deposit address while funding is not approved. */
export interface PublicQuote {
  readonly mode: 'fixture' | 'dry' | 'funded';
  readonly fundingEnabled: false;
  readonly requestId: string;
  readonly correlationId: string;
  readonly originAssetId: string;
  readonly amountIn: string;
  readonly amountInFormatted: string;
  readonly minAmountIn: string;
  /** Exactly the request principal, verified against the signed quote. */
  readonly amountOut: string;
  readonly deadline: string;
  readonly timeEstimateSec: number | null;
  readonly refundTo: string;
  readonly recipient: string;
  readonly destinationAsset: typeof MAINNET_USDC_ASSET;
  readonly deposit: null;
  readonly depositWithheldReason: 'FUNDING_NOT_APPROVED' | 'DRY_QUOTE';
  readonly signatureVerified: true;
  readonly reused: boolean;
}

export interface PublicStatus {
  readonly mode: 'fixture' | 'dry' | 'funded';
  readonly requestId: string;
  /** A hint about the cross-chain leg only. Never evidence that the merchant was paid. */
  readonly hint: OneClickStatus | null;
  readonly hintReason: 'NONE' | 'DRY_QUOTE_NO_DEPOSIT';
  readonly updatedAt: string | null;
  readonly refundTo: string;
  readonly originTxs: ReadonlyArray<{ readonly hash: string; readonly url: string | null }>;
  readonly nearTxs: ReadonlyArray<{ readonly hash: string; readonly url: string | null }>;
  readonly refundedAmountFormatted: string | null;
}

export const LIMITS = Object.freeze({
  /** 0.50 USDC: 1Click refused 0.10 USDC from Base (brief §3). */
  minPrincipal: 500_000n,
  maxQuotesPerRequest: MAX_ATTEMPTS,
  quoteTtlMs: 20 * 60_000,
  minQuoteWindowMs: 10 * 60_000,
});

const QuoteInputSchema = z.strictObject({
  requestId: HashHexSchema,
  originAsset: z.string().min(1).max(160),
  refundTo: z.string().min(1).max(128),
});

const TokenListSchema = z.array(
  z.object({
    assetId: z.string(),
    blockchain: z.string(),
    symbol: z.string(),
    decimals: z.number(),
    contractAddress: z.string().optional(),
  }).passthrough(),
);

const TxSchema = z.object({ hash: z.string().max(128) }).passthrough();
const StatusSchema = z.object({
  correlationId: z.string().optional(),
  status: z.enum(ONECLICK_STATUSES as unknown as [OneClickStatus, ...OneClickStatus[]]),
  updatedAt: z.string().max(64).optional(),
  quoteResponse: z.object({ correlationId: z.string().optional(), quote: z.object({ depositAddress: z.string().optional() }).passthrough() }).passthrough().optional(),
  swapDetails: z
    .object({
      originChainTxHashes: z.array(TxSchema).max(20).optional(),
      destinationChainTxHashes: z.array(TxSchema).max(20).optional(),
      nearTxHashes: z.array(z.string().max(128)).max(20).optional(),
      refundedAmountFormatted: z.string().max(64).optional(),
    })
    .passthrough()
    .optional(),
});

export interface ServiceDeps {
  readonly mode: OneClickMode;
  readonly chain: ChainView | null;
  readonly client: OneClickClient;
  readonly store: QuoteStore | null;
  readonly managerPublicKey: string;
  readonly now: () => number;
  /** Fixture mode only: the scripted cross-chain hint per request. */
  readonly fixtureHint?: (requestId: string) => OneClickStatus | null;
  /** Fixture mode only: the labelled fixture token list used to resolve Solana/Tron. */
  readonly fixtureTokens?: () => ReadonlyArray<ListedToken>;
  readonly rateLimit?: (requestId: string) => Promise<boolean>;
}

function publicQuote(record: QuoteRecord, contractId: string, reused: boolean): PublicQuote {
  return {
    mode: record.mode,
    fundingEnabled: false,
    requestId: record.requestId,
    correlationId: record.correlationId,
    originAssetId: record.originAssetId,
    amountIn: record.amountIn,
    amountInFormatted: record.amountInFormatted,
    minAmountIn: record.minAmountIn,
    amountOut: record.amountOut,
    deadline: new Date(record.deadlineMs).toISOString(),
    timeEstimateSec: record.timeEstimateSec,
    refundTo: record.refundTo,
    recipient: contractId,
    destinationAsset: MAINNET_USDC_ASSET,
    deposit: null,
    depositWithheldReason: record.mode === 'funded' ? 'FUNDING_NOT_APPROVED' : 'DRY_QUOTE',
    signatureVerified: true,
    reused,
  };
}

export interface PublicOrigin {
  readonly assetId: string;
  readonly chain: OriginAsset['chain'];
  readonly symbol: OriginAsset['symbol'];
  readonly decimals: number;
  readonly contractAddress: string;
  readonly refundAddressFormat: OriginAsset['refundAddressFormat'];
  /** How this route is known: a recorded live signed quote (Base), the live 1Click token list, or FIXTURE data. */
  readonly source: 'recorded-live-quote' | 'live-token-list' | 'fixture';
}
function publicOrigin(o: OriginAsset, source: PublicOrigin['source']): PublicOrigin {
  return { assetId: o.assetId, chain: o.chain, symbol: o.symbol, decimals: o.decimals, contractAddress: o.contractAddress, refundAddressFormat: o.refundAddressFormat, source };
}

const fail = (code: ServiceError, reason?: QuoteRejection): Result<never> =>
  reason === undefined ? { ok: false, code } : { ok: false, code, reason };

export function createOneClickService(deps: ServiceDeps) {
  function gate(): Result<never> | null {
    if (deps.mode === 'off') return fail('ONECLICK_DISABLED');
    if (deps.mode === 'funded' && !ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED) return fail('FUNDED_QUOTES_NOT_APPROVED');
    if (deps.chain === null) return fail('CONTRACT_NOT_CONFIGURED');
    if (deps.store === null) return fail('STORE_UNAVAILABLE');
    return null;
  }

  async function listedTokens(): Promise<ReadonlyArray<ListedToken>> {
    if (deps.mode === 'fixture') return deps.fixtureTokens?.() ?? [];
    return TokenListSchema.parse(await deps.client.tokens()) as ReadonlyArray<ListedToken>;
  }

  /** Origins this deployment can quote right now. Never lists a route 1Click does not list identically. */
  async function origins(): Promise<Result<ReadonlyArray<PublicOrigin>>> {
    if (deps.mode === 'off') return fail('ONECLICK_DISABLED');
    if (deps.mode === 'funded' && !ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED) return fail('FUNDED_QUOTES_NOT_APPROVED');
    let tokens: ReadonlyArray<ListedToken>;
    try {
      tokens = await listedTokens();
    } catch (error) {
      return error instanceof OneClickHttpError ? fail(`UPSTREAM_${error.code}`) : fail('ORIGIN_NOT_LISTED');
    }
    const source: PublicOrigin['source'] = deps.mode === 'fixture' ? 'fixture' : 'live-token-list';
    const out: PublicOrigin[] = [];
    if (deps.mode === 'fixture' || isStillListed(BASE_USDC, tokens)) out.push(publicOrigin(BASE_USDC, deps.mode === 'fixture' ? 'fixture' : 'recorded-live-quote'));
    for (const o of resolveDynamicOrigins(tokens)) out.push(publicOrigin(o, source));
    return { ok: true, value: out };
  }

  async function prepareQuote(raw: unknown): Promise<Result<PublicQuote>> {
    const closed = gate();
    if (closed) return closed;
    const chain = deps.chain!;
    const store = deps.store!;

    const input = QuoteInputSchema.safeParse(raw);
    if (!input.success) return fail('INVALID_INPUT');
    // Base: static allowlist. Solana/Tron: asset ID resolved from 1Click's token
    // list (fixture list in a fixture Preview), exact unique match only.
    let origin: OriginAsset | null = originAssetById(input.data.originAsset);
    if (origin === null) {
      const tokens = await listedTokens().catch(() => null);
      origin = tokens === null ? null : originFromTokens(input.data.originAsset, tokens);
    }
    if (origin === null) return fail('ORIGIN_NOT_ALLOWED');
    const refund = validateRefundAddress(origin, input.data.refundTo);
    if (!refund.ok) return fail('REFUND_ADDRESS_INVALID');
    const requestId = input.data.requestId;

    try {
      if (deps.rateLimit && !await deps.rateLimit(requestId)) return fail('RATE_LIMITED');
      const previousAttempt = await store.current(requestId);
      if (previousAttempt && previousAttempt.state !== 'READY') return fail('ATTEMPT_UNCERTAIN');
      // Expiry or an upstream hint can NEVER release a potentially fundable attempt.
      if (previousAttempt?.mode === 'funded') return fail('PREVIOUS_QUOTE_IN_PROGRESS');
      // 1. Contract and request at a final block.
      let problems: ReadonlyArray<string>;
      let read: Awaited<ReturnType<ChainView['readRequest']>>;
      try {
        problems = await chain.configProblems();
        if (problems.length > 0) return fail('CONTRACT_CONFIG_REJECTED');
        read = await chain.readRequest(requestId);
      } catch {
        return fail('CHAIN_UNAVAILABLE');
      }
      const request = read.request;
      if (request === null) return fail('REQUEST_NOT_FOUND');
      const t = request.terms;
      if (request.status !== 'OPEN') return fail('REQUEST_NOT_OPEN');
      if (t.mode !== 'instant') return fail('REQUEST_NOT_INSTANT');
      if (t.assetId !== MAINNET_USDC_ASSET) return fail('REQUEST_NOT_USDC');
      // A router delivery is paid by intents.near; any other permitted payer would be WRONG_PAYER (unclaimed).
      if (t.permittedPayerAccountId !== null && t.permittedPayerAccountId !== 'intents.near') return fail('REQUEST_PAYER_RESTRICTED');
      if (BigInt(t.amountBaseUnits) < LIMITS.minPrincipal) return fail('AMOUNT_BELOW_MINIMUM');

      const nowMs = deps.now();
      const chainNowMs = nsToDate(read.finalTimestampNs).getTime();
      const expiresAtMs = nsToDate(t.fundingExpiresAtNs).getTime();
      const latestUsable = expiresAtMs - EXPIRY_MARGIN_MS;
      if (latestUsable - Math.max(nowMs, chainNowMs) < LIMITS.minQuoteWindowMs) return fail('REQUEST_EXPIRES_TOO_SOON');

      // 2. Both ends must be registered on USDC, or the delivery/payout cannot complete.
      try {
        if (!(await chain.isUsdcRegistered(chain.contractId))) return fail('CONTRACT_NOT_REGISTERED');
        if (!(await chain.isUsdcRegistered(request.recipientAccountId))) return fail('MERCHANT_NOT_REGISTERED');
      } catch {
        return fail('CHAIN_UNAVAILABLE');
      }

      // 3. One live quote per request; never a second quote while one may be funded.
      const previous = previousAttempt?.record ?? null;
      if (previous !== null) {
        if (previous.deadlineMs > nowMs) {
          return previous.refundTo === refund.address && previous.originAssetId === origin.assetId
            ? { ok: true, value: publicQuote(previous, chain.contractId, true) }
            : fail('ACTIVE_QUOTE_EXISTS');
        }
        if (previous.depositAddress !== null) return fail('PREVIOUS_QUOTE_IN_PROGRESS');
      }

      // 4. In dry/funded mode the asset must still be listed by 1Click, identically.
      if (deps.mode !== 'fixture') {
        try {
          const tokens = TokenListSchema.parse(await deps.client.tokens()) as ReadonlyArray<ListedToken>;
          if (!isStillListed(origin, tokens)) return fail('ORIGIN_NOT_LISTED');
        } catch (error) {
          return error instanceof OneClickHttpError ? fail(`UPSTREAM_${error.code}`) : fail('ORIGIN_NOT_LISTED');
        }
      }

      // 5. Ask 1Click with Taply's fixed body, then accept only a verified response.
      const dry = deps.mode !== 'funded';
      const sent = buildQuoteRequest({
        dry,
        origin,
        refundTo: refund.address,
        contractId: chain.contractId,
        requestId,
        termsHash: request.termsHash,
        amountBaseUnits: t.amountBaseUnits,
        deadlineMs: Math.min(nowMs + LIMITS.quoteTtlMs, latestUsable),
      });
      let reservation;
      try {
        reservation = await store.reserve({ id: crypto.randomUUID(), requestId,
          mode: deps.mode === 'fixture' ? 'fixture' : dry ? 'dry' : 'funded',
          payload: JSON.stringify(sent), createdAtMs: deps.now() }, previousAttempt?.id ?? null);
      } catch { return fail('ATTEMPT_UNCERTAIN'); }
      if (typeof reservation === 'string') return fail(reservation === 'LIMIT' ? 'QUOTE_LIMIT_REACHED' : reservation === 'LEGACY_BLOCKED' ? 'ATTEMPT_UNCERTAIN' : 'BUSY');
      // No external quote call until BOTH durable writes have acknowledged.
      // Lost acknowledgements leave RESERVED/DISPATCHING blocked across restart.
      try {
        if (!await store.transition(reservation, 'DISPATCHING')) return fail('ATTEMPT_UNCERTAIN');
      } catch { return fail('ATTEMPT_UNCERTAIN'); }
      const dispatch = { ...reservation, state: 'DISPATCHING' as const };
      const uncertain = async () => { await store.transition(dispatch, 'UNCERTAIN').catch(() => false); };
      let raw: unknown;
      try {
        raw = await deps.client.quote(sent);
      } catch {
        await uncertain();
        return fail('ATTEMPT_UNCERTAIN');
      }
      const checked = verifyQuoteResponse(raw, sent, { nowMs: deps.now(), requestExpiresAtMs: expiresAtMs, managerPublicKey: deps.managerPublicKey });
      if (!checked.ok) { await uncertain(); return fail('QUOTE_REJECTED', checked.code); }
      const q = checked.quote;

      const record: QuoteRecord = {
        requestId,
        correlationId: q.correlationId,
        mode: deps.mode === 'fixture' ? 'fixture' : deps.mode === 'dry' ? 'dry' : 'funded',
        originAssetId: origin.assetId,
        refundTo: refund.address,
        depositAddress: q.depositAddress,
        depositMemo: q.depositMemo,
        deadlineMs: q.deadlineMs,
        createdAtMs: nowMs,
        amountIn: q.amountIn,
        amountInFormatted: q.amountInFormatted,
        minAmountIn: q.minAmountIn,
        amountOut: q.amountOut,
        timeEstimateSec: q.timeEstimateSec,
        signedResponse: JSON.stringify(q.response),
      };
      try {
        if (!await store.transition(dispatch, 'READY', record)) { await uncertain(); return fail('ATTEMPT_UNCERTAIN'); }
      } catch { await uncertain(); return fail('ATTEMPT_UNCERTAIN'); }
      return { ok: true, value: publicQuote(record, chain.contractId, false) };
    } catch { return fail('STORE_UNAVAILABLE'); }
  }

  async function statusFor(record: QuoteRecord): Promise<PublicStatus> {
    const base = {
      mode: record.mode,
      requestId: record.requestId,
      refundTo: record.refundTo,
    } as const;
    if (record.depositAddress === null) {
      return { ...base, hint: deps.fixtureHint?.(record.requestId) ?? null, hintReason: deps.fixtureHint ? 'NONE' : 'DRY_QUOTE_NO_DEPOSIT', updatedAt: null, originTxs: [], nearTxs: [], refundedAmountFormatted: null };
    }
    const parsed = StatusSchema.parse(await deps.client.status(record.depositAddress, record.depositMemo));
    // The status must describe OUR quote, not another deposit address's.
    const echoedDeposit = parsed.quoteResponse?.quote.depositAddress;
    const echoedCorrelation = parsed.quoteResponse?.correlationId ?? parsed.correlationId;
    if (echoedDeposit !== record.depositAddress || echoedCorrelation !== record.correlationId) {
      throw new Error('STATUS_MISMATCH');
    }
    const s = parsed.swapDetails;
    return {
      ...base,
      hint: parsed.status,
      hintReason: 'NONE',
      updatedAt: parsed.updatedAt ?? null,
      originTxs: (s?.originChainTxHashes ?? []).map((tx) => ({ hash: tx.hash, url: baseTxUrl(tx.hash) })),
      nearTxs: [...(s?.nearTxHashes ?? []), ...(s?.destinationChainTxHashes ?? []).map((tx) => tx.hash)]
        .filter((h, i, all) => all.indexOf(h) === i)
        .map((hash) => ({ hash, url: nearTxUrl(hash) })),
      refundedAmountFormatted: s?.refundedAmountFormatted ?? null,
    };
  }

  async function status(raw: unknown): Promise<Result<PublicStatus>> {
    const closed = gate();
    if (closed) return closed;
    const id = HashHexSchema.safeParse(raw);
    if (!id.success) return fail('INVALID_INPUT');
    // Lookup by request id only: the browser cannot point this proxy at an arbitrary deposit address.
    let record: QuoteRecord | null;
    try {
      if (deps.rateLimit && !await deps.rateLimit(id.data)) return fail('RATE_LIMITED');
      const attempt = await deps.store!.current(id.data);
      if (attempt && attempt.state !== 'READY') return fail('ATTEMPT_UNCERTAIN');
      record = attempt?.record ?? null;
    } catch { return fail('STORE_UNAVAILABLE'); }
    if (record === null) {
      if (deps.mode === 'fixture' && deps.fixtureHint) {
        const hint = deps.fixtureHint(id.data);
        return { ok: true, value: { mode: 'fixture', requestId: id.data, hint, hintReason: 'NONE', updatedAt: null, refundTo: '', originTxs: [], nearTxs: [], refundedAmountFormatted: null } };
      }
      return fail('NO_QUOTE');
    }
    try {
      return { ok: true, value: await statusFor(record) };
    } catch (error) {
      if (error instanceof OneClickHttpError) return fail(`UPSTREAM_${error.code}`);
      return fail('STATUS_MISMATCH');
    }
  }

  return { prepareQuote, status, origins };
}

export { BASE_USDC };
