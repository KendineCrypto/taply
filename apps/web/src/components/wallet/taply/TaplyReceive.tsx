'use client';

import { InlineNotice } from '@/components/feedback/InlineNotice';
import { ButtonLink, Spinner } from '@/components/primitives/Button';
import { ReceiveCard } from '@/components/wallet/ReceiveCard';
import { isNamedTestnetAccount } from '@taply/near-client';
import { useT } from '@/lib/i18n/provider';
import { useTaplyWallet } from './TaplyWalletProvider';
import { TaplyStatusBadge } from './TaplyWalletUi';

/**
 * Receive for Taply Wallet: the exact public account ID and its QR. A local-only
 * identity is labelled as having no NEAR Testnet account yet; showing the QR
 * neither creates nor funds an account.
 */
export function TaplyReceive() {
  const t = useT();
  const n = t.walletNative;
  const { state } = useTaplyWallet();
  if (state.status === 'checking') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
        <Spinner /> {n.status.checking}
      </p>
    );
  }
  if (state.status === 'unavailable') return <InlineNotice copy={n.unavailable} tone="neutral" />;
  if (state.status === 'not_created') {
    return <InlineNotice copy={n.intro} tone="neutral" action={<ButtonLink href="/wallet/create">{n.create}</ButtonLink>} />;
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <TaplyStatusBadge state={state} />
      </div>
      {state.status !== 'provisioned' && (
        <InlineNotice
          copy={{
            title: n.status.localOnly.title,
            // A named account is created only by the faucet step, never by a transfer.
            body: isNamedTestnetAccount(state.identity.accountId) ? n.receive.namedPendingNote : n.receive.localOnlyNote,
          }}
          tone="caution"
          action={isNamedTestnetAccount(state.identity.accountId) ? <ButtonLink href="/wallet">{n.username.finishSetup}</ButtonLink> : undefined}
        />
      )}
      <ReceiveCard accountId={state.identity.accountId} />
    </div>
  );
}
