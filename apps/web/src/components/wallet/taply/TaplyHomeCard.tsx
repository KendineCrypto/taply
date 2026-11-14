'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { Spinner } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import { useT } from '@/lib/i18n/provider';
import { useTaplyWallet } from './TaplyWalletProvider';
import { TaplyIdentityCard } from './TaplyWalletUi';
import { TaplyIntroView } from '../WalletHomeViews';

/** Home hero when Taply Wallet is the active view. */
export function TaplyHomeCard() {
  const t = useT();
  const n = t.walletNative;
  const { state, unlocked, refresh } = useTaplyWallet();
  // Coming back to home after a payment shows the current balance.
  useEffect(() => {
    refresh();
  }, [refresh]);
  if (state.status === 'checking') {
    return (
      <p role="status" className="surface-hero flex items-center gap-2 p-5 text-sm text-[var(--text-secondary)]">
        <Spinner /> {n.status.checking}
      </p>
    );
  }
  if (state.status === 'unavailable') return <InlineNotice copy={n.unavailable} tone="neutral" />;
  if (state.status === 'not_created') return <TaplyIntroView createHref="/wallet/create" restoreHref="/wallet/restore" />;
  return (
    <TaplyIdentityCard
      actions={
        <Link
          href="/wallet"
          className="tap-target inline-flex items-center gap-1.5 rounded-full px-3 text-xs font-medium text-[var(--text-secondary)] ring-1 ring-[var(--border-strong)] hover:text-[var(--text-primary)]"
        >
          {unlocked ? t.walletUx.home.manage : n.home.lockedHint}
          <Icon name="chevron" size={14} />
        </Link>
      }
    />
  );
}
