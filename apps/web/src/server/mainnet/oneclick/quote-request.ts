import { buildInstantRecipientMessage, MAINNET_USDC_ASSET } from '@taply/shared';
import type { OriginAsset } from '@/lib/mainnet/oneclick/allowlist';

/**
 * The exact 1Click quote body (docs/MAINNET_BRIEF.md §7.3, docs/MAINNET.md
 * "Exact message and router delivery"). Every field is fixed by Taply; nothing
 * comes from the browser except the request id, the allowlisted origin asset
 * and the validated refund address.
 */
export interface TaplyQuoteRequest {
  readonly dry: boolean;
  readonly swapType: 'EXACT_OUTPUT';
  readonly slippageTolerance: 100;
  readonly originAsset: string;
  readonly depositType: 'ORIGIN_CHAIN';
  readonly destinationAsset: typeof MAINNET_USDC_ASSET;
  readonly amount: string;
  readonly refundTo: string;
  readonly refundType: 'ORIGIN_CHAIN';
  readonly recipient: string;
  readonly recipientType: 'DESTINATION_CHAIN';
  readonly deadline: string;
  readonly customRecipientMsg: string;
}

export function buildQuoteRequest(input: {
  readonly dry: boolean;
  readonly origin: OriginAsset;
  readonly refundTo: string;
  readonly contractId: string;
  readonly requestId: string;
  readonly termsHash: string;
  readonly amountBaseUnits: string;
  readonly deadlineMs: number;
}): TaplyQuoteRequest {
  return {
    dry: input.dry,
    swapType: 'EXACT_OUTPUT',
    slippageTolerance: 100,
    originAsset: input.origin.assetId,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: MAINNET_USDC_ASSET,
    amount: input.amountBaseUnits,
    refundTo: input.refundTo,
    refundType: 'ORIGIN_CHAIN',
    recipient: input.contractId,
    recipientType: 'DESTINATION_CHAIN',
    deadline: new Date(input.deadlineMs).toISOString(),
    // One shared builder for wallet funding and 1Click, so they cannot drift.
    customRecipientMsg: buildInstantRecipientMessage(input.requestId, input.termsHash),
  };
}

/** Fields that must be echoed back unchanged in `quoteRequest`. */
export const ECHOED_FIELDS: ReadonlyArray<keyof TaplyQuoteRequest> = [
  'dry',
  'swapType',
  'slippageTolerance',
  'originAsset',
  'depositType',
  'destinationAsset',
  'amount',
  'refundTo',
  'refundType',
  'recipient',
  'recipientType',
  'deadline',
  'customRecipientMsg',
];
