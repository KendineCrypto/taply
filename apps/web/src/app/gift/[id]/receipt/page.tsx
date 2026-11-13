'use client';

import { useParams } from 'next/navigation';
import { isGiftId } from '@taply/near-client';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { ScreenHeader } from '@/components/primitives/Surface';
import { GiftReceipt } from '@/components/gift/GiftReceipt';
import { useT } from '@/lib/i18n/provider';

export default function GiftReceiptPage() {
  const t = useT();
  const params = useParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  return (
    <>
      <ScreenHeader title={t.gift.receipt.title} />
      {isGiftId(id) ? <GiftReceipt id={id} /> : <InlineNotice copy={t.gift.claim.states.not_found} />}
    </>
  );
}
