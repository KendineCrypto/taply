'use client';

import { RouteScaffold } from '@/components/shell/RouteScaffold';
import { useT } from '@/lib/i18n/provider';

export default function Page() {
  const t = useT();
  return (
    <RouteScaffold
      title={t.screens.activity}
      flag="walletConnect"
      plannedBehaviour={[
        'Chain-indexed activity with provenance per row.',
        'Rows link to the canonical intent view or a final receipt.',
        'Unresolved submissions from the journal are surfaced at the top until reconciled.',
      ]}
      dependsOn={[
        'Codex typed pagination response for account activity.',
      ]}
    />
  );
}
