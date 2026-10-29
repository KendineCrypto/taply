'use client';

import { useParams } from 'next/navigation';
import { Card, DetailRow } from '@/components/primitives/Surface';
import { ErrorState } from '@/components/feedback/ErrorState';
import { ComingSoon } from '@/components/shell/ComingSoon';
import { useT } from '@/lib/i18n/provider';

/**
 * Verified receipt (UX_FLOWS screen 17).
 *
 * A receipt exists only for a terminal, verified state. Until Codex's receipt
 * read exists this always renders RECEIPT_NOT_FINAL: no payment has settled.
 */
export default function ReceiptPage() {
  const t = useT();
  const params = useParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';

  return (
    <ComingSoon title={t.screens.receipt} summary={t.routes.receipt} icon="check">
      <div className="mb-4">
        <ErrorState code="RECEIPT_NOT_FINAL" />
      </div>
      <Card>
        <dl>
          <DetailRow label={t.routes.requestIdLabel}>
            <span className="chain-id">{id || t.common.notAvailable}</span>
          </DetailRow>
        </dl>
      </Card>
    </ComingSoon>
  );
}
