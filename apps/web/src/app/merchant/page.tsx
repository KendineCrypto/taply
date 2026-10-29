'use client';

import { RouteScaffold } from '@/components/shell/RouteScaffold';
import { useT } from '@/lib/i18n/provider';

export default function Page() {
  const t = useT();
  return (
    <RouteScaffold
      title={t.screens.merchant}
      flag="merchantCheckout"
      plannedBehaviour={[
        'Per-intent status with explorer evidence; amber Locked, lime Final, muted Refunded.',
        'Never a green Paid badge for escrow (freeze section 9).',
        'Invoice number and session identifier per sale.',
      ]}
      dependsOn={[
        'Codex merchant-scoped authenticated reads.',
        'NEP-413 wallet-signature session.',
      ]}
    />
  );
}
