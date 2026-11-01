'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ReadResult, TerminalFactsRead } from '@taply/near-client';
import { AccountId } from '@/components/primitives/Amount';
import { Button, Spinner } from '@/components/primitives/Button';
import { DetailRow } from '@/components/primitives/Surface';
import { ReceiptTicket } from '@/components/experience/ReceiptTicket';
import type { ReceiptReference } from '@/components/experience/ReceiptTicket';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { Icon } from '@/components/shell/Icons';
import { useCopy } from '@/lib/hooks/browser';
import { useT } from '@/lib/i18n/provider';
import { usePayments } from '@/lib/payments/context';
import { callerRoleFor } from '@/lib/payments/intent';
import { mapChainState } from '@/lib/payments/map-chain-state';
import { HashHexSchema } from '@/lib/protocol';
import type { ContractRequest, VerifiedReceipt } from '@/lib/protocol';
import { collectReferences, parseLinkHints, verificationLink } from '@/lib/verify/references';
import type { LinkHints } from '@/lib/verify/references';
import { useReceiptVerification } from '@/lib/verify/use-receipt-verification';
import type { VerificationView } from '@/lib/verify/use-receipt-verification';
import { useAccountId } from '@/lib/wallet/provider';
import {
  BackToPayment,
  ChainTime,
  PaymentsSetupNotice,
  Provenance,
  RequestTerms,
} from './PaymentParts';

/**
 * `/receipt/[id]` (UX_FLOWS screen 17).
 *
 * Two layers, never merged:
 *  1. The contract's own terminal facts (`get_receipt`) at a finalized block of
 *     the approved code. Labelled CONTRACT_FACTS_NOT_FINALITY_PROOF.
 *  2. Phase 2D: the independent receipt verifier (lib/verify). Only its
 *     `verified` result can turn on the Verified Paid ribbon, and only through
 *     `mapChainState(..., settlementProof: 'verified_receipt')`.
 *
 * The verifier needs transaction hashes. They come from this device's journal
 * or from a verification link (`?ftx=&rtx=`); either way the chain decides.
 */
