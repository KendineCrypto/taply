'use client';

import { RouteScaffold } from '@/components/shell/RouteScaffold';
import { useT } from '@/lib/i18n/provider';

export default function Page() {
  const t = useT();
  return (
    <RouteScaffold
      title={t.screens.split}
      flag="splitPay"
      plannedBehaviour={[
        'Each participant pays a distinct immutable request; integer base-unit sums must be exact.',
        'Group completes only after every child request reaches a verified final state.',
      ]}
      dependsOn={[
        'Instant Pay verified on Testnet first (G1).',
      ]}
    />
  );
}
