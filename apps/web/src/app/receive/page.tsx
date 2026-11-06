'use client';

import { ButtonLink } from '@/components/primitives/Button';
import { Card, ScreenHeader } from '@/components/primitives/Surface';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { Icon } from '@/components/shell/Icons';
import { ReceiveCard } from '@/components/wallet/ReceiveCard';
import { TaplyReceive } from '@/components/wallet/taply/TaplyReceive';
import { useWalletMode } from '@/components/wallet/taply/mode';
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
  const [mode] = useWalletMode();

  return (
    <>
      <ScreenHeader title={t.screens.receive} description={t.walletUx.receive.subtitle} />

      {mode === 'taply' ? (
        <TaplyReceive />
      ) : state.status === 'connected' ? (
        <div className="flex flex-col gap-4">
          {classifyAccountId(state.session.accountId) === 'likely_mainnet' && (
            <InlineNotice copy={t.wallet.likelyMainnet} />
          )}
          <ReceiveCard accountId={state.session.accountId} />
          {CHAIN_CONFIG.ok && (
            <ButtonLink href={explorerAccountUrl(CHAIN_CONFIG.explorerBaseUrl, state.session.accountId)} external block variant="ghost">
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
