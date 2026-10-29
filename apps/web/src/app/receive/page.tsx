'use client';

import { RouteScaffold } from '@/components/shell/RouteScaffold';
import { useT } from '@/lib/i18n/provider';

export default function Page() {
  const t = useT();
  return (
    <RouteScaffold
      title={t.screens.receive}
      flag="walletConnect"
      plannedBehaviour={[
        'Show the connected account ID in full, with copy.',
        'Render an address QR that encodes identity only - never an amount or a payable request.',
      ]}
      dependsOn={[
        'Browser wallet adapter (Claude, next increment).',
      ]}
    />
  );
}