export function ReceiptScreen({ id }: { readonly id: string }) {
  const t = useT();
  const { setup, journal } = usePayments();
  const accountId = useAccountId();
  const [read, setRead] = useState<ReadResult<TerminalFactsRead> | null>(null);
  // The server renders without the query string; the client reads it after hydration.
  const search = useSyncExternalStore(
    noSubscription,
    () => window.location.search,
    () => '',
  );
  const hints = useMemo<LinkHints>(() => parseLinkHints(search), [search]);
  const [generation, setGeneration] = useState(0);
  const validId = HashHexSchema.safeParse(id).success;

  useEffect(() => {
    if (!validId || setup.status !== 'ready') return;
    let active = true;
    void setup.reader.readTerminalFacts(id).then((result) => {
      if (active) setRead(result);
    });
    return () => {
      active = false;
    };
  }, [id, validId, setup]);

  const facts = read !== null && read.error === null ? (read.observation.data?.facts ?? null) : null;
  const ready = setup.status === 'ready' ? setup : null;
  const request =
    facts !== null && ready !== null && facts.request.terms.contractId === ready.contractId ? facts.request : null;
  const entries = journal?.isReadable() ? journal.forRequest(id) : [];
  const references = request === null ? null : collectReferences(request, entries, hints);
  const verification = useReceiptVerification({
    rpc: ready?.verifierRpc ?? null,
    contractId: ready?.contractId ?? '',
    approvedCodeHash: ready?.expectedCodeHash ?? '',
    request,
    references,
    generation,
  });

  if (!validId) return <InlineNotice copy={t.payment.status.invalidId} tone="danger" />;
  if (setup.status !== 'ready') return <PaymentsSetupNotice />;
  if (read === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]" role="status">
        <Spinner /> {t.common.loading}
      </p>
    );
  }

  const { observation, error } = read;
  if (error !== null || observation.data === null) {
    return (
      <div className="flex flex-col gap-4">
        <InlineNotice
          copy={error?.code === 'CONTRACT_CODE_MISMATCH' ? t.payment.setup.codeMismatch : t.payment.status.readFailed}
        />
        <BackToPayment id={id} />
      </div>
    );
  }
  if (facts === null || request === null) {
    return (
      <div className="flex flex-col gap-4">
        <InlineNotice copy={t.payment.receipt.notTerminal} tone="neutral" />
        <BackToPayment id={id} />
      </div>
    );
  }

  const paid = request.status === 'FINAL_PAID';
  const verified =
    verification.kind === 'verified' && matches(verification.receipt, request) ? verification.receipt : null;
  const presentation = mapChainState({
    state: request.status,
    observation,
    derived: {
      callerRole: callerRoleFor(request, accountId),
      cancelWindowOpen: null,
      releaseEligible: null,
      retry: { eligible: false, operationNonce: null, kind: null },
    },
    fundingEligibility: 'NOT_OPEN',
    incident: null,
    settlementProof: verified !== null ? 'verified_receipt' : 'contract_state_only',
  });
  const hashes = entries.flatMap((e) =>
    e.transactionHash === null ? [] : [{ method: e.method, hash: e.transactionHash }],
  );

  const showVerified = presentation.verifiedRibbon && verified !== null;
  const status = showVerified ? 'verified' : paid ? 'contract_paid' : 'cancelled';
  const v = t.payment.verification;
  const ticketReferences: ReceiptReference[] =
    showVerified && verified !== null
      ? [
          { label: v.fundingTx, value: verified.fundingTransaction.hash, transaction: true },
          ...(verified.settlementTransaction.hash !== verified.fundingTransaction.hash
            ? [{ label: v.settlementTx, value: verified.settlementTransaction.hash, transaction: true }]
            : []),
          { label: v.transferReceipt, value: verified.transferReceipt.receiptId },
          { label: v.callbackReceipt, value: verified.callbackReceipt.receiptId },
          { label: v.stateBlock, value: `#${verified.contractStateBlock.height}` },
        ]
      : hashes.map(({ method, hash }) => ({
          label:
            method === 'pay_instant_native'
              ? v.fundingTx
              : method === 'retry_native_transfer'
                ? v.settlementTx
                : t.payment.signing.viewTransaction,
          value: hash,
          transaction: true,
        }));

  return (
    <div className="flex flex-col gap-4">
      <div data-testid={showVerified ? 'verified-evidence' : undefined}>
        <ReceiptTicket
          status={status}
          amountBaseUnits={request.terms.amountBaseUnits}
          recipientAccountId={request.recipientAccountId}
          payerAccountId={request.payerAccountId}
          memo={request.terms.memo}
          settledAtNs={showVerified && verified !== null ? verified.callbackReceipt.block.timestampNs : facts.terminalAtNs}
          references={ticketReferences}
          explorerBaseUrl={setup.explorerBaseUrl}
          {...(showVerified && verified !== null ? { checkedVia: verified.verification.rpcProviderId } : {})}
          actions={showVerified && verified !== null ? <ShareVerification id={id} receipt={verified} /> : undefined}
        />
      </div>
      {showVerified && verified !== null && (
        <p className="px-1 text-sm leading-relaxed text-[var(--text-secondary)]">{v.verifiedNote}</p>
      )}
      {!showVerified && paid && <VerificationNotice view={verification} onRetry={() => setGeneration((g) => g + 1)} />}
      {!showVerified && paid && (
        <p className="px-1 text-xs text-[var(--text-muted)]">{t.payment.settlementProofPending}</p>
      )}

      <details className="surface-card group p-4">
        <summary className="flex min-h-[var(--tap-target)] cursor-pointer list-none items-center justify-between gap-3 font-medium">
          {t.payment.receipt.factsTitle}
          <Icon name="chevron" size={18} className="shrink-0 transition-transform group-open:rotate-90" />
        </summary>
        <div className="mt-2 flex flex-col gap-3">
          <p className="text-sm text-[var(--text-secondary)]">{t.payment.receipt.factsNote}</p>
          <p className="text-sm">
            {paid ? t.payment.receipt.payoutConfirmedByContract : t.payment.receipt.cancelledNothingPaid}
          </p>
          <RequestTerms request={request}>
            {request.payerAccountId !== null && (
              <DetailRow label={t.payment.status.payerLabel}>
                <AccountId accountId={request.payerAccountId} />
              </DetailRow>
            )}
            {request.fundedAtNs !== null && (
              <DetailRow label={t.payment.status.fundedAt}>
                <ChainTime ns={request.fundedAtNs} />
              </DetailRow>
            )}
            {request.latestOperation !== null && (
              <DetailRow label={t.payment.status.operationLabel}>
                <span className="chain-id">
                  #{request.latestOperation.nonce} · {t.payment.status.operationStatus[request.latestOperation.status]}
                </span>
              </DetailRow>
            )}
            <DetailRow label={t.payment.receipt.terminalBlock}>
              <span className="chain-id">#{facts.terminalBlockHeight}</span>
            </DetailRow>
            <DetailRow label={t.payment.receipt.terminalAt}>
              <ChainTime ns={facts.terminalAtNs} />
            </DetailRow>
          </RequestTerms>
        </div>
      </details>
      <Provenance block={observation.observedBlock} checkedAt={observation.checkedAt} />
      <BackToPayment id={id} />
    </div>
  );
}

