'use client';

import Link from 'next/link';
import { Icon } from '@/components/shell/Icons';
import { ButtonLink } from '@/components/primitives/Button';
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
  const c = t.walletNative.chooser;
  const { state } = useWallet();
  const taplyAvailable = useTaplyWallet().state.status !== 'unavailable';

  return (
    <section className="flex flex-col gap-4 pt-1" aria-labelledby="first-launch-title">
      <div>
        <h2 id="first-launch-title" className="text-[1.5rem] font-semibold leading-tight tracking-tight">
          {c.title}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-secondary)]">{c.body}</p>
      </div>

      <div className="surface-card p-5" role="group" aria-labelledby="first-launch-external">
        <div className="flex items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--surface-2)] text-[var(--taply-lime)] ring-1 ring-[var(--border-subtle)]">
            <Icon name="wallet" size={24} />
          </span>
          <div className="min-w-0">
            <h3 id="first-launch-external" className="text-lg font-semibold tracking-tight">
              {c.external.title}
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">{c.external.body}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-3">
          {state.status === 'disabled' ? (
            <p className="text-sm text-[var(--text-muted)]">{t.wallet.disabled.body}</p>
          ) : (
            <>
              <WalletErrorNotice />
              <ConnectWalletButton />
            </>
          )}
        </div>
      </div>

      <div className="surface-card p-5" role="group" aria-labelledby="first-launch-taply">
        <div className="flex items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--taply-lime)] text-[var(--taply-night)]">
            <Icon name="shield" size={24} />
          </span>
          <div className="min-w-0">
            <h3 id="first-launch-taply" className="text-lg font-semibold tracking-tight">
              {c.taply.title}
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">{c.taply.body}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          {taplyAvailable ? (
            <ButtonLink href="/wallet/create" size="lg" block>
              {c.taplyCta}
              <Icon name="arrow-right" size={18} />
            </ButtonLink>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">{t.walletNative.unavailable.body}</p>
          )}
          <p className="text-xs leading-relaxed text-[var(--text-muted)]">{t.walletNative.username.noGas}</p>
        </div>
      </div>

      {taplyAvailable && (
        <Link
          href="/wallet/restore"
          className="tap-target inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          {c.restore}
          <Icon name="chevron" size={16} />
        </Link>
      )}
    </section>
  );
}
