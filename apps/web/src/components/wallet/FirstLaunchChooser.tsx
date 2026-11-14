'use client';

import { FirstLaunchChooserView } from './WalletHomeViews';
import { ConnectWalletButton, WalletErrorNotice } from '@/components/wallet/WalletConnect';
import { useT } from '@/lib/i18n/provider';
import { useWallet } from '@/lib/wallet/provider';
import { useOptionalTaplyWallet, useTaplyWallet } from './taply/TaplyWalletProvider';
import { useWalletMode } from './taply/mode';

/**
 * Whether `/` should show the first-launch chooser: no external wallet is
 * connected (or being restored), no Taply Wallet exists on this device and the
 * user has not picked Taply Wallet as the active view.
 */
export function useFirstLaunch(): boolean {
  const { state } = useWallet();
  const taply = useOptionalTaplyWallet();
  const [mode] = useWalletMode();
  const externalIdle = state.status === 'disconnected' || state.status === 'connecting' || state.status === 'disabled';
  return mode === 'external' && externalIdle && taply?.state.status === 'not_created';
}

/**
 * First launch (owner decision 2026-11-09): exactly two ways to start.
 * 1) connect an external wallet (existing NEAR Connect flow, keys stay there);
 * 2) pick a username and get a real `username.testnet` Taply Wallet
 *    (faucet-created, confirmed on chain). No sponsored gas.
 */
export function FirstLaunchChooser() {
  const t = useT();
  const { state } = useWallet();
  const taplyAvailable = useTaplyWallet().state.status !== 'unavailable';
  return (
    <FirstLaunchChooserView
      externalSlot={state.status === 'disabled' ? <p className="text-sm text-[var(--text-muted)]">{t.wallet.disabled.body}</p> : <><WalletErrorNotice /><ConnectWalletButton /></>}
      taplyAvailable={taplyAvailable}
      createHref="/wallet/create"
      restoreHref="/wallet/restore"
      footnote={t.walletNative.username.noGas}
    />
  );
}
