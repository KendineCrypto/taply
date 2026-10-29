'use client';

import { RouteScaffold } from '@/components/shell/RouteScaffold';
import { useT } from '@/lib/i18n/provider';

export default function Page() {
  const t = useT();
  return (
    <RouteScaffold
      title={t.screens.merchantSetup}
      flag="merchantCheckout"
      plannedBehaviour={[
        'NEP-413 wallet-signature challenge binding display name, accountId, network, contract, origin and expiry.',
        'States plainly that this proves account control, not business identity or KYC.',
        'Merchant URL is account-derived: /checkout/{accountId}. Vanity slugs are deferred.',
      ]}
      dependsOn={[
        'Codex NEP-413 challenge/verify endpoints.',
        'NEP-413 capability confirmed on the target Testnet wallets.',
      ]}
    />
  );
}
