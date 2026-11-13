import { ONE_CLICK_MANAGER_PUB_KEY, verifyQuoteSignatureSdk } from './sdk';
import type { OneClickQuoteResponse } from './sdk';
import { z } from 'zod';
import { ECHOED_FIELDS } from './quote-request';
import type { TaplyQuoteRequest } from './quote-request';

/**
 * Acceptance of a 1Click quote response (docs/MAINNET_BRIEF.md §7.4).
 *
 * A response is used only if ALL hold:
 *  1. it has the expected shape;
 *  2. the official SDK's `verifyQuoteSignature` accepts it under the 1Click
 *     manager key (production) — the signature covers request + quote fields;
 *  3. every field Taply sent is echoed back unchanged (recipient, destination
 *     asset, amount, message, swap type, recipient type, refund, deadline, ...);
 *  4. `amountOut` equals the request principal exactly and `minAmountOut` is not
 *     below it (a short delivery would land in the unclaimed bucket);
 *  5. the response is fresh, its deadline is in the future and before the
 *     request expires with margin;
 *  6. a funded quote carries a deposit address distinct from the refund
 *     address; a dry quote carries none.
 */

export const MANAGER_PUBLIC_KEY = ONE_CLICK_MANAGER_PUB_KEY;

const U = z.string().regex(/^(0|[1-9][0-9]{0,38})$/);
export const QuoteResponseSchema = z.object({
  correlationId: z.string().min(1).max(128),
  timestamp: z.string().min(1).max(64),
  signature: z.string().min(1).max(256),
  quoteRequest: z.object({}).passthrough(),
  quote: z
    .object({
      amountIn: U,
      amountInFormatted: z.string().max(64),
      amountInUsd: z.string().max(64).optional(),
      minAmountIn: U,
      amountOut: U,
      amountOutFormatted: z.string().max(64),
      minAmountOut: U,
      depositAddress: z.string().min(1).max(128).optional(),
      depositMemo: z.string().max(128).optional(),
      deadline: z.string().max(64).optional(),
      timeEstimate: z.number().nonnegative().max(86_400).optional(),
    })
    .passthrough(),
});

export type QuoteRejection =
  | 'MALFORMED'
  | 'SIGNATURE_INVALID'
  | 'ECHO_MISMATCH'
  | 'AMOUNT_MISMATCH'
  | 'MIN_OUTPUT_BELOW_PRINCIPAL'
  | 'STALE'
  | 'DEADLINE_INVALID'
  | 'DEPOSIT_ADDRESS_INVALID';

export interface AcceptedQuote {
  readonly response: OneClickQuoteResponse;
  readonly correlationId: string;
  readonly amountIn: string;
  readonly amountInFormatted: string;
  readonly minAmountIn: string;
  readonly amountOut: string;
  readonly deadlineMs: number;
  readonly timeEstimateSec: number | null;
  readonly depositAddress: string | null;
  readonly depositMemo: string | null;
}

export const MAX_RESPONSE_AGE_MS = 120_000;
/** The quote deadline must leave at least this much time before the request expires. */
export const EXPIRY_MARGIN_MS = 5 * 60_000;

function sameField(field: keyof TaplyQuoteRequest, sent: unknown, echoed: unknown): boolean {
  if (field === 'deadline') {
    // 1Click may normalise ISO formatting; the instant must be identical.
    return typeof echoed === 'string' && Date.parse(echoed) === Date.parse(String(sent));
  }
  return echoed === sent;
}

export function verifyQuoteResponse(
  raw: unknown,
  sent: TaplyQuoteRequest,
  context: { readonly nowMs: number; readonly requestExpiresAtMs: number; readonly managerPublicKey: string },
): { readonly ok: true; readonly quote: AcceptedQuote } | { readonly ok: false; readonly code: QuoteRejection } {
  const parsed = QuoteResponseSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: 'MALFORMED' };
  const response = raw as OneClickQuoteResponse;

  if (!verifyQuoteSignatureSdk(response, context.managerPublicKey)) return { ok: false, code: 'SIGNATURE_INVALID' };

  const echoed = parsed.data.quoteRequest as Record<string, unknown>;
  for (const field of ECHOED_FIELDS) {
    if (!sameField(field, sent[field], echoed[field])) return { ok: false, code: 'ECHO_MISMATCH' };
  }
  const q = parsed.data.quote;
  if (q.amountOut !== sent.amount) return { ok: false, code: 'AMOUNT_MISMATCH' };
  if (BigInt(q.minAmountOut) < BigInt(sent.amount)) return { ok: false, code: 'MIN_OUTPUT_BELOW_PRINCIPAL' };

  const stampedAt = Date.parse(parsed.data.timestamp);
  if (!Number.isFinite(stampedAt) || Math.abs(context.nowMs - stampedAt) > MAX_RESPONSE_AGE_MS) return { ok: false, code: 'STALE' };

  // Funded quotes carry their own deposit deadline; dry quotes only echo ours.
  const deadlineMs = Date.parse(q.deadline ?? sent.deadline);
  if (!Number.isFinite(deadlineMs) || deadlineMs <= context.nowMs || deadlineMs > context.requestExpiresAtMs - EXPIRY_MARGIN_MS) {
    return { ok: false, code: 'DEADLINE_INVALID' };
  }

  const deposit = q.depositAddress ?? null;
  if (sent.dry ? deposit !== null : deposit === null || deposit.toLowerCase() === sent.refundTo.toLowerCase()) {
    return { ok: false, code: 'DEPOSIT_ADDRESS_INVALID' };
  }

  return {
    ok: true,
    quote: {
      response,
      correlationId: parsed.data.correlationId,
      amountIn: q.amountIn,
      amountInFormatted: q.amountInFormatted,
      minAmountIn: q.minAmountIn,
      amountOut: q.amountOut,
      deadlineMs,
      timeEstimateSec: q.timeEstimate ?? null,
      depositAddress: deposit,
      depositMemo: q.depositMemo ?? null,
    },
  };
}
