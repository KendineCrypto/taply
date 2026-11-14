'use client';

import Link from 'next/link';
import type { Route } from 'next';
import type { ReactNode } from 'react';
import { Monogram } from '@/components/experience/Basics';
import { InstantOnlyBadge } from '@/components/merchant/MerchantParts';
import { Card, DetailRow, EmptyState, ScreenHeader } from '@/components/primitives/Surface';
import { Icon } from '@/components/shell/Icons';
import { LocaleSwitch } from '@/components/shell/ShellParts';
import { useT } from '@/lib/i18n/provider';
import { MAINNET_CONFIG } from '@/lib/mainnet/config';
import { useCurrentMainnetAccount } from './MainnetShell';
import { NoWalletCard } from './NoWalletCard';
import { WalletPanel } from './WalletPanel';

/**
 * NEAR Mainnet screens rendered with the Testnet markup and words (the Testnet
 * dictionary adapted to Mainnet). Only Mainnet data is read here: the Mainnet
 * vault / external wallet and MAINNET_CONFIG. No Testnet wallet or client.
 */

/** Activity tab with no wallet: the Testnet empty state. */
export function ActivityEmptyView() {
  const t = useT();
  return (
    <>
      <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--border-subtle)] px-5 py-7 text-center" data-testid="activity-empty">
        <span className="mx-auto grid size-11 place-items-center rounded-full bg-[var(--tone-neutral-bg)] text-[var(--text-secondary)]">
          <Icon name="activity" />
        </span>
        <p className="mt-3 font-semibold">{t.home.activityEmptyTitle}</p>
        <p className="mx-auto mt-1 max-w-xs text-sm leading-relaxed text-[var(--text-secondary)]">{t.home.activityConnectBody}</p>
      </div>
      <p className="mt-4 px-1 text-xs leading-relaxed text-[var(--text-muted)]">{t.oneTap.activity.scope}</p>
    </>
  );
}

/** Merchant header (title + Instant badge), as on Testnet. */
export function MerchantHeader() {
  const t = useT();
  return (
    <>
      <ScreenHeader title={t.commerce.merchant.title} />
      <div className="-mt-2 mb-1">
        <InstantOnlyBadge />
      </div>
    </>
  );
}

/** Split / Recurring with no wallet: Testnet connect card + empty state (+ how it works). */
export function ToolNoWallet({ kind }: { readonly kind: 'split' | 'recurring' }) {
  const t = useT();
  const s = kind === 'split' ? t.tools.split : t.tools.recurring;
  return (
    <div className="flex flex-col gap-4">
      <NoWalletCard text={s.connectFirst} />
      <EmptyState title={s.empty.title} body={s.empty.body} />
      {kind === 'split' && (
        <details className="disclosure px-1">
          <summary className="flex min-h-[var(--tap-target)] cursor-pointer items-center text-sm text-[var(--text-secondary)]">{t.tools.split.howItWorksTitle}</summary>
          <p className="pb-2 text-sm text-[var(--text-secondary)]">{t.tools.split.howItWorks}</p>
        </details>
      )}
    </div>
  );
}

/** The Testnet "not a subscription" pill under the Recurring header. */
export function RecurringPill() {
  const t = useT();
  return (
    <p className="-mt-2 inline-flex items-center gap-1.5 self-start rounded-full border border-[var(--border-subtle)] px-3 py-1 text-xs text-[var(--text-secondary)]" data-testid="not-subscription">
      <Icon name="shield" size={14} /> {t.tools.recurring.notSubscription}
    </p>
  );
}

/** Settings: the Testnet layout (wallet, language, network) with Mainnet values. */
export function MainnetSettingsView({ extra }: { readonly extra?: ReactNode }) {
  const t = useT();
  const { accountId, kind } = useCurrentMainnetAccount();
  const contract = MAINNET_CONFIG.ok && MAINNET_CONFIG.contract.status === 'configured' ? MAINNET_CONFIG.contract.accountId : null;
  return (
    <div className="flex flex-col gap-4">
      <Card as="section">
        <h2 className="mb-3 text-sm font-semibold">{t.settings.walletSection}</h2>
        {accountId !== null ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Monogram accountId={accountId} size={40} />
              <div className="min-w-0">
                <p className="chain-id break-all font-semibold">{accountId}</p>
                <p className="text-xs text-[var(--text-muted)]">{kind === 'taply' ? t.walletNative.taply : t.walletNative.external}</p>
              </div>
            </div>
            {kind === 'external' && <WalletPanel />}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[var(--text-secondary)]">{t.settings.notConnected}</p>
            <WalletPanel primary />
          </div>
        )}
        <p className="mt-3 text-xs leading-relaxed text-[var(--text-muted)]">{t.wallet.noKeysNote}</p>
        <Link
          href={'/m/wallet' as Route}
          className="mt-3 flex min-h-[var(--tap-target)] items-center justify-between gap-3 rounded-[var(--radius-control)] px-1 text-sm font-medium text-[var(--text-primary)] hover:text-[var(--taply-lime)]"
        >
          {t.walletUx.onboarding.openWallet}
          <Icon name="chevron" size={18} />
        </Link>
      </Card>

      <Card as="section">
        <h2 className="mb-3 text-sm font-semibold">{t.settings.languageSection}</h2>
        <LocaleSwitch />
      </Card>

      <Card as="section">
        <h2 className="mb-1 text-sm font-semibold">{t.settings.networkSection}</h2>
        <dl>
          <DetailRow label={t.common.network} emphasis>
            {t.app.networkBadge}
          </DetailRow>
          <DetailRow label={t.settings.rpcLabel}>
            <span className="chain-id">{MAINNET_CONFIG.ok ? MAINNET_CONFIG.rpcProviderId : t.common.notAvailable}</span>
          </DetailRow>
          <DetailRow label={t.settings.contractLabel}>
            {contract !== null ? <span className="chain-id">{contract}</span> : t.settings.contractNotDeployed}
          </DetailRow>
        </dl>
        <p className="mt-2 text-xs text-[var(--text-muted)]">{t.app.demoFundsNote}</p>
      </Card>
      {extra}
    </div>
  );
}
