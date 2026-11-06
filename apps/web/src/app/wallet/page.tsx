'use client';

import { Button, ButtonLink } from '@/components/primitives/Button';
import { ScreenHeader } from '@/components/primitives/Surface';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { Monogram } from '@/components/experience/Basics';
import { Icon } from '@/components/shell/Icons';
import { AccountChip } from '@/components/wallet/AccountChip';
import { WalletKindBadge } from '@/components/wallet/WalletKind';
import { WalletOnboarding } from '@/components/wallet/WalletOnboarding';
import { TaplyWalletPanel, WalletModeSwitch } from '@/components/wallet/taply/TaplyWalletUi';
import { useWalletMode } from '@/components/wallet/taply/mode';
import { fill } from '@/lib/i18n';
import { useT } from '@/lib/i18n/provider';
import { CHAIN_CONFIG, explorerAccountUrl } from '@/lib/near/config';
import { useWallet } from '@/lib/wallet/provider';

/**
 * /wallet - switch between the external wallet (NEAR Connect / Meteor) and the
 * native Taply Wallet (encrypted local vault). A local-only Taply identity is
 * never shown as an active account, and Taply Wallet signing is off.
 */
export default function WalletPage() {
  const t = useT();
  const [mode] = useWalletMode();
  return (
    <>
      <div className="mb-5">
        <WalletModeSwitch />
      </div>
      {mode === 'taply' ? (
        <>
          <ScreenHeader title={t.walletNative.taply} description={t.walletNative.intro.body} />
          <TaplyWalletPanel />
        </>
      ) : (
        <ExternalWallet />
      )}
    </>
  );
}

function ExternalWallet() {
  const t = useT();
  const { state, disconnect } = useWallet();
  const o = t.walletUx.onboarding;

  if (state.status === 'disabled') {
    return (
      <>
        <ScreenHeader title={o.openWallet} />
        <InlineNotice copy={t.wallet.disabled} tone="neutral" />
      </>
    );
  }

  if (state.status !== 'connected') {
    return (
      <>
        <header className="mb-5 mt-1">
          <p className="eyebrow text-[var(--text-muted)]">{o.eyebrow}</p>
          <h1 className="mt-2 text-[1.75rem] font-semibold leading-tight tracking-tight">{o.title}</h1>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-[var(--text-secondary)]">{o.subtitle}</p>
        </header>
        <WalletOnboarding />
        <p className="mt-4 flex items-start gap-2 px-1 text-xs leading-relaxed text-[var(--text-muted)]">
          <Icon name="check" size={14} className="mt-0.5 shrink-0 text-[var(--taply-lime)]" />
          {t.wallet.noKeysNote}
        </p>
      </>
    );
  }

  const { accountId, walletName } = state.session;
  return (
    <>
      <ScreenHeader title={o.openWallet} />
      <div className="flex flex-col gap-4">
        <section className="surface-hero p-5">
          <div className="flex items-center gap-3">
            <Monogram accountId={accountId} size={48} />
            <div className="min-w-0">
              <WalletKindBadge kind="external" walletName={walletName} />
              <p className="mt-1 text-sm text-[var(--text-secondary)]">{fill(t.walletUx.kind.externalKeys, { wallet: walletName })}</p>
            </div>
          </div>
          <div className="mt-5 border-t border-[var(--border-subtle)] pt-4">
            <AccountChip accountId={accountId} full caption={t.app.networkBadge} />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-[var(--text-muted)]">{t.wallet.reportedNotProven}</p>
        </section>

        <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
          <ButtonLink href="/receive" size="lg" block>
            <Icon name="receive" size={18} />
            {t.home.receive}
          </ButtonLink>
          {CHAIN_CONFIG.ok ? (
            <ButtonLink href={explorerAccountUrl(CHAIN_CONFIG.explorerBaseUrl, accountId)} external size="lg" block>
              {t.home.viewOnExplorer}
              <Icon name="external" size={16} />
            </ButtonLink>
          ) : null}
        </div>

        <Button variant="ghost" block onClick={() => void disconnect()}>
          <Icon name="logout" size={18} />
          {t.wallet.disconnect}
        </Button>
      </div>
    </>
  );
}
