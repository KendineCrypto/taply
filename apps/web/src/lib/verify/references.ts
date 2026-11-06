import type { ContractRequest } from '@/lib/protocol';
import type { JournalEntry } from '@/lib/payments/journal';
import type { TxRef } from './instant-receipt';

/**
 * Where the verifier's transaction hashes come from.
 *
 * The contract cannot record its own transaction hashes, so the receipt page
 * needs them from somewhere:
 *   1. this device's submission journal (the payer's funding hash, the
 *      recipient's retry hash), or
 *   2. a verification link (`?ftx=<funding>&rtx=<retry>[,<retry>...]`) shared by
 *      whoever has them.
 *
 * Neither source is trusted. A hash only tells the verifier WHERE to look; the
 * verifier checks the transaction itself against the chain, so a wrong or
 * forged hash can only produce "not verified", never "verified".
 *
 * Signers are taken from the contract state (payer for funding, recipient for
 * retries), not from the link.
 */

const TX_HASH = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_RETRY_REFERENCES = 8;

export interface ReceiptReferences {
  readonly funding: TxRef | null;
  readonly retries: ReadonlyArray<TxRef>;
  /** Number of retry references the contract's nonce says are needed. */
  readonly retriesNeeded: number;
  /** True when every reference needed to run the verifier is present. */
  readonly complete: boolean;
}

export interface LinkHints {
  readonly funding: string | null;
  readonly retries: ReadonlyArray<string>;
}

export function parseLinkHints(search: string): LinkHints {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return { funding: null, retries: [] };
  }
  const ftx = params.get('ftx');
  const rtx = params.get('rtx');
  const funding = ftx !== null && TX_HASH.test(ftx) ? ftx : null;
  const retries =
    rtx === null
      ? []
      : rtx
          .split(',')
          .slice(0, MAX_RETRY_REFERENCES + 1)
          .filter((h) => TX_HASH.test(h));
  // A link with any malformed retry hash is ignored as a whole rather than reordered.
  if (rtx !== null && retries.length !== rtx.split(',').length) return { funding, retries: [] };
  return { funding, retries };
}

export function collectReferences(
  request: ContractRequest,
  journal: ReadonlyArray<JournalEntry>,
  hints: LinkHints,
): ReceiptReferences {
  const op = request.latestOperation;
  const payer = request.payerAccountId;
  const nonce = op === null ? 0n : BigInt(op.nonce);
  // Capped: beyond this a device cannot hold every hash anyway, and the verifier refuses gaps.
  const retriesNeeded = nonce <= 1n ? 0 : nonce - 1n > 8n ? 9 : Number.parseInt((nonce - 1n).toString(), 10);
  if (payer === null || op === null) return { funding: null, retries: [], retriesNeeded, complete: false };

  const mine = journal.filter((e) => e.requestId === request.terms.id && e.transactionHash !== null);
  const journalFunding = mine.find((e) => e.method === 'pay_instant_native' && e.signerAccountId === payer);
  const fundingHash = journalFunding?.transactionHash ?? hints.funding;
  const funding = fundingHash === null ? null : { hash: fundingHash, signerAccountId: payer };

  // The journal keeps the latest retry per signer: enough for the common single-retry case.
  const journalRetry = mine.find(
    (e) =>
      e.method === 'retry_native_transfer' &&
      e.signerAccountId === request.recipientAccountId &&
      e.operationNonce === (nonce - 1n).toString(),
  );
  let retryHashes: ReadonlyArray<string> = hints.retries;
  if (hints.retries.length !== retriesNeeded && journalRetry?.transactionHash && retriesNeeded === 1) {
    retryHashes = [journalRetry.transactionHash];
  }
  const retries = retryHashes
    .slice(0, retriesNeeded)
    .map((hash) => ({ hash, signerAccountId: request.recipientAccountId }));

  return {
    funding,
    retries,
    retriesNeeded,
    complete: funding !== null && retries.length === retriesNeeded,
  };
}

/** A shareable link carrying only public transaction hashes, never account data. */
export function verificationLink(
  origin: string,
  requestId: string,
  refs: { funding: TxRef; retries: ReadonlyArray<TxRef> },
): string {
  const url = new URL(`/receipt/${requestId}`, origin);
  url.searchParams.set('ftx', refs.funding.hash);
  if (refs.retries.length > 0) url.searchParams.set('rtx', refs.retries.map((r) => r.hash).join(','));
  return url.toString();
}
