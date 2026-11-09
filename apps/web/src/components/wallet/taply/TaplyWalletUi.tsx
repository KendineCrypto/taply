'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { AmountHero, Monogram } from '@/components/experience/Basics';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { Button, ButtonLink, Spinner } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import { fill } from '@/lib/i18n';
import { useLocale, useT } from '@/lib/i18n/provider';
import { formatBaseUnits } from '@/lib/format/amount';
import { nsToDate } from '@/lib/format/time';
import { CHAIN_CONFIG, explorerAccountUrl } from '@/lib/near/config';
import { isNamedTestnetAccount } from '@taply/near-client';
import { useTaplyWallet } from './TaplyWalletProvider';
import { ActivationPanel } from './UsernameActivation';
import type { TaplyErrorCode, TaplyWalletState } from './TaplyWalletProvider';
import { useWalletMode } from './mode';

/** Segmented switch between the external wallet and Taply Wallet. A view choice only. */
export function WalletModeSwitch() {
  const t = useT();
  const [mode, setMode] = useWalletMode();
  const options = [
    { value: 'external' as const, label: t.walletNative.external, icon: 'link' as const },
    { value: 'taply' as const, label: t.walletNative.taply, icon: 'shield' as const },
  ];
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="eyebrow mb-2 text-[var(--text-muted)]">{t.walletNative.switchLabel}</legend>
      <div className="grid grid-cols-2 gap-1 rounded-[var(--radius-control)] bg-[var(--surface-1)] p-1 ring-1 ring-[var(--border-subtle)]">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={mode === o.value}
            onClick={() => setMode(o.value)}
            className={`flex min-h-[44px] items-center justify-center gap-2 rounded-[10px] px-2 text-sm font-semibold transition-colors ${
              mode === o.value
                ? 'bg-[var(--text-primary)] text-[var(--taply-night)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Icon name={o.icon} size={16} />
            {o.label}
          </button>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-[var(--text-muted)]">{t.walletNative.switchNote}</p>
    </fieldset>
  );
}

/** On-chain status in words + glyph. Local-only is never styled as active. */
export function TaplyStatusBadge({ state }: { readonly state: TaplyWalletState }) {
  const t = useT();
  const s = t.walletNative.status;
  if (state.status === 'provisioned') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--tone-success-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--taply-lime)]">
        <Icon name="check" size={13} />
        {s.provisioned.title}
      </span>
    );
  }
  if (state.status === 'local_only') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--tone-caution-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--tone-caution-fg)] ring-1 ring-[var(--tone-caution-border)]">
        <Icon name="alert" size={13} />
        {state.nameTaken ? s.nameTaken.title : s.localOnly.title}
      </span>
    );
  }
  if (state.status === 'unknown') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--tone-neutral-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--text-secondary)]">
        <Icon name="clock" size={13} />
        {s.unknown.title}
      </span>
    );
  }
  return null;
}

export function LockBadge() {
  const t = useT();
  const { unlocked } = useTaplyWallet();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
        unlocked ? 'bg-[var(--surface-2)] text-[var(--text-primary)] ring-1 ring-[var(--border-strong)]' : 'bg-[var(--tone-neutral-bg)] text-[var(--text-secondary)]'
      }`}
    >
      <Icon name={unlocked ? 'shield' : 'clock'} size={13} />
      {unlocked ? t.walletNative.lock.unlocked : t.walletNative.lock.locked}
    </span>
  );
}

