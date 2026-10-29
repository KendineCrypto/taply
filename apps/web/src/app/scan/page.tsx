'use client';

import { RouteScaffold } from '@/components/shell/RouteScaffold';
import { useT } from '@/lib/i18n/provider';

export default function Page() {
  const t = useT();
  return (
    <RouteScaffold
      title={t.screens.scan}
      flag="walletConnect"
      plannedBehaviour={[
        'Camera QR scanner with a manual paste fallback and a keyboard path.',
        'Validate the payload shape and canonical origin before navigating.',
        'Resolve only an identifier; recipient and amount are always re-read from chain, never taken from the QR.',
      ]}
      dependsOn={[
        'Codex GET /api/v1/payment-intents/:id for the chain re-read.',
      ]}
    />
  );
}
