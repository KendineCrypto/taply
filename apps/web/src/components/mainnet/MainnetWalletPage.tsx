'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useId, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { mainnetSpendingBudget } from '@taply/near-client';
import { Monogram } from '@/components/experience/Basics';
import { Button, ButtonLink, Spinner } from '@/components/primitives/Button';
import { ScreenHeader } from '@/components/primitives/Surface';
import { QrCode } from '@/components/payments/QrCode';
import { Icon } from '@/components/shell/Icons';
import { AccountChip } from '@/components/wallet/AccountChip';
import { PassphraseField } from '@/components/wallet/PassphraseField';
import { PhraseGrid } from '@/components/wallet/PhraseGrid';
import { WalletKindBadge } from '@/components/wallet/WalletKind';
import { IdentityCardView, WalletModeSwitchView, WalletStatusPill } from '@/components/wallet/WalletHomeViews';
import { fill } from '@/lib/i18n/fill';
import { useT } from '@/lib/i18n/provider';
import { formatMainnetAmount, MAINNET_ASSETS } from '@/lib/mainnet/assets';
import { useMainnetLocale } from '@/lib/mainnet/copy';
import { nearAccountUrl } from '@/lib/mainnet/explorer';
import { useMainnetWallet } from '@/lib/mainnet/wallet';
import { Notice, Row } from './bits';
import { NoWalletCard } from './NoWalletCard';
import { forgetTaplyWallet, useActivation, useMainnetVault, useUnresolvedAttempt, useWalletCopy, vault, vaultError } from './Wallet';

/**
 * NEAR Mainnet wallet management in the Testnet layout (app/wallet + TaplyWalletPanel):
 * external / Taply Wallet switch, identity card, lock/unlock, big Receive/Send buttons;
 * technical evidence (available, reserves, final block) folded under Details.
 * Data: the Mainnet vault and FINAL-block activation reads only.
 */
type Activation = ReturnType<typeof useActivation>;

