'use client';

import { ScreenHeader } from '@/components/primitives/Surface';
import { SendFlow } from '@/components/send/SendFlow';
import { TaplySend } from '@/components/wallet/taply/TaplySend';
import { useWalletMode } from '@/components/wallet/taply/mode';
import { useT } from '@/lib/i18n/provider';

/** Send NEAR Testnet: prepare and review. Confirming is gated (see SendFlow). */
export default function SendPage() {
  const t = useT();
  const [mode] = useWalletMode();
  return (
    <>
      <ScreenHeader title={t.screens.send} description={t.walletUx.send.subtitle} />
      {mode === 'taply' ? <TaplySend /> : <SendFlow />}
    </>
  );
}
