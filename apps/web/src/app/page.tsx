'use client';

import { HomeActions } from '@/components/home/HomeActions';
import { RecentActivity } from '@/components/home/RecentActivity';
import { BalanceCard } from '@/components/wallet/BalanceCard';
import { TaplyHomeCard } from '@/components/wallet/taply/TaplyHomeCard';
import { useWalletMode } from '@/components/wallet/taply/mode';
import { useT } from '@/lib/i18n/provider';

/**
 * Wallet home (docs/UX_ONE_TAP_REDESIGN.md): balance, identity, real recent
 * activity, and three real shortcuts (receive, request, pay) under the
 * balance (owner direction 2026-11-08; Tap stays the primary action). The product tour lives in
 * the account menu (Help). The balance is a finalized Testnet read or it is
 * not shown.
 */
export default function HomePage() {
  const t = useT();
  const [mode] = useWalletMode();

  return (
    <div className="flex flex-col gap-8 pt-2">
      <h1 className="sr-only">{t.screens.home}</h1>
      {mode === 'taply' ? <TaplyHomeCard /> : <BalanceCard />}
      <HomeActions />
      <RecentActivity />
    </div>
  );
}
