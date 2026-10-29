'use client';

import { RouteScaffold } from '@/components/shell/RouteScaffold';
import { useT } from '@/lib/i18n/provider';

export default function Page() {
  const t = useT();
  return (
    <RouteScaffold
      title={t.screens.merchantRegister}
      flag="merchantCheckout"
      plannedBehaviour={[
        'POS: merchant enters an amount and signs a new unique on-chain request per sale.',
        'Merchant must be present with a connected authorized wallet; staff read access is not signing authority.',
        'Shows the sale-specific QR for the customer to scan.',
      ]}
      dependsOn={[
        'Codex merchant-signed sale creation.',
        'Browser wallet adapter (Claude).',
      ]}
    />
  );
}
