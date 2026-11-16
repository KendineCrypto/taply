import { createHash } from 'node:crypto';
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
import type { Attempt, QuoteRecord, QuoteStore, ReleaseReason } from './store';
import { MAX_ATTEMPTS, RELEASE_GRACE_MS } from './store';
import { EXPIRY_MARGIN_MS, verifyQuoteResponse } from './verify';
import type { QuoteRejection } from './verify';

/**
 * Server-side 1Click orchestration (docs/MAINNET_BRIEF.md §7).
 *
 * Modes:
 *  - off     — every call answers ONECLICK_DISABLED (default).
 *  - fixture — FIXTURE chain + synthetic signed responses; dry quotes only.
 *  - dry     — real chain reads + real 1Click DRY quotes (no deposit address).
 *  - funded  — refused in code until ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED;
 *              then real quotes with a deposit address, Base USDC only.
 *
 * A deposit address is returned only to the attempt's owner (the browser that
 * holds the attempt secret), never while funding is not approved, and never in
 * the public request-level status. The browser never receives the API key, the
 * raw upstream error or 1Click's own explorer URLs.
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
  | 'PAYMENT_IN_PROGRESS'
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
  PAYMENT_IN_PROGRESS: 409,
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

/** What the attempt's owner receives. A deposit address only for an approved funded quote. */
export interface PublicQuote {
  readonly mode: 'fixture' | 'dry' | 'funded';
  readonly fundingEnabled: boolean;
  readonly requestId: string;
  readonly attemptId: string;
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
  /** Owner only. `memo` must be included with the deposit whenever it is not null. */
  readonly deposit: { readonly address: string; readonly memo: string | null } | null;
  readonly depositWithheldReason: 'FUNDING_NOT_APPROVED' | 'DRY_QUOTE' | null;
  readonly signatureVerified: true;
  readonly reused: boolean;
  /** Set when Taply stopped tracking this attempt as payable (1Click refunded/failed it, or it expired unpaid). */
  readonly released: ReleaseReason | null;
}

export interface PublicStatus {
  readonly mode: 'fixture' | 'dry' | 'funded';
  readonly requestId: string;
  /** A hint about the cross-chain leg only. Never evidence that the merchant was paid. */
  readonly hint: OneClickStatus | null;
  readonly hintReason: 'NONE' | 'DRY_QUOTE_NO_DEPOSIT';
  readonly updatedAt: string | null;
  /** Owner view only; '' in the public request-level status. */
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

/** 32 random bytes, base64url without padding, generated and kept by the payer's browser. */
export const AttemptSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const QuoteInputSchema = z.strictObject({
  requestId: HashHexSchema,
  originAsset: z.string().min(1).max(160),
  refundTo: z.string().min(1).max(128),
  attemptSecret: AttemptSecretSchema,
});
const ResumeInputSchema = z.strictObject({ requestId: HashHexSchema, attemptSecret: AttemptSecretSchema });

/** SHA-256 of the domain-separated secret. Synchronous, so concurrent calls keep their arrival order. */
export function ownerHashOf(secret: string): string {
  return createHash('sha256').update(`taply.1click.attempt.v1:${secret}`).digest('hex');
}

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
  /** Per-request budgets: 'quote' (creating/resuming attempts) and 'status' (progress polling from both phones). */
  readonly rateLimit?: (requestId: string, kind?: 'quote' | 'status') => Promise<boolean>;
}

function publicQuote(attempt: Attempt, contractId: string, reused: boolean, fundingApproved: boolean): PublicQuote {
  const record = attempt.record!;
  const deposit = record.mode === 'funded' && fundingApproved && record.depositAddress !== null
    ? { address: record.depositAddress, memo: record.depositMemo }
    : null;
  return {
    mode: record.mode,
    fundingEnabled: deposit !== null,
    requestId: record.requestId,
    attemptId: attempt.id,
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
    deposit,
    depositWithheldReason: deposit !== null ? null : record.mode === 'funded' ? 'FUNDING_NOT_APPROVED' : 'DRY_QUOTE',
    signatureVerified: true,
    reused,
    released: attempt.released?.reason ?? null,
  };
}

