'use client';

import { RouteScaffold } from '@/components/shell/RouteScaffold';
import { useT } from '@/lib/i18n/provider';

export default function Page() {
  const t = useT();
  return (
    <RouteScaffold
      title={t.screens.requestNew}
      flag="instantPay"
      plannedBehaviour={[
        'Recipient-created request: creator and recipient are the same account (freeze section 4).',
        'Instant or Protected mode selector; Milestone is rendered disabled.',
        'Protected shows the immutable cancel duration (60s default, 60-3600s range) - never a pre-funding timestamp.',
        'Creation nonce is generated and journaled before the wallet is opened, so the request ID is known on return.',
      ]}
      dependsOn={[
        'Codex create_request ABI and the deterministic request ID helper.',
        'packages/shared IntentTerms + termsHash vectors.',
      ]}
    />
  );
}
