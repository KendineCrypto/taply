'use client';

import { ComingSoon } from '@/components/shell/ComingSoon';
import { SplitScreen } from '@/components/split/SplitScreen';
import { FLAGS } from '@/lib/flags/features';
import { useT } from '@/lib/i18n/provider';

/** Split Pay MVP (Monday sprint E3). Kill switch: NEXT_PUBLIC_TAPLY_FLAG_SPLIT=off. */
export default function Page() {
  const t = useT();
  if (!FLAGS.splitPay.enabled) {
    return <ComingSoon title={t.screens.split} summary={t.routes.split} flag="splitPay" icon="request" />;
  }
  return <SplitScreen />;
}