/** Testnet identity card fed with the Mainnet vault identity and activation read. */
export function MainnetIdentityCard({ activation, onRefresh, actions, extra }: {
  readonly activation: Activation;
  readonly onRefresh: () => void;
  readonly actions?: ReactNode;
  readonly extra?: ReactNode;
}) {
  const t = useT();
  const n = t.walletNative;
  const { identity, unlocked } = useMainnetVault();
  if (identity === null) return null;
  const active = activation.kind === 'active' ? activation : null;
  const statusPill = active
    ? <WalletStatusPill tone="success" icon="check" label={n.status.provisioned.title} />
    : activation.kind === 'not_activated'
      ? <WalletStatusPill tone="caution" icon="alert" label={n.status.localOnly.title} />
      : <WalletStatusPill tone="neutral" icon="clock" label={n.status.unknown.title} />;
  const lockPill = (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${unlocked ? 'bg-[var(--surface-2)] text-[var(--text-primary)] ring-1 ring-[var(--border-strong)]' : 'bg-[var(--tone-neutral-bg)] text-[var(--text-secondary)]'}`}>
      <Icon name={unlocked ? 'shield' : 'clock'} size={13} />
      {unlocked ? n.lock.unlocked : n.lock.locked}
    </span>
  );
  return (
    <IdentityCardView
      accountId={identity.accountId}
      badges={<><span data-testid="activation" data-state={activation.kind} className="contents">{statusPill}</span>{lockPill}</>}
      balance={active ? { baseUnits: active.snapshot.amountYocto, blockTimestampNs: active.snapshot.blockTimestampNs, blockHeight: active.snapshot.blockHeight } : null}
      emptyBalance={activation.kind === 'not_activated' ? n.home.noBalance : '—'}
      statusBody={active ? n.status.provisioned.body : activation.kind === 'not_activated' ? n.status.localOnly.body : n.status.unknown.body}
      onRefresh={onRefresh}
      {...(activation.kind === 'unreadable' ? { onRetry: onRefresh } : {})}
      {...(actions !== undefined ? { actions } : {})}
      {...(extra !== undefined ? { extra } : {})}
    />
  );
}

export function MainnetWalletPage() {
  const { identity } = useMainnetVault();
  const external = useMainnetWallet();
  const [choice, setChoice] = useState<'external' | 'taply' | null>(null);
  const mode = choice ?? (identity === null && external.accountId !== null ? 'external' : 'taply');
  const t = useT();
  return (
    <>
      <div className="mb-5">
        <WalletModeSwitchView mode={mode} onChange={setChoice} />
      </div>
      {mode === 'taply' ? (
        <>
          <ScreenHeader title={t.walletNative.taply} description={t.walletNative.intro.body} />
          <TaplyPanel />
        </>
      ) : (
        <ExternalPanel />
      )}
    </>
  );
}

function TaplyPanel() {
  const t = useT();
  const n = t.walletNative;
  const c = useWalletCopy();
  const { locale } = useMainnetLocale();
  const { identity, unlocked } = useMainnetVault();
  const [tick, setTick] = useState(0);
  // Unlocking changes no chain state: re-render only (the vault does not notify on unlock).
  // Re-reading activation stays an explicit user action ("Check again"), e.g. after funding.
  const [, setRendered] = useState(0);
  const activation = useActivation(identity, tick);
  const attempt = useUnresolvedAttempt(identity?.accountId ?? null);

  if (identity === null) {
    return (
      <div className="flex flex-col gap-4">
        <section className="surface-hero p-5" aria-labelledby="taply-intro-title" data-testid="taply-wallet-empty">
          <span className="grid size-12 place-items-center rounded-2xl bg-[var(--taply-lime)] text-[var(--taply-night)]">
            <Icon name="shield" size={24} />
          </span>
          <h2 id="taply-intro-title" className="mt-4 text-xl font-semibold tracking-tight">{n.intro.title}</h2>
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
            <ButtonLink href="/m/wallet/create" variant="primary" size="lg" block>
              <Icon name="shield" size={18} />
              {n.create}
            </ButtonLink>
            <ButtonLink href="/m/wallet/restore" variant="secondary" size="lg" block>
              <Icon name="refresh" size={18} />
              {n.restore}
            </ButtonLink>
          </div>
        </section>
      </div>
    );
  }

  const active = activation.kind === 'active' ? activation : null;
  const spendable = active !== null ? mainnetSpendingBudget(active.snapshot, '0') : null;
  const explorer = nearAccountUrl(identity.accountId);
  return (
    <div className="flex flex-col gap-4" data-testid="taply-wallet">
      <MainnetIdentityCard activation={activation} onRefresh={() => setTick((x) => x + 1)} />
      {activation.kind === 'not_activated' && (
        <section className="surface-card flex flex-col items-center gap-3 p-5 text-center" aria-label={n.username.finishSetup}>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{c.activationHelp}</p>
          <QrCode value={identity.accountId} label={n.identityLabel} />
          <Button variant="secondary" block onClick={() => setTick((x) => x + 1)}>
            <Icon name="refresh" size={16} />
            {c.refresh}
          </Button>
        </section>
      )}
      {attempt === 'unresolved' && <Notice tone="caution" live testId="attempt-unresolved">{c.unresolved}</Notice>}
      {attempt === 'unavailable' && <Notice tone="danger" live>{c.journalUnavailable}</Notice>}
      <section className="surface-card p-5">
        {unlocked ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[var(--text-secondary)]" data-testid="unlocked">{n.lock.autoLock}</p>
            <Button variant="secondary" size="lg" block onClick={() => vault().lock()}>
              <Icon name="clock" size={18} />
              {n.lock.lockNow}
            </Button>
          </div>
        ) : (
          <MainnetUnlockForm onUnlocked={() => setRendered((x) => x + 1)} />
        )}
      </section>
      <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
        <ButtonLink href="/m/receive" size="lg" block>
          <Icon name="receive" size={18} />
          {t.home.receive}
        </ButtonLink>
        {active !== null ? (
          <ButtonLink href="/m/send" size="lg" block>
            <Icon name="send" size={18} />
            {t.home.send}
          </ButtonLink>
        ) : (
          <Button size="lg" block variant="secondary" disabled aria-describedby="taply-send-disabled">
            <Icon name="send" size={18} />
            {t.home.send}
          </Button>
        )}
      </div>
      {active === null && (
        <p id="taply-send-disabled" className="-mt-2 px-1 text-xs text-[var(--text-muted)]">{n.send.notActive.title}</p>
      )}
      {active !== null && explorer !== null && (
        <ButtonLink href={explorer as Route} external variant="ghost" block>
          {t.home.viewOnExplorer}
          <Icon name="external" size={16} />
        </ButtonLink>
      )}
      {identity.recovery === 'RECOVERY_PHRASE' && <MainnetShowPhrasePanel />}
      <MainnetDisconnectPanel blocked={attempt === 'unresolved'} />
      <details className="disclosure rounded-[var(--radius-card)] bg-[var(--surface-1)] px-4 py-1">
        <summary className="flex min-h-[var(--tap-target)] cursor-pointer items-center text-sm text-[var(--text-secondary)]">{t.oneTap.payment.details}</summary>
        <dl className="pb-3">
          <Row label={c.account} mono>{identity.accountId}</Row>
          <Row label={c.status}>{activation.kind === 'checking' ? c.checking : activation.kind === 'not_activated' ? c.notActivated : activation.kind === 'active' ? c.activated : c.unreadable}</Row>
          {active !== null && spendable !== null && (
            <>
              <Row label={c.balance}>{formatMainnetAmount(active.snapshot.amountYocto, MAINNET_ASSETS.NEAR, locale)}</Row>
              <Row label={c.available}><span data-testid="available">{formatMainnetAmount(spendable.availableYocto, MAINNET_ASSETS.NEAR, locale)}</span></Row>
              <Row label={c.reserved}>{formatMainnetAmount((BigInt(spendable.storageReserveYocto) + BigInt(spendable.gasReserveYocto)).toString(), MAINNET_ASSETS.NEAR, locale)}</Row>
              {active.usdc !== null && <Row label="USDC">{formatMainnetAmount(active.usdc, MAINNET_ASSETS.USDC, locale)}</Row>}
              <Row label={c.finalBlock} mono>{active.snapshot.blockHeight}</Row>
            </>
          )}
        </dl>
      </details>
      <p className="px-1 text-xs text-[var(--text-muted)]">
        {n.paymentsNote}{' '}
        <Link href="/m/request/new" className="underline underline-offset-2">{t.home.request}</Link>
      </p>
    </div>
  );
}

/** Testnet UnlockForm markup; unlocks the Mainnet vault. */
/**
 * Testnet ShowPhrasePanel on the Mainnet vault: the password is checked by
 * `revealRecoveryPhrase` (decrypts the encrypted entropy); the words live only in this
 * component's state, blurred until tapped, and are dropped when hidden or unmounted.
 */
function MainnetShowPhrasePanel() {
  const t = useT();
  const p = t.walletNative.phrase;
  const c = useWalletCopy();
  const id = useId();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [words, setWords] = useState<readonly string[] | null>(null);
  return (
    <section className="surface-card flex flex-col gap-3 p-5" aria-labelledby={`${id}-title`} data-testid="show-phrase">
      <h3 id={`${id}-title`} className="font-semibold">{p.showTitle}</h3>
      {words === null ? (
        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || password === '') return;
            setBusy(true);
            setError('');
            try { setWords(await vault().revealRecoveryPhrase(password)); }
            catch (err) { setError(vaultError(c, err)); }
            finally { setBusy(false); setPassword(''); }
          }}
        >
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{p.showBody}</p>
          <PassphraseField id={`${id}-pass`} label={t.walletNative.lock.passphrase} value={password} onChange={setPassword} autoComplete="current-password" />
          {error !== '' && (
            <p role="alert" className="flex items-start gap-2 text-sm text-[var(--tone-danger-fg)]">
              <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
          <Button type="submit" variant="secondary" size="lg" block disabled={busy || password === ''}>
            {busy ? <Spinner /> : <Icon name="shield" size={18} />}
            {p.showButton}
          </Button>
        </form>
      ) : (
        <>
          <p className="text-sm font-medium text-[var(--tone-caution-fg)]">{p.warning}</p>
          <PhraseGrid words={words} />
          <Button variant="ghost" block onClick={() => setWords(null)}>{p.hide}</Button>
        </>
      )}
    </section>
  );
}

/**
 * Disconnect = remove the Taply Wallet from this browser (forgetTaplyWallet).
 * Needs the recovery-phrase acknowledgement and the password; never touches the
 * chain or the device payment ledger. A full reload afterwards starts every view clean.
 */
function MainnetDisconnectPanel({ blocked }: { readonly blocked: boolean }) {
  const t = useT();
  const c = useWalletCopy();
  const d = c.disconnect;
  const id = useId();
  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!open) {
    return (
      <Button variant="ghost" block onClick={() => setOpen(true)} data-testid="taply-disconnect-open">
        <Icon name="logout" size={18} />
        {d.open}
      </Button>
    );
  }
  return (
    <section className="surface-card flex flex-col gap-3 p-5" aria-labelledby={`${id}-title`} data-testid="taply-disconnect">
      <h3 id={`${id}-title`} className="font-semibold">{d.title}</h3>
      <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{d.body}</p>
      <p className="text-xs leading-relaxed text-[var(--text-muted)]">{d.keepsLedger}</p>
      {blocked ? (
        <p role="alert" className="text-sm text-[var(--tone-caution-fg)]" data-testid="taply-disconnect-blocked">{d.blocked}</p>
      ) : (
        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || !ack || password === '') return;
            setBusy(true);
            setError('');
            try {
              await forgetTaplyWallet(password);
              window.location.assign('/m/wallet');
            } catch (err) {
              setError(vaultError(c, err));
              setBusy(false);
            } finally { setPassword(''); }
          }}
        >
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 accent-[var(--taply-lime)]" data-testid="taply-disconnect-ack" />
            {d.confirm}
          </label>
          <PassphraseField id={`${id}-pass`} label={d.password} value={password} onChange={setPassword} autoComplete="current-password" />
          {error !== '' && (
            <p role="alert" className="flex items-start gap-2 text-sm text-[var(--tone-danger-fg)]">
              <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
          <Button type="submit" variant="secondary" size="lg" block disabled={busy || !ack || password === ''} data-testid="taply-disconnect-confirm">
            {busy ? <Spinner /> : <Icon name="logout" size={18} />}
            {d.button}
          </Button>
        </form>
      )}
      <Button variant="ghost" block onClick={() => { setOpen(false); setAck(false); setPassword(''); setError(''); }}>{d.cancel}</Button>
      <span className="sr-only">{t.wallet.disconnect}</span>
    </section>
  );
}

/** The vault notifies subscribers on lock only, so the caller re-renders itself after an unlock. */
function MainnetUnlockForm({ onUnlocked }: { readonly onUnlocked: () => void }) {
  const t = useT();
  const c = useWalletCopy();
  const id = useId();
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || passphrase === '') return;
    setBusy(true);
    setError('');
    try {
      await vault().unlock(passphrase);
      setPassphrase('');
      onUnlocked();
    } catch (err) {
      setError(vaultError(c, err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="font-semibold">{t.walletNative.lock.unlockTitle}</h3>
      <PassphraseField
        id="mw-unlock"
        label={t.walletNative.lock.passphrase}
        value={passphrase}
        onChange={setPassphrase}
        autoComplete="current-password"
        describedBy={error !== '' ? `${id}-error` : undefined}
        invalid={error !== ''}
      />
      <div id={`${id}-error`}>
        {error !== '' && (
          <p role="alert" data-testid="wallet-error" className="flex items-start gap-2 text-sm text-[var(--tone-danger-fg)]">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}
      </div>
      <Button type="submit" size="lg" block disabled={busy || passphrase === ''} data-testid="wallet-unlock">
        {busy ? <Spinner /> : <Icon name="shield" size={18} />}
        {busy ? t.walletNative.lock.unlocking : t.walletNative.lock.unlock}
      </Button>
      <p className="text-xs text-[var(--text-muted)]">{t.walletNative.lock.autoLock}</p>
    </form>
  );
}

/** Testnet external-wallet panel with the Mainnet NEAR Connect session. */
function ExternalPanel() {
  const t = useT();
  const o = t.walletUx.onboarding;
  const w = useMainnetWallet();
  if (w.status !== 'connected' || w.accountId === null) {
    return (
      <>
        <header className="mb-5 mt-1">
          <p className="eyebrow text-[var(--text-muted)]">{o.eyebrow}</p>
          <h1 className="mt-2 text-[1.75rem] font-semibold leading-tight tracking-tight">{o.title}</h1>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-[var(--text-secondary)]">{o.subtitle}</p>
        </header>
        <NoWalletCard text={t.wallet.connectBody} />
        <p className="mt-4 flex items-start gap-2 px-1 text-xs leading-relaxed text-[var(--text-muted)]">
          <Icon name="check" size={14} className="mt-0.5 shrink-0 text-[var(--taply-lime)]" />
          {t.wallet.noKeysNote}
        </p>
      </>
    );
  }
  const accountId = w.accountId;
  const walletName = w.walletName ?? 'NEAR wallet';
  const explorer = nearAccountUrl(accountId);
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
          <ButtonLink href="/m/receive" size="lg" block>
            <Icon name="receive" size={18} />
            {t.home.receive}
          </ButtonLink>
          {explorer !== null && (
            <ButtonLink href={explorer as Route} external size="lg" block>
              {t.home.viewOnExplorer}
              <Icon name="external" size={16} />
            </ButtonLink>
          )}
        </div>
        <Button variant="ghost" block onClick={() => void w.disconnect()}>
          <Icon name="logout" size={18} />
          {t.wallet.disconnect}
        </Button>
      </div>
    </>
  );
}

