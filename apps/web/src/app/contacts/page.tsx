'use client';

import { RouteScaffold } from '@/components/shell/RouteScaffold';
import { useT } from '@/lib/i18n/provider';

export default function Page() {
  const t = useT();
  return (
    <RouteScaffold
      title={t.screens.contacts}
      flag="contacts"
      plannedBehaviour={[
        'Local-first labels mapped to account IDs; no cloud sync without explicit opt-in.',
        'A label can never silently change a signed recipient - the review sheet always shows the full account ID.',
      ]}
    />
  );
}