const noSubscription = () => () => undefined;

/** A receipt from another read must describe exactly the request shown. */
function matches(receipt: VerifiedReceipt, request: ContractRequest): boolean {
  return (
    receipt.requestId === request.terms.id &&
    receipt.termsHash === request.termsHash &&
    receipt.payerAccountId === request.payerAccountId &&
    receipt.recipientAccountId === request.recipientAccountId &&
    receipt.amountBaseUnits === request.terms.amountBaseUnits &&
    receipt.operationNonce === request.latestOperation?.nonce
  );
}

function VerificationNotice({ view, onRetry }: { readonly view: VerificationView; readonly onRetry: () => void }) {
  const t = useT();
  const v = t.payment.verification;
  switch (view.kind) {
    case 'not_applicable':
    case 'verified':
      return null;
    case 'checking':
      return (
        <p className="flex items-center gap-2 px-1 text-sm text-[var(--text-secondary)]" role="status">
          <Spinner /> {v.checking}
        </p>
      );
    case 'unavailable':
      return <InlineNotice copy={v.unavailable} tone="neutral" />;
    case 'missing_reference':
      return <InlineNotice copy={v.missingReference} tone="neutral" />;
    case 'failed': {
      const copy = view.transient
        ? v.failedTransient
        : view.reason === 'HISTORY_UNAVAILABLE'
          ? v.historyUnavailable
          : v.failedMismatch;
      const tone = view.transient || view.reason === 'HISTORY_UNAVAILABLE' ? 'neutral' : 'danger';
      return (
        <div className="flex flex-col gap-2" data-testid="verification-failed">
          <InlineNotice copy={copy} tone={tone} />
          <p className="px-1 text-xs text-[var(--text-muted)]">
            {v.reasonCode}: <span className="chain-id">{view.reason}</span>
          </p>
          <Button variant="secondary" onClick={onRetry}>
            {v.checkAgain}
          </Button>
        </div>
      );
    }
  }
}

function ShareVerification({ id, receipt }: { readonly id: string; readonly receipt: VerifiedReceipt }) {
  const t = useT();
  const { status, copy } = useCopy();
  // Public chain data only (the shared VerifiedReceipt): for pilot evidence and support.
  const evidence = useCopy();
  if (typeof window === 'undefined') return null;
  const retries = receipt.operationNonce === '1' ? [] : [receipt.settlementTransaction];
  // More than one retry: this device cannot list every hash, so it offers no link.
  if (BigInt(receipt.operationNonce) > 2n) return null;
  const link = verificationLink(window.location.origin, id, {
    funding: receipt.fundingTransaction,
    retries,
  });
  return (
    <div className="flex flex-col gap-1">
      <Button variant="secondary" onClick={() => copy(link)}>
        <Icon name="copy" size={16} />
        {status === 'copied' ? t.payment.verification.linkCopied : t.payment.verification.copyLink}
      </Button>
      <p className="px-1 text-xs text-[var(--text-muted)]">{t.payment.verification.linkNote}</p>
      <Button variant="secondary" onClick={() => evidence.copy(JSON.stringify(receipt, null, 2))}>
        {evidence.status === 'copied' ? t.payment.verification.evidenceCopied : t.payment.verification.copyEvidence}
      </Button>
      <span className="sr-only" role="status">
        {status === 'copied' ? t.payment.verification.linkCopied : ''}
      </span>
    </div>
  );
}
