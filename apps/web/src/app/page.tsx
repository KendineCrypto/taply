'use client';

import { QuickActions } from '@/components/home/QuickActions';
import { RecentActivity } from '@/components/home/RecentActivity';
import { TourCard } from '@/components/home/TourCard';
import { BalanceCard } from '@/components/wallet/BalanceCard';
import { TaplyHomeCard } from '@/components/wallet/taply/TaplyHomeCard';
import { useWalletMode } from '@/components/wallet/taply/mode';
import { useT } from '@/lib/i18n/provider';

/**
 * Wallet home (UX_FLOWS screens 00/01/03).
 *
 * Balance card -> quick actions -> recent activity. Development notes about
 * what works and what does not live in /demo, not here. Nothing on this screen
 * is mocked: the balance is a finalized Testnet read or it is not shown.
 */
export default function HomePage() {
  const t = useT();
  const [mode] = useWalletMode();

  return (
    <div className="flex flex-col gap-5 pt-2">
      <h1 className="sr-only">{t.screens.home}</h1>
      {mode === 'taply' ? <TaplyHomeCard /> : <BalanceCard />}
      <QuickActions />
      <TourCard />
      <RecentActivity />
    </div>
  );
}