/** The attempt a progress display should follow: the newest one with a signed record. */
function latestReady(attempts: ReadonlyArray<Attempt>): Attempt | null {
  for (let i = attempts.length - 1; i >= 0; i--) if (attempts[i]!.state === 'READY' && attempts[i]!.record !== null) return attempts[i]!;
  return null;
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

/** Longer than the 15 s upstream timeout plus durable writes; older unfinished attempts are uncertain. */
const IN_PROGRESS_MS = 60_000;

const fail = (code: ServiceError, reason?: QuoteRejection): Result<never> =>
  reason === undefined ? { ok: false, code } : { ok: false, code, reason };

export function createOneClickService(deps: ServiceDeps) {
  const fundingApproved = deps.mode === 'funded' && ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED;
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
    // Real money only on the verified route (Base USDC). Other origins stay quote-only.
    if (deps.mode !== 'funded') for (const o of resolveDynamicOrigins(tokens)) out.push(publicOrigin(o, source));
    return { ok: true, value: out };
  }

  /** Whether 1Click may still deliver from this attempt's deposit address. Null = it may. */
  async function releasable(attempt: Attempt, nowMs: number): Promise<ReleaseReason | null> {
    const record = attempt.record;
    if (record === null || record.depositAddress === null || nowMs <= record.deadlineMs) return null;
    const parsed = StatusSchema.parse(await deps.client.status(record.depositAddress, record.depositMemo));
    const echoedDeposit = parsed.quoteResponse?.quote.depositAddress;
    const echoedCorrelation = parsed.quoteResponse?.correlationId ?? parsed.correlationId;
    if (echoedDeposit !== record.depositAddress || echoedCorrelation !== record.correlationId) return null;
    if (parsed.status === 'REFUNDED') return 'UPSTREAM_REFUNDED';
    if (parsed.status === 'FAILED') return 'UPSTREAM_FAILED';
    if (parsed.status === 'PENDING_DEPOSIT' && nowMs > record.deadlineMs + RELEASE_GRACE_MS) return 'EXPIRED_NO_DEPOSIT';
    return null;
  }

  async function prepareQuote(raw: unknown): Promise<Result<PublicQuote>> {
    const closed = gate();
    if (closed) return closed;
    const chain = deps.chain!;
    const store = deps.store!;

    const input = QuoteInputSchema.safeParse(raw);
    if (!input.success) return fail('INVALID_INPUT');
    // Base: static allowlist. Solana/Tron: asset ID resolved from 1Click's token
    // list (fixture list in a fixture Preview), exact unique match only, and
    // never for funded quotes until that route has its own verified evidence.
    let origin: OriginAsset | null = originAssetById(input.data.originAsset);
    if (origin === null && deps.mode !== 'funded') {
      const tokens = await listedTokens().catch(() => null);
      origin = tokens === null ? null : originFromTokens(input.data.originAsset, tokens);
    }
    if (origin === null || (deps.mode === 'funded' && origin.assetId !== BASE_USDC.assetId)) return fail('ORIGIN_NOT_ALLOWED');
    const refund = validateRefundAddress(origin, input.data.refundTo);
    if (!refund.ok) return fail('REFUND_ADDRESS_INVALID');
    const requestId = input.data.requestId;
    const ownerHash = ownerHashOf(input.data.attemptSecret);

    try {
      if (deps.rateLimit && !await deps.rateLimit(requestId, 'quote')) return fail('RATE_LIMITED');
      // The owner of a still-payable attempt always gets the same attempt back: no second deposit address.
      const mine = (await store.attempts(requestId)).filter(a => a.ownerHash === ownerHash && a.released === null && a.state === 'READY' && a.record !== null)
        .filter(a => a.record!.depositAddress !== null || a.record!.deadlineMs > deps.now()).at(-1);
      if (mine) return { ok: true, value: publicQuote(mine, chain.contractId, true, fundingApproved) };

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

      // 3. In dry/funded mode the asset must still be listed by 1Click, identically.
      if (deps.mode !== 'fixture') {
        try {
          const tokens = TokenListSchema.parse(await deps.client.tokens()) as ReadonlyArray<ListedToken>;
          if (!isStillListed(origin, tokens)) return fail('ORIGIN_NOT_LISTED');
        } catch (error) {
          return error instanceof OneClickHttpError ? fail(`UPSTREAM_${error.code}`) : fail('ORIGIN_NOT_LISTED');
        }
      }

      // 4. Reserve durably. At most one payable deposit address per request.
      const dry = deps.mode !== 'funded';
      const deadlineMs = Math.min(nowMs + LIMITS.quoteTtlMs, latestUsable);
      const sent = buildQuoteRequest({
        dry,
        origin,
        refundTo: refund.address,
        contractId: chain.contractId,
        requestId,
        termsHash: request.termsHash,
        amountBaseUnits: t.amountBaseUnits,
        deadlineMs,
      });
      const reservation = {
        id: crypto.randomUUID(), requestId, ownerHash, deadlineMs,
        mode: deps.mode === 'fixture' ? 'fixture' as const : dry ? 'dry' as const : 'funded' as const,
        payload: JSON.stringify(sent), createdAtMs: nowMs,
      };
      let reserved;
      try {
        reserved = await store.reserve(reservation, nowMs);
        if (reserved.kind === 'ACTIVE' && reserved.attempt.record !== null && reserved.attempt.record.depositAddress === null) {
          // A live dry/fixture quote has no deposit address, so it is not owned: identical inputs reuse it.
          const live = reserved.attempt.record;
          return live.refundTo === refund.address && live.originAssetId === origin.assetId
            ? { ok: true, value: publicQuote(reserved.attempt, chain.contractId, true, fundingApproved) }
            : fail('ACTIVE_QUOTE_EXISTS');
        }
        if (reserved.kind === 'ACTIVE') {
          // Another owner's payable attempt. Released only when 1Click says it can no longer deliver.
          const reason = await releasable(reserved.attempt, nowMs).catch(() => null);
          if (reason === null) return fail('PAYMENT_IN_PROGRESS');
          if (!await store.release(reserved.attempt, nowMs, reason)) return fail('BUSY');
          reserved = await store.reserve({ ...reservation, id: crypto.randomUUID() }, nowMs);
        }
      } catch { return fail('ATTEMPT_UNCERTAIN'); }
      if (reserved.kind === 'OWNED') return { ok: true, value: publicQuote(reserved.attempt, chain.contractId, true, fundingApproved) };
      if (reserved.kind === 'ACTIVE') return fail('PAYMENT_IN_PROGRESS');
      if (reserved.kind === 'BUSY') {
        // A fresh in-progress reservation is a concurrent tab; an older one is an unresolved attempt.
        const a = reserved.attempt;
        return fail(a && a.state !== 'UNCERTAIN' && nowMs - a.createdAtMs < IN_PROGRESS_MS ? 'BUSY' : 'ATTEMPT_UNCERTAIN');
      }
      if (reserved.kind !== 'RESERVED') return fail(reserved.kind === 'LIMIT' ? 'QUOTE_LIMIT_REACHED' : 'ATTEMPT_UNCERTAIN');
      const reservedAttempt = reserved.attempt;
      // No external quote call until BOTH durable writes have acknowledged.
      // Lost acknowledgements leave RESERVED/DISPATCHING blocked across restart.
      try {
        if (!await store.transition(reservedAttempt, 'DISPATCHING')) return fail('ATTEMPT_UNCERTAIN');
      } catch { return fail('ATTEMPT_UNCERTAIN'); }
      const dispatch = { ...reservedAttempt, state: 'DISPATCHING' as const };
      const uncertain = async () => { await store.transition(dispatch, 'UNCERTAIN').catch(() => false); };
      let rawQuote: unknown;
      try {
        rawQuote = await deps.client.quote(sent);
      } catch {
        await uncertain();
        return fail('ATTEMPT_UNCERTAIN');
      }
      const checked = verifyQuoteResponse(rawQuote, sent, { nowMs: deps.now(), requestExpiresAtMs: expiresAtMs, managerPublicKey: deps.managerPublicKey });
      if (!checked.ok) { await uncertain(); return fail('QUOTE_REJECTED', checked.code); }
      const q = checked.quote;

      const record: QuoteRecord = {
        requestId,
        correlationId: q.correlationId,
        mode: reservation.mode,
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
      return { ok: true, value: publicQuote({ ...dispatch, state: 'READY', record }, chain.contractId, false, fundingApproved) };
    } catch { return fail('STORE_UNAVAILABLE'); }
  }

  async function statusFor(record: QuoteRecord, owner: boolean): Promise<PublicStatus> {
    const base = {
      mode: record.mode,
      requestId: record.requestId,
      refundTo: owner ? record.refundTo : '',
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

  /** Public, by request id: a redacted progress hint for both phones. Never a deposit or refund address. */
  async function status(raw: unknown): Promise<Result<PublicStatus>> {
    const closed = gate();
    if (closed) return closed;
    const id = HashHexSchema.safeParse(raw);
    if (!id.success) return fail('INVALID_INPUT');
    // Lookup by request id only: the browser cannot point this proxy at an arbitrary deposit address.
    let record: QuoteRecord | null;
    try {
      if (deps.rateLimit && !await deps.rateLimit(id.data, 'status')) return fail('RATE_LIMITED');
      const attempts = await deps.store!.attempts(id.data);
      const ready = latestReady(attempts);
      if (ready === null && attempts.length > 0) return fail('ATTEMPT_UNCERTAIN');
      record = ready?.record ?? null;
    } catch { return fail('STORE_UNAVAILABLE'); }
    if (record === null) {
      if (deps.mode === 'fixture' && deps.fixtureHint) {
        const hint = deps.fixtureHint(id.data);
        return { ok: true, value: { mode: 'fixture', requestId: id.data, hint, hintReason: 'NONE', updatedAt: null, refundTo: '', originTxs: [], nearTxs: [], refundedAmountFormatted: null } };
      }
      return fail('NO_QUOTE');
    }
    try {
      return { ok: true, value: await statusFor(record, false) };
    } catch (error) {
      if (error instanceof OneClickHttpError) return fail(`UPSTREAM_${error.code}`);
      return fail('STATUS_MISMATCH');
    }
  }

  /** Owner only: the payer's own latest attempt (after a refresh, on the same device). */
  async function resume(raw: unknown): Promise<Result<{ readonly quote: PublicQuote; readonly status: PublicStatus | null }>> {
    const closed = gate();
    if (closed) return closed;
    const input = ResumeInputSchema.safeParse(raw);
    if (!input.success) return fail('INVALID_INPUT');
    const ownerHash = ownerHashOf(input.data.attemptSecret);
    let attempt: Attempt | null;
    try {
      if (deps.rateLimit && !await deps.rateLimit(input.data.requestId, 'quote')) return fail('RATE_LIMITED');
      attempt = latestReady((await deps.store!.attempts(input.data.requestId)).filter(a => a.ownerHash === ownerHash));
    } catch { return fail('STORE_UNAVAILABLE'); }
    if (attempt === null) return fail('NO_QUOTE');
    const quote = publicQuote(attempt, deps.chain!.contractId, true, fundingApproved);
    try {
      return { ok: true, value: { quote, status: await statusFor(attempt.record!, true) } };
    } catch {
      // The quote is still the owner's; progress is unknown right now, never "nothing happened".
      return { ok: true, value: { quote, status: null } };
    }
  }

  return { prepareQuote, status, origins, resume, fundingEnabled: () => fundingApproved };
}

export { BASE_USDC };
