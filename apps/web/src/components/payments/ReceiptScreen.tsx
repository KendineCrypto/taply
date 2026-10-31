'use client';

import { useEffect, useState } from 'react';
import type { ReadResult, TerminalFactsRead } from '@taply/near-client';
import { AccountId } from '@/components/primitives/Amount';
import { Spinner } from '@/components/primitives/Button';
import { Card, DetailRow } from '@/components/primitives/Surface';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { useT } from '@/lib/i18n/provider';
import { usePayments } from '@/lib/payments/context';
import { HashHexSchema } from '@/lib/protocol';
import { BackToPayment, ChainTime, PaymentsSetupNotice, Provenance, RequestTerms, TransactionLink } from './PaymentParts';

/**
 * `/receipt/[id]` (UX_FLOWS screen 17), Phase 2C scope.
 *
 * Shows the contract's own terminal facts (`get_receipt`), read at a finalized
 * block of the approved code. They are labelled for what they are -
 * CONTRACT_FACTS_NOT_FINALITY_PROOF - and never rendered as a Verified Paid
 * receipt: that needs a verifier of the funding, transfer and callback receipts,
 * which does not exist yet (freeze section 8, API.md "VerifiedReceipt").
 */
export function ReceiptScreen({ id }: { readonly id: string }) {
  const t = useT();
  const { setup, journal } = usePayments();
  const [read, setRead] = useState<ReadResult<TerminalFactsRead> | null>(null);
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
  const facts = observation.data?.facts ?? null;
  if (error !== null || observation.data === null) {
    return (
      <div className="flex flex-col gap-4">
        <InlineNotice copy={error?.code === 'CONTRACT_CODE_MISMATCH' ? t.payment.setup.codeMismatch : t.payment.status.readFailed} />
        <BackToPayment id={id} />
      </div>
    );
  }
  if (facts === null || facts.request.terms.contractId !== setup.contractId) {
    return (
      <div className="flex flex-col gap-4">
        <InlineNotice copy={t.payment.receipt.notTerminal} tone="neutral" />
        <BackToPayment id={id} />
      </div>
    );
  }

  const { request } = facts;
  const paid = request.status === 'FINAL_PAID';
  const hashes = journal?.isReadable() ? journal.forRequest(id).filter((e) => e.transactionHash !== null) : [];

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-2">
        <p className="font-semibold">{paid ? t.payment.contractPaid.label : t.status.CANCELLED_UNFUNDED.label}</p>
        <p className="text-sm text-[var(--text-secondary)]">
          {paid ? t.payment.receipt.payoutConfirmedByContract : t.payment.receipt.cancelledNothingPaid}
        </p>
      </Card>
      <InlineNotice copy={{ title: t.payment.receipt.factsTitle, body: t.payment.receipt.factsNote }} tone="neutral" />
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
              #{request.latestOperation.nonce} · {request.latestOperation.status}
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
      {paid && <p className="px-1 text-xs text-[var(--text-muted)]">{t.payment.settlementProofPending}</p>}
      {hashes.map((entry) => (
        <TransactionLink key={entry.method} explorerBaseUrl={setup.explorerBaseUrl} hash={entry.transactionHash!} />
      ))}
      <Provenance block={observation.observedBlock} checkedAt={observation.checkedAt} />
      <BackToPayment id={id} />
    </div>
  );
}
