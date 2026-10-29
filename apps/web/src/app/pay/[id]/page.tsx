'use client';

import { useParams } from 'next/navigation';
import { Card, DetailRow } from '@/components/primitives/Surface';
import { ErrorState } from '@/components/feedback/ErrorState';
import { ComingSoon } from '@/components/shell/ComingSoon';
import { useT } from '@/lib/i18n/provider';

/**
 * The canonical, role-aware intent view (UX_FLOWS screens 07, 08, 12-17).
 *
 * One route renders every role and every ChainState, so there is a single
 * status code path. Until Codex's payment-intent read exists, it shows only the
 * identifier it was given - never an invented intent.
 */
export default function PayIntentPage() {
  const t = useT();
  const params = useParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';

  // Request IDs are hex SHA-256 digests (freeze section 7).
  const looksWellFormed = /^[0-9a-f]{64}$/.test(id);

  return (
    <ComingSoon title={t.screens.pay} summary={t.routes.payIntent} flag="instantPay" icon="pay">
      {!looksWellFormed && (
        <div className="mb-4">
          <ErrorState code="REQUEST_NOT_FOUND" />
        </div>
      )}
      <Card>
        <dl>
          <DetailRow label={t.routes.requestIdLabel}>
            <span className="chain-id">{id || t.common.notAvailable}</span>
          </DetailRow>
          <DetailRow label={t.common.network}>{t.app.networkBadge}</DetailRow>
        </dl>
      </Card>
    </ComingSoon>
  );
}
