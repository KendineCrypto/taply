'use client';

import { RouteScaffold } from '@/components/shell/RouteScaffold';
import { useT } from '@/lib/i18n/provider';

export default function Page() {
  const t = useT();
  return (
    <RouteScaffold
      title={t.screens.send}
      flag="walletConnect"
      plannedBehaviour={[
        'Enter a recipient account ID and an exact base-unit amount.',
        'Full review sheet with untruncated recipient, exact amount, network and fees before signing.',
        'Swipe or keyboard-equivalent control opens the wallet; it never transfers on its own.',
      ]}
      dependsOn={[
        'Browser wallet adapter (Claude, next increment).',
        'packages/near-client transaction preparation (Codex).',
      ]}
    />
  );
}
