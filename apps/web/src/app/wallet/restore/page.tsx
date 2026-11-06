'use client';

import { ScreenHeader } from '@/components/primitives/Surface';
import { RestoreWalletFlow } from '@/components/wallet/taply/RestoreWalletFlow';
import { useT } from '@/lib/i18n/provider';

export default function RestoreWalletPage() {
  const t = useT();
  return (
    <>
      <ScreenHeader title={t.walletNative.restoreFlow.title} />
      <RestoreWalletFlow />
    </>
  );
}
