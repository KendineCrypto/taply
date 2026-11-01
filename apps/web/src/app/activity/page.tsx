'use client';

import { ScreenHeader } from '@/components/primitives/Surface';
import { RecentActivity } from '@/components/home/RecentActivity';
import { useT } from '@/lib/i18n/provider';

/**
 * Activity tab: every request and payment this browser started for the
 * connected account, from the local journal. Each row opens its status page,
 * which reads the chain. No synthetic history.
 */
export default function ActivityPage() {
  const t = useT();
  return (
    <>
      <ScreenHeader title={t.oneTap.activity.title} />
      <RecentActivity preview={false} />
    </>
  );
}
