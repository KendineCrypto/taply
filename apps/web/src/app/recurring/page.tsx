'use client';

import { RouteScaffold } from '@/components/shell/RouteScaffold';
import { useT } from '@/lib/i18n/provider';

export default function Page() {
  const t = useT();
  return (
    <RouteScaffold
      title={t.screens.recurring}
      flag="recurring"
      plannedBehaviour={[
        'Templates create new unpaid requests. There is no autopay and no unattended debit, ever.',
      ]}
      dependsOn={[
        'Deferred to P2 by freeze section 1.',
      ]}
    />
  );
}
