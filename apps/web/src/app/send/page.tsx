'use client';

import { ScreenHeader } from '@/components/primitives/Surface';
import { SendFlow } from '@/components/send/SendFlow';
import { useT } from '@/lib/i18n/provider';

/** Send NEAR Testnet: prepare and review. Confirming is gated (see SendFlow). */
export default function SendPage() {
  const t = useT();
  return (
    <>
      <ScreenHeader title={t.screens.send} description={t.walletUx.send.subtitle} />
      <SendFlow />
    </>
  );
}
