'use client';

import Link from 'next/link';
import { Button } from '@/components/primitives/Button';
import { Card, DetailRow, ScreenHeader } from '@/components/primitives/Surface';
import { Icon } from '@/components/shell/Icons';
import { LocaleSwitch } from '@/components/shell/AppShell';
import { AccountChip } from '@/components/wallet/AccountChip';
import { ConnectWalletButton, WalletErrorNotice } from '@/components/wallet/WalletConnect';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { fill } from '@/lib/i18n';
import { useT } from '@/lib/i18n/provider';
import { CHAIN_CONFIG } from '@/lib/near/config';
import { useWallet } from '@/lib/wallet/provider';

/**
 * Settings and security (UX_FLOWS screens 02/23).
 *
 * Product settings only. The capability table and build internals moved to
 * /demo diagnostics, linked at the bottom for reviewers.
 */
export default function SettingsPage() {
  const t = useT();
  const { state, disconnect } = useWallet();

  return (
    <>
      <ScreenHeader title={t.screens.settings} />

      <div className="flex flex-col gap-4">
        <Card as="section">
          <h2 className="mb-3 text-sm font-semibold">{t.settings.walletSection}</h2>
          {state.status === 'connected' ? (
            <>
              <AccountChip
                accountId={state.session.accountId}
                full
                caption={fill(t.wallet.connectedWith, { wallet: state.session.walletName })}
              />
              <p className="mt-3 text-xs leading-relaxed text-[var(--text-muted)]">{t.wallet.reportedNotProven}</p>
              <Button variant="secondary" block className="mt-4" onClick={() => void disconnect()}>
                <Icon name="logout" size={18} />
                {t.wallet.disconnect}
              </Button>
            </>
          ) : state.status === 'disabled' ? (
            <InlineNotice copy={t.wallet.disabled} tone="neutral" />
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-[var(--text-secondary)]">{t.settings.notConnected}</p>
              <WalletErrorNotice />
              <ConnectWalletButton size="md" />
            </div>
          )}
          <p className="mt-3 text-xs leading-relaxed text-[var(--text-muted)]">{t.wallet.noKeysNote}</p>
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
              <span className="chain-id">{CHAIN_CONFIG.ok ? CHAIN_CONFIG.client.rpcProviderId : t.common.notAvailable}</span>
            </DetailRow>
            <DetailRow label={t.settings.contractLabel}>
              {CHAIN_CONFIG.ok && CHAIN_CONFIG.contract.status === 'configured' ? (
                <span className="chain-id">{CHAIN_CONFIG.contract.accountId}</span>
              ) : (
                t.settings.contractNotDeployed
              )}
            </DetailRow>
          </dl>
          <p className="mt-2 text-xs text-[var(--text-muted)]">{t.app.demoFundsNote}</p>
        </Card>

        <Card as="section">
          <h2 className="text-sm font-semibold">{t.notices.socialLoginUnavailable.title}</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{t.notices.socialLoginUnavailable.body}</p>
        </Card>

        <Link
          href="/demo"
          className="flex min-h-[var(--tap-target)] items-center justify-between gap-3 rounded-[var(--radius-card)] px-4 py-3 text-sm text-[var(--text-secondary)] hover:bg-[var(--tone-neutral-bg)]"
        >
          <span>
            <span className="block font-medium text-[var(--text-primary)]">{t.settings.diagnosticsLink}</span>
            <span className="block text-xs text-[var(--text-muted)]">{t.settings.diagnosticsBody}</span>
          </span>
          <Icon name="chevron" size={18} />
        </Link>
      </div>
    </>
  );
}
