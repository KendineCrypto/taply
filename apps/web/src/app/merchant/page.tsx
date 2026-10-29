'use client';

import { ComingSoon } from '@/components/shell/ComingSoon';
import { useT } from '@/lib/i18n/provider';

/** Not live yet. Technical dependencies are listed in /demo diagnostics. */
export default function Page() {
  const t = useT();
  return (
    <ComingSoon
      title={t.screens.merchant}
      summary={t.routes.merchant}
      flag="merchantCheckout"
      icon="pay"
    />
  );
}
