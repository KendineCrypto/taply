'use client';

import { ScreenHeader } from '@/components/primitives/Surface';
import { GiftCreate } from '@/components/gift/GiftCreate';
import { FeatureDisabled } from '@/components/feedback/ErrorState';
import { FLAGS } from '@/lib/flags/features';
import { useT } from '@/lib/i18n/provider';

/** Taply Gift creation: Personal (direct transfer) or Open (claimable, gift contract). */
export default function GiftNewPage() {
  const t = useT();
  return (
    <>
      <ScreenHeader title={t.gift.title} />
      {FLAGS.gift.enabled ? <GiftCreate /> : <FeatureDisabled flag="gift" state={FLAGS.gift} title={t.gift.title} />}
    </>
  );
}
