'use client';

import { useParams } from 'next/navigation';
import { Card, DetailRow } from '@/components/primitives/Surface';
import { ComingSoon } from '@/components/shell/ComingSoon';
import { useT } from '@/lib/i18n/provider';

/**
 * Merchant entry point (UX_FLOWS screen 09).
 *
 * Freeze section 5: the permanent QR is DISCOVERY, not a payable invoice, and
 * `slug === accountId`. That distinction is stated on screen, not just in code.
 */
export default function CheckoutPage() {
  const t = useT();
  const params = useParams<{ accountId: string }>();
  const accountId = typeof params.accountId === 'string' ? params.accountId : '';

  return (
    <ComingSoon title={t.screens.checkout} summary={t.routes.checkout} flag="merchantCheckout" icon="pay">
      <Card>
        <dl>
          <DetailRow label={t.routes.merchantAccountLabel} emphasis>
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
    </ComingSoon>
  );
}