/** Identity, status, lock state and (only when provisioned) the verified balance. */
export function TaplyIdentityCard({ actions }: { readonly actions?: ReactNode }) {
  const t = useT();
  const { locale } = useLocale();
  const { state, refresh } = useTaplyWallet();
  if (state.status !== 'local_only' && state.status !== 'unknown' && state.status !== 'provisioned') return null;
  const n = t.walletNative;
  const statusCopy =
    state.status === 'provisioned'
      ? n.status.provisioned
      : state.status === 'local_only'
        ? state.nameTaken
          ? n.status.nameTaken
          : n.status.localOnly
        : n.status.unknown;
  return (
    <section className="surface-hero p-5" aria-labelledby="taply-identity-title">
      <div className="flex items-start gap-3">
        <Monogram accountId={state.identity.accountId} size={44} />
        <div className="min-w-0 flex-1">
          <h2 id="taply-identity-title" className="flex items-center gap-1.5 text-sm font-semibold text-[var(--taply-lime)]">
            <Icon name="shield" size={15} />
            {n.taply}
          </h2>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <TaplyStatusBadge state={state} />
            <LockBadge />
          </div>
        </div>
      </div>

      <div className="mt-5">
        <p className="text-xs text-[var(--text-muted)]">{n.identityLabel}</p>
        <p className="chain-id mt-1 break-all text-sm text-[var(--text-primary)]">{state.identity.accountId}</p>
      </div>

      <div className="mt-5 border-t border-[var(--border-subtle)] pt-4" aria-live="polite">
        <p className="text-sm font-medium text-[var(--text-secondary)]">{t.walletUx.home.totalBalance}</p>
        {state.status === 'provisioned' ? (
          <>
            <AmountHero baseUnits={state.balance.amountYocto} className="mt-2" />
            <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <Icon name="check" size={14} className="text-[var(--taply-lime)]" />
              {fill(t.balance.verifiedAt, {
                time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(nsToDate(state.balance.blockTimestampNs)),
              })}
              <span className="sr-only">{fill(t.balance.finalBlock, { height: formatBaseUnits(state.balance.blockHeight, 0, { locale }).exact })}</span>
            </p>
          </>
        ) : (
          <p className="mt-2 text-lg font-semibold text-[var(--text-muted)]">{state.status === 'local_only' ? n.home.noBalance : '—'}</p>
        )}
        <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">{statusCopy.body}</p>
        {state.status === 'unknown' && (
          <Button variant="secondary" className="mt-3" onClick={refresh}>
            <Icon name="refresh" size={16} />
            {t.common.retry}
          </Button>
        )}
      </div>
      {actions !== undefined && <div className="mt-4">{actions}</div>}
    </section>
  );
}

export function TaplyErrorNotice({ code }: { readonly code: TaplyErrorCode | null }) {
  const t = useT();
  if (code === null) return null;
  return (
    <p role="alert" className="flex items-start gap-2 text-sm text-[var(--tone-danger-fg)]">
      <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
      {t.walletNative.errors[code]}
    </p>
  );
}

/** Password input with a show/hide toggle. Values never leave component state except to the controller. */
export function PassphraseField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  describedBy,
  invalid = false,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly autoComplete: 'new-password' | 'current-password';
  readonly describedBy?: string | undefined;
  readonly invalid?: boolean;
}) {
  const t = useT();
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="taply-input"
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
        />
        <Button variant="secondary" className="shrink-0" onClick={() => setVisible((v) => !v)} aria-pressed={visible} aria-controls={id}>
          {visible ? t.walletNative.createFlow.hide : t.walletNative.createFlow.show}
        </Button>
      </div>
    </div>
  );
}

export function UnlockForm() {
  const t = useT();
  const { unlock } = useTaplyWallet();
  const id = useId();
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TaplyErrorCode | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || passphrase === '') return;
    setBusy(true);
    setError(null);
    const result = await unlock(passphrase);
    setBusy(false);
    if (result.ok) setPassphrase('');
    else setError(result.code);
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="font-semibold">
        {t.walletNative.lock.unlockTitle}
      </h3>
      <PassphraseField
        id={id}
        label={t.walletNative.lock.passphrase}
        value={passphrase}
        onChange={setPassphrase}
        autoComplete="current-password"
        describedBy={error !== null ? `${id}-error` : undefined}
        invalid={error !== null}
      />
      <div id={`${id}-error`}>
        <TaplyErrorNotice code={error} />
      </div>
      <Button type="submit" size="lg" block disabled={busy || passphrase === ''}>
        {busy ? <Spinner /> : <Icon name="shield" size={18} />}
        {busy ? t.walletNative.lock.unlocking : t.walletNative.lock.unlock}
      </Button>
      <p className="text-xs text-[var(--text-muted)]">{t.walletNative.lock.autoLock}</p>
    </form>
  );
}

/** Downloads the ENCRYPTED vault record. No plaintext is ever produced. */
export function BackupDownloadButton({ onDownloaded, variant = 'primary' }: { readonly onDownloaded?: () => void; readonly variant?: 'primary' | 'secondary' }) {
  const t = useT();
  const { exportEncryptedBackup, state } = useTaplyWallet();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<TaplyErrorCode | null>(null);
  const accountId = state.status === 'local_only' || state.status === 'unknown' || state.status === 'provisioned' ? state.identity.accountId : 'wallet';
  return (
    <div className="flex flex-col gap-2">
      <Button
        size="lg"
        block
        variant={variant}
        onClick={() => {
          const result = exportEncryptedBackup();
          if (!result.ok) {
            setError(result.code);
            return;
          }
          const blob = new Blob([result.value], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `taply-testnet-wallet-backup-${isNamedTestnetAccount(accountId) ? accountId : accountId.slice(0, 8)}.json`;
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 0);
          setError(null);
          setDone(true);
          onDownloaded?.();
        }}
      >
        <Icon name={done ? 'check' : 'receive'} size={18} />
        {done ? t.walletNative.backup.downloaded : t.walletNative.backup.download}
      </Button>
      <TaplyErrorNotice code={error} />
    </div>
  );
}

