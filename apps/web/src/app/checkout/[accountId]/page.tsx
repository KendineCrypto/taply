'use client';

import { useParams } from 'next/navigation';
import { Card, DetailRow, ScreenHeader } from '@/components/primitives/Surface';
import { RouteScaffold } from '@/components/shell/RouteScaffold';
import { useT } from '@/lib/i18n/provider';

/**
 * Merchant entry point (UX_FLOWS screen 09).
 *
 * Freeze section 5: the permanent QR is DISCOVERY, not a payable invoice, and
 * `slug === accountId`. It may list an active sale but must never silently mint
 * a merchant-signed request. That distinction is stated on screen, not just in
 * code comments.
 */
export default function CheckoutPage() {
  const t = useT();
  const params = useParams<{ accountId: string }>();
  const accountId = typeof params.accountId === 'string' ? params.accountId : '';

  return (
    <>
      <ScreenHeader title={t.screens.checkout} />

      <Card>
        <dl>
          <DetailRow label="Merchant account" emphasis>
            <span className="chain-id">{accountId || t.common.notAvailable}</span>
          </DetailRow>
          <DetailRow label={t.common.network}>{t.app.networkBadge}</DetailRow>
        </dl>

        <p className="mt-3 rounded-[var(--radius-control)] border border-[var(--tone-caution-border)] bg-[var(--tone-caution-bg)] p-3 text-sm text-[var(--tone-caution-fg)]">
          {t.checkout.permanentQrIsDiscovery}
        </p>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{t.checkout.merchantMustSign}</p>
        <p className="mt-2 text-xs text-[var(--text-muted)]">{t.checkout.accountControlOnly}</p>
      </Card>

      <div className="mt-4">
        <RouteScaffold
          title={t.screens.checkout}
          flag="merchantCheckout"
          plannedBehaviour={[
            'Resolve the merchant profile and show its account binding evidence, or UNVERIFIED_MERCHANT.',
            'List an active merchant-signed sale, if one exists, as a link - never as an auto-created charge.',
            'The receiving account always comes from the chain read, never from the QR payload or URL.',
          ]}
          dependsOn={[
            'Codex GET /api/v1/merchants/:accountId with binding evidence.',
            'Merchant-signed sale creation at the POS.',
          ]}
        />
      </div>
    </>
  );
}
