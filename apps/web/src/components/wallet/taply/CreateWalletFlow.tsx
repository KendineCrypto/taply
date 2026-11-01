'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { Button, ButtonLink, Spinner } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import { fill } from '@/lib/i18n';
import { useT } from '@/lib/i18n/provider';
import { useTaplyWallet } from './TaplyWalletProvider';
import type { TaplyErrorCode } from './TaplyWalletProvider';
import { BackupDownloadButton, PassphraseField, TaplyErrorNotice, TaplyStatusBadge } from './TaplyWalletUi';
import { useWalletMode } from './mode';
import { passphraseProblem, passphraseStrength } from './passphrase';
import type { PassphraseStrength } from './passphrase';

/**
 * Create Taply Wallet: 1) understand the risks, 2) choose a passphrase,
 * 3) download the encrypted backup and confirm (mandatory before finishing).
 * Key generation and encryption happen inside the controller; the new wallet
 * is LOCAL ONLY and locked.
 */
type Step = 'understand' | 'passphrase' | 'backup';

const STRENGTH_STYLE: Readonly<Record<PassphraseStrength, { bars: number; color: string }>> = {
  weak: { bars: 1, color: 'bg-[var(--taply-clay)]' },
  fair: { bars: 2, color: 'bg-[var(--taply-gold)]' },
  strong: { bars: 3, color: 'bg-[var(--text-primary)]' },
  excellent: { bars: 4, color: 'bg-[var(--taply-lime)]' },
};

