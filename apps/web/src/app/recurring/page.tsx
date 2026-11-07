'use client';

import { RecurringScreen } from '@/components/recurring/RecurringScreen';
import { ComingSoon } from '@/components/shell/ComingSoon';
import { FLAGS } from '@/lib/flags/features';
import { useT } from '@/lib/i18n/provider';

/** Recurring request templates (Monday sprint E2). Kill switch: NEXT_PUBLIC_TAPLY_FLAG_RECURRING=off. */
export default function Page() {
  const t = useT();
  if (!FLAGS.recurring.enabled) {
    return <ComingSoon title={t.screens.recurring} summary={t.routes.recurring} flag="recurring" icon="refresh" />;
  }
  return <RecurringScreen />;
}
