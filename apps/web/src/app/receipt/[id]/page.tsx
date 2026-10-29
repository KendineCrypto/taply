'use client';

import { useParams } from 'next/navigation';
import { Card, DetailRow, ScreenHeader } from '@/components/primitives/Surface';
import { ErrorState } from '@/components/feedback/ErrorState';
import { RouteScaffold } from '@/components/shell/RouteScaffold';
import { useT } from '@/lib/i18n/provider';

/**
 * Verified receipt (UX_FLOWS screen 17).
 *
 * A receipt exists only for a terminal, verified state. Anything else renders
 * RECEIPT_NOT_FINAL - which is what Phase 0 always shows, because no payment
 * has been settled.
 */
export default function ReceiptPage() {
  const t = useT();
  const params = useParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';

  return (
    <>
      <ScreenHeader title={t.screens.receipt} />

      <div className="mb-4">
        <ErrorState code="RECEIPT_NOT_FINAL" />
      </div>

      <Card>
        <dl>
          <DetailRow label="Request ID">
            <span className="chain-id">{id || t.common.notAvailable}</span>
          </DetailRow>
        </dl>
      </Card>

      <div className="mt-4">
        <RouteScaffold
          title={t.screens.receipt}
          plannedBehaviour={[
            'Rendered only when finalStatus is FINAL_PAID or CANCELLED_REFUNDED and assurance is verified_final.',
            'A refunded payment reads "Refunded" and never carries a paid or verified-paid treatment.',
            'Shows funding and settlement transaction hashes separately from internal receipt ids.',
            'Explorer links are evidence, not proof on their own; the verification source is disclosed.',
          ]}
          dependsOn={[
            'Codex GET /api/v1/receipts/:id returning VerifiedReceipt (404/409 until final).',
            'Settlement receipt ids for the payout/refund transfer and its callback.',
          ]}
        />
      </div>
    </>
  );
}
