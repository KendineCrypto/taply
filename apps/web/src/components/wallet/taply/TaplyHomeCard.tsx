'use client';

import Link from 'next/link';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { ButtonLink, Spinner } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import { useT } from '@/lib/i18n/provider';
import { useTaplyWallet } from './TaplyWalletProvider';
import { TaplyIdentityCard } from './TaplyWalletUi';

/** Home hero when Taply Wallet is the active view. */
export function TaplyHomeCard() {
  const t = useT();
  const n = t.walletNative;
  const { state, unlocked } = useTaplyWallet();
  if (state.status === 'checking') {
    return (
      <p role="status" className="surface-hero flex items-center gap-2 p-5 text-sm text-[var(--text-secondary)]">
        <Spinner /> {n.status.checking}
      </p>
    );
  }
  if (state.status === 'unavailable') return <InlineNotice copy={n.unavailable} tone="neutral" />;
  if (state.status === 'not_created') {
    return (
      <section className="surface-hero p-5" aria-labelledby="taply-home-intro">
        <h2 id="taply-home-intro" className="flex items-center gap-2 text-lg font-semibold">
          <Icon name="shield" size={20} className="text-[var(--taply-lime)]" />
          {n.intro.title}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-secondary)]">{n.intro.body}</p>
        <div className="mt-4 flex flex-col gap-2">
          <ButtonLink href="/wallet/create" variant="primary" size="lg" block>
            {n.create}
          </ButtonLink>
          <ButtonLink href="/wallet/restore" variant="ghost" block>
            {n.restore}
          </ButtonLink>
        </div>
      </section>
    );
  }
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
