'use client';

import { Button, Spinner } from '@/components/primitives/Button';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { Icon } from '@/components/shell/Icons';
import { useT } from '@/lib/i18n/provider';
import { useOnline } from '@/lib/hooks/browser';
import { useWallet } from '@/lib/wallet/provider';

/** Primary connect action, with its pending state and the last failure. */
export function ConnectWalletButton({ size = 'lg' }: { readonly size?: 'md' | 'lg' }) {
  const t = useT();
  const online = useOnline();
  const { state, connect } = useWallet();
  const connecting = state.status === 'connecting';

  return (
    <Button
      size={size}
      block
      onClick={() => void connect()}
      disabled={connecting || state.status === 'restoring' || !online}
      aria-busy={connecting || undefined}
    >
      {connecting ? <Spinner /> : <Icon name="wallet" />}
      {connecting ? t.wallet.connecting : t.wallet.connect}
    </Button>
  );
}

/** The outcome of the last connect attempt, if it failed. Dismissible. */
export function WalletErrorNotice() {
  const t = useT();
  const { state, dismissError } = useWallet();
  if (state.status !== 'disconnected' || state.lastError === null) return null;

  return (
    <InlineNotice
      copy={t.wallet.errors[state.lastError]}
      tone={state.lastError === 'cancelled' ? 'neutral' : 'caution'}
      action={
        <Button variant="ghost" className="-ml-3" onClick={dismissError}>
          {t.common.close}
        </Button>
      }
    />
  );
}
