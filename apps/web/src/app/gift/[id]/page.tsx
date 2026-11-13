'use client';

import { useParams } from 'next/navigation';
import { isGiftId } from '@taply/near-client';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { ScreenHeader } from '@/components/primitives/Surface';
import { GiftScreen } from '@/components/gift/GiftScreen';
import { useT } from '@/lib/i18n/provider';

/** An Open Gift. The link secret stays in the URL fragment and never reaches a server. */
export default function GiftPage() {
  const t = useT();
  const params = useParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  return (
    <>
      <ScreenHeader title={t.gift.claim.heading} />
      {isGiftId(id) ? <GiftScreen id={id} /> : <InlineNotice copy={t.gift.claim.states.not_found} />}
    </>
  );
}
