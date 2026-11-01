'use client';

import { ScreenHeader } from '@/components/primitives/Surface';
import { CreateWalletFlow } from '@/components/wallet/taply/CreateWalletFlow';
import { useT } from '@/lib/i18n/provider';

export default function CreateWalletPage() {
  const t = useT();
  return (
    <>
      <ScreenHeader title={t.walletNative.createFlow.title} description={t.walletNative.intro.body} />
      <CreateWalletFlow />
    </>
  );
}
