'use client';

import { ButtonLink } from '@/components/primitives/Button';
import { Card, ScreenHeader } from '@/components/primitives/Surface';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { Icon } from '@/components/shell/Icons';
import { AccountChip } from '@/components/wallet/AccountChip';
import { QrCode } from '@/components/payments/QrCode';
import { ConnectWalletButton, WalletErrorNotice } from '@/components/wallet/WalletConnect';
import { useT } from '@/lib/i18n/provider';
import { classifyAccountId } from '@/lib/near/account';
import { CHAIN_CONFIG, explorerAccountUrl } from '@/lib/near/config';
import { useWallet } from '@/lib/wallet/provider';

/**
 * Receive (UX_FLOWS screen 05).
 *
 * Shows the connected account ID in full, with copy and a QR code of exactly
 * that ID. It encodes identity only, never an amount or a payable request.
 */
export default function ReceivePage() {
  const t = useT();
  const { state } = useWallet();

  return (
    <>
      <ScreenHeader title={t.screens.receive} description={t.routes.receive} />

      {state.status === 'connected' ? (
        <div className="flex flex-col gap-4">
          <Card>
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              {t.receive.yourAccount}
            </p>
            <AccountChip accountId={state.session.accountId} full caption={t.app.networkBadge} />
          </Card>

          {classifyAccountId(state.session.accountId) === 'likely_mainnet' && (
            <InlineNotice copy={t.wallet.likelyMainnet} />
          )}

          <p className="flex items-start gap-2 px-1 text-sm leading-relaxed text-[var(--tone-caution-fg)]">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
            {t.receive.testnetOnlyWarning}
          </p>

          <Card className="flex flex-col items-center gap-3">
            {/* Identity only: the account ID, never an amount or a payable request. */}
            <QrCode value={state.session.accountId} label={t.receive.yourAccount} size={200} />
            <p className="text-center text-sm text-[var(--text-muted)]">{t.receive.qrLater}</p>
          </Card>

          {CHAIN_CONFIG.ok && (
            <ButtonLink href={explorerAccountUrl(CHAIN_CONFIG.explorerBaseUrl, state.session.accountId)} external block>
              {t.home.viewOnExplorer}
              <Icon name="external" size={16} />
            </ButtonLink>
          )}
        </div>
      ) : state.status === 'disabled' ? (
        <InlineNotice copy={t.wallet.disabled} tone="neutral" />
      ) : (
        <Card className="flex flex-col gap-4">
          <p className="text-sm text-[var(--text-secondary)]">{t.receive.connectFirst}</p>
          <WalletErrorNotice />
          <ConnectWalletButton />
        </Card>
      )}
    </>
  );
}
