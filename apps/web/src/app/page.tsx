'use client';

import Link from 'next/link';
import { TaplyIcon } from '@/components/brand/TaplyIcon';
import { Card, ScreenHeader } from '@/components/primitives/Surface';
import { FeatureDisabled } from '@/components/feedback/ErrorState';
import { useT } from '@/lib/i18n/provider';
import { FLAGS } from '@/lib/flags/features';

/**
 * Wallet home (UX_FLOWS screens 00/01/03).
 *
 * Phase 0 renders the disconnected state only. There is no balance here, and no
 * placeholder balance either: a fake number on the wallet home is exactly the
 * kind of mock-presented-as-real the brief rules out.
 */
export default function HomePage() {
  const t = useT();

  return (
    <>
      <div className="flex flex-col items-center py-8 text-center">
        <TaplyIcon size={64} label={t.app.name} />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          {t.app.name}
          <span className="text-[var(--taply-lime)]">.</span>
        </h1>
        <p className="mt-1 max-w-xs text-sm text-[var(--text-secondary)]">{t.app.demoFundsNote}</p>
      </div>

      <ScreenHeader title={t.screens.home} />

      <FeatureDisabled flag="walletConnect" state={FLAGS.walletConnect} title={t.errors.WALLET_NOT_READY.title} />

      <Card className="mt-4">
        <h2 className="text-sm font-semibold">What works today</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--text-secondary)]">
          <li>App shell, routing, English/Turkish copy, accessibility and brand assets.</li>
          <li>
            The payment status mapping and its safety tests — see{' '}
            <Link href="/demo" className="text-[var(--taply-lime)] underline">
              {t.screens.demo}
            </Link>
            .
          </li>
        </ul>

        <h2 className="mt-4 text-sm font-semibold">What does not work yet</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--tone-caution-fg)]">
          <li>Wallet connection, balances, sending and receiving.</li>
          <li>Instant Pay, Protected Pay, merchant checkout, Handshake, receipts.</li>
          <li>No contract is deployed and no payment has been demonstrated on NEAR Testnet.</li>
        </ul>
      </Card>
    </>
  );
}