export function CreateWalletFlow() {
  const t = useT();
  const n = t.walletNative;
  const c = n.createFlow;
  const router = useRouter();
  const [, setMode] = useWalletMode();
  const { state, create } = useTaplyWallet();
  const [step, setStep] = useState<Step>('understand');
  const [acks, setAcks] = useState([false, false, false]);
  const [passphrase, setPassphrase] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TaplyErrorCode | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const passId = useId();
  const repeatId = useId();
  const savedId = useId();

  if (state.status === 'unavailable') return <InlineNotice copy={n.unavailable} tone="neutral" />;
  if (step !== 'backup' && (state.status === 'local_only' || state.status === 'provisioned' || state.status === 'unknown')) {
    return (
      <InlineNotice
        copy={{ title: n.createdAlready, body: n.restoreFlow.restored }}
        tone="neutral"
        action={<ButtonLink href="/wallet">{n.taply}</ButtonLink>}
      />
    );
  }

  const stepIndex = step === 'understand' ? 1 : step === 'passphrase' ? 2 : 3;
  const problem = passphraseProblem(passphrase);
  const strength = passphraseStrength(passphrase);
  const mismatch = repeat !== '' && repeat !== passphrase;
  const canCreate = problem === null && repeat === passphrase && !busy;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="eyebrow text-[var(--text-muted)]">{fill(c.stepOf, { n: String(stepIndex) })}</p>
        <div className="mt-2 grid grid-cols-3 gap-1.5" aria-hidden="true">
          {[1, 2, 3].map((i) => (
            <span key={i} className={`h-1.5 rounded-full ${i <= stepIndex ? 'bg-[var(--taply-lime)]' : 'bg-[var(--border-strong)]'}`} />
          ))}
        </div>
      </div>

      {step === 'understand' && (
        <section className="surface-card flex flex-col gap-4 p-5" aria-labelledby="understand-title">
          <h2 id="understand-title" className="text-lg font-semibold">
            {c.understandTitle}
          </h2>
          {[c.ack1, c.ack2, c.ack3].map((label, i) => (
            <label key={label} className="flex min-h-[var(--tap-target)] cursor-pointer items-start gap-3 text-sm leading-relaxed">
              <input
                type="checkbox"
                checked={acks[i] ?? false}
                onChange={(e) => setAcks((a) => a.map((v, j) => (j === i ? e.target.checked : v)))}
                className="mt-0.5 size-5 shrink-0 accent-[var(--taply-lime)]"
              />
              {label}
            </label>
          ))}
          <Button size="lg" block disabled={!acks.every(Boolean)} onClick={() => setStep('passphrase')}>
            {c.continue}
            <Icon name="arrow-right" size={18} />
          </Button>
        </section>
      )}

      {step === 'passphrase' && (
        <form
          className="surface-card flex flex-col gap-4 p-5"
          aria-labelledby="pass-title"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            if (!canCreate) return;
            setBusy(true);
            setError(null);
            const result = await create(passphrase);
            setBusy(false);
            if (!result.ok) {
              setError(result.code);
              return;
            }
            // The passphrase is not kept once the vault exists.
            setPassphrase('');
            setRepeat('');
            setStep('backup');
          }}
        >
          <h2 id="pass-title" className="text-lg font-semibold">
            {c.passTitle}
          </h2>
          <PassphraseField
            id={passId}
            label={c.passLabel}
            value={passphrase}
            onChange={setPassphrase}
            autoComplete="new-password"
            describedBy={`${passId}-hint ${passId}-strength`}
            invalid={passphrase !== '' && problem !== null}
          />
          <p id={`${passId}-hint`} className={`text-xs ${passphrase !== '' && problem !== null ? 'text-[var(--tone-danger-fg)]' : 'text-[var(--text-muted)]'}`}>
            {passphrase !== '' && problem === 'too_short' ? c.tooShort : problem === 'too_long' ? c.tooLong : c.passHint}
          </p>
          <div id={`${passId}-strength`} aria-live="polite">
            <div className="grid grid-cols-4 gap-1" aria-hidden="true">
              {[1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full ${passphrase !== '' && i <= STRENGTH_STYLE[strength].bars ? STRENGTH_STYLE[strength].color : 'bg-[var(--border-strong)]'}`}
                />
              ))}
            </div>
            {passphrase !== '' && (
              <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
                {c.strengthLabel}: {c.strength[strength]}
              </p>
            )}
          </div>
          <PassphraseField
            id={repeatId}
            label={c.confirmLabel}
            value={repeat}
            onChange={setRepeat}
            autoComplete="new-password"
            describedBy={mismatch ? `${repeatId}-mismatch` : undefined}
            invalid={mismatch}
          />
          {mismatch && (
            <p id={`${repeatId}-mismatch`} role="alert" className="text-sm text-[var(--tone-danger-fg)]">
              {c.mismatch}
            </p>
          )}
          <TaplyErrorNotice code={error} />
          <Button type="submit" size="lg" block disabled={!canCreate}>
            {busy ? <Spinner /> : <Icon name="shield" size={18} />}
            {busy ? c.creating : c.createButton}
          </Button>
          <Button variant="ghost" block disabled={busy} onClick={() => setStep('understand')}>
            <Icon name="arrow-left" size={18} />
            {c.back}
          </Button>
        </form>
      )}

      {step === 'backup' && (
        <section className="flex flex-col gap-4" aria-labelledby="backup-title">
          <div className="surface-card flex flex-col gap-2 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="backup-title" className="text-lg font-semibold">
                {c.createdTitle}
              </h2>
              <TaplyStatusBadge state={state} />
            </div>
            <p className="text-sm text-[var(--text-secondary)]">{c.createdBody}</p>
          </div>
          <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--tone-caution-border)] bg-[var(--tone-caution-bg)] p-5" role="note">
            <p className="flex items-center gap-2 font-semibold text-[var(--tone-caution-fg)]">
              <Icon name="alert" size={18} />
              {n.backup.title}
            </p>
            <p className="text-sm leading-relaxed text-[var(--text-primary)]">{n.backup.body}</p>
            <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{n.backup.fileWarning}</p>
          </div>
          <BackupDownloadButton onDownloaded={() => setDownloaded(true)} />
          <label htmlFor={savedId} className={`flex min-h-[var(--tap-target)] items-start gap-3 text-sm leading-relaxed ${downloaded ? 'cursor-pointer' : 'text-[var(--text-muted)]'}`}>
            <input
              id={savedId}
              type="checkbox"
              checked={saved}
              disabled={!downloaded}
              onChange={(e) => setSaved(e.target.checked)}
              className="mt-0.5 size-5 shrink-0 accent-[var(--taply-lime)]"
              aria-describedby={downloaded ? undefined : `${savedId}-required`}
            />
            {n.backup.confirm}
          </label>
          {!downloaded && (
            <p id={`${savedId}-required`} className="text-xs text-[var(--text-muted)]">
              {n.backup.required}
            </p>
          )}
          <Button
            size="lg"
            block
            disabled={!downloaded || !saved}
            onClick={() => {
              setMode('taply');
              router.push('/wallet');
            }}
          >
            {n.backup.finish}
          </Button>
        </section>
      )}
    </div>
  );
}
