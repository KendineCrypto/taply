'use client';

import { HomeActionsView } from '@/components/wallet/WalletHomeViews';
import { useWallet } from '@/lib/wallet/provider';

/**
 * Three real actions under the balance. Only routes that work in this build:
 * receive (address + QR), request (form up to wallet review) and pay (scan or
 * paste a request). Send stays in the Tap sheet while sending is preview-only.
 */
export function HomeActions() {
  const { state } = useWallet();
  if (state.status !== 'connected') return null;
  return <HomeActionsView receive="/receive" request="/request/new" pay="/scan" />;
}
