'use client';

import { useParams } from 'next/navigation';
import { Card, DetailRow, ScreenHeader } from '@/components/primitives/Surface';
import { ErrorState } from '@/components/feedback/ErrorState';
import { RouteScaffold } from '@/components/shell/RouteScaffold';
import { useT } from '@/lib/i18n/provider';

/**
 * The canonical, role-aware intent view (UX_FLOWS screens 07, 08, 12-17).
 *
 * One route renders every role (payer / recipient / creator / observer) and every
 * ChainState, so there is a single status code path and therefore a single place
 * a false "paid" could ever appear.
 *
 * Phase 0 reads no chain data. Rather than invent an intent, it shows the
 * identifier it was given and states what will be fetched.
 */
export default function PayIntentPage() {
  const t = useT();
  const params = useParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';

  // Request IDs are hex SHA-256 digests (freeze section 7).
  const looksWellFormed = /^[0-9a-f]{64}$/.test(id);

  return (
    <>
      <ScreenHeader title={t.screens.pay} />

      {!looksWellFormed && (
        <div className="mb-4">
          <ErrorState code="INVALID_ACCOUNT" />
        </div>
      )}

      <Card>
        <dl>
          <DetailRow label="Request ID">
            <span className="chain-id">{id || t.common.notAvailable}</span>
          </DetailRow>
          <DetailRow label={t.common.network}>{t.app.networkBadge}</DetailRow>
        </dl>
      </Card>

      <div className="mt-4">
        <RouteScaffold
          title={t.screens.pay}
          flag="instantPay"
          plannedBehaviour={[
            'Fetch PaymentIntentResponse from Codex and render status via mapChainState only.',
            'Recipient, exact amount, network, mode and cancel rights shown in full before any signature.',
            'Terms are re-read and the termsHash re-compared immediately before the wallet opens.',
            'Protected: LOCKED shows "not paid" to both sides, with a chain-anchored approximate countdown.',
            'Cancel appears only for the payer while the chain window is open; release only once eligible.',
            'An unknown outcome blocks any further payment until the chain is queried.',
          ]}
          dependsOn={[
            'Codex GET /api/v1/payment-intents/:id returning ChainObservation + derived projection.',
            'Chain time for countdown anchoring (observedBlock.timestampNs).',
            'Browser wallet adapter (Claude, next increment).',
          ]}
        />
      </div>
    </>
  );
}