/** Everything about Taply Wallet on /wallet. */
export function TaplyWalletPanel() {
  const t = useT();
  const n = t.walletNative;
  const { state, unlocked, lock } = useTaplyWallet();

  if (state.status === 'checking') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
        <Spinner /> {n.status.checking}
      </p>
    );
  }
  if (state.status === 'unavailable') return <InlineNotice copy={n.unavailable} tone="neutral" />;

  if (state.status === 'not_created') {
    return (
      <div className="flex flex-col gap-4">
        <section className="surface-hero p-5" aria-labelledby="taply-intro-title">
          <span className="grid size-12 place-items-center rounded-2xl bg-[var(--taply-lime)] text-[var(--taply-night)]">
            <Icon name="shield" size={24} />
          </span>
          <h2 id="taply-intro-title" className="mt-4 text-xl font-semibold tracking-tight">
            {n.intro.title}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-secondary)]">{n.intro.body}</p>
          <ul className="mt-4 flex flex-col gap-2.5">
            {[n.point1, n.point2, n.point3].map((point) => (
              <li key={point} className="flex items-start gap-2.5 text-sm leading-relaxed">
                <Icon name="check" size={16} className="mt-0.5 shrink-0 text-[var(--taply-lime)]" />
                {point}
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-col gap-2">
            <ButtonLink href="/wallet/create" variant="primary" size="lg" block>
              <Icon name="shield" size={18} />
              {n.create}
            </ButtonLink>
            <ButtonLink href="/wallet/restore" variant="secondary" size="lg" block>
              <Icon name="refresh" size={18} />
              {n.restore}
            </ButtonLink>
          </div>
        </section>
      </div>
    );
  }

  const provisioned = state.status === 'provisioned';
  return (
    <div className="flex flex-col gap-4">
      <TaplyIdentityCard />
      {state.status === 'local_only' && (
        <section className="surface-card p-5" aria-label={n.username.finishSetup}>
          <ActivationPanel />
        </section>
      )}
      <section className="surface-card p-5">
        {unlocked ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[var(--text-secondary)]">{n.lock.autoLock}</p>
            <Button variant="secondary" size="lg" block onClick={lock}>
              <Icon name="clock" size={18} />
              {n.lock.lockNow}
            </Button>
          </div>
        ) : (
          <UnlockForm />
        )}
      </section>
      <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
        <ButtonLink href="/receive" size="lg" block>
          <Icon name="receive" size={18} />
          {t.home.receive}
        </ButtonLink>
        {provisioned ? (
          <ButtonLink href="/send" size="lg" block>
            <Icon name="send" size={18} />
            {t.home.send}
          </ButtonLink>
        ) : (
          // Visibly disabled: a local-only identity has no account and cannot send.
          <Button size="lg" block variant="secondary" disabled aria-describedby="taply-send-disabled">
            <Icon name="send" size={18} />
            {t.home.send}
          </Button>
        )}
      </div>
      {!provisioned && (
        <p id="taply-send-disabled" className="-mt-2 px-1 text-xs text-[var(--text-muted)]">
          {n.send.notActive.title}
        </p>
      )}
      <section className="surface-card flex flex-col gap-3 p-5" aria-labelledby="taply-backup-title">
        <h3 id="taply-backup-title" className="font-semibold">
          {n.backup.download}
        </h3>
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{n.backup.body}</p>
        <p className="text-xs leading-relaxed text-[var(--text-muted)]">{n.backup.fileWarning}</p>
        <BackupDownloadButton variant="secondary" />
      </section>
      {provisioned && CHAIN_CONFIG.ok && (
        <ButtonLink href={explorerAccountUrl(CHAIN_CONFIG.explorerBaseUrl, state.identity.accountId)} external variant="ghost" block>
          {t.home.viewOnExplorer}
          <Icon name="external" size={16} />
        </ButtonLink>
      )}
      <p className="px-1 text-xs text-[var(--text-muted)]">
        {n.paymentsNote}{' '}
        <Link href="/request/new" className="underline underline-offset-2">
          {t.home.request}
        </Link>
      </p>
    </div>
  );
}
