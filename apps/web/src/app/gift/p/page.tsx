'use client';

import { ScreenHeader } from '@/components/primitives/Surface';
import { PersonalGiftScreen } from '@/components/gift/PersonalGiftScreen';
import { useT } from '@/lib/i18n/provider';

/** A Personal Gift envelope; the transfer itself is re-checked on NEAR Testnet. */
export default function PersonalGiftPage() {
  const t = useT();
  return (
    <>
      <ScreenHeader title={t.gift.personal.title} />
      <PersonalGiftScreen />
    </>
  );
}
