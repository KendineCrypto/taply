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
import { PassphraseField, TaplyErrorNotice, TaplyStatusBadge } from './TaplyWalletUi';
import { PhraseGrid } from './RecoveryPhrase';
import { ActivationPanel, UsernameForm } from './UsernameActivation';
import { useWalletMode } from './mode';
import { passphraseProblem, passphraseStrength } from './passphrase';
import type { PassphraseStrength } from './passphrase';

/**
 * Create Taply Wallet (owner decision 2026-11-09): 1) understand the risks,
 * 2) choose a free `username.testnet` (FINAL availability read), 3) create a
 * password: a 12-word Secret Recovery Phrase is generated and the wallet is
 * encrypted on this device, bound to that name, 4) the user saves the phrase
 * (Phantom-style, no backup file), then the Testnet faucet creates the account
 * and FINAL reads confirm it holds the key.
 * The wallet stays locked throughout; nothing is called "active" before step 4
 * is confirmed on chain. No sponsored gas.
 */
type Step = 'understand' | 'username' | 'passphrase' | 'phrase' | 'activate';

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
  const { state, createNamed, revealPhrase } = useTaplyWallet();
  const [step, setStep] = useState<Step>('understand');
  const [accountId, setAccountId] = useState('');
  const [createdHere, setCreatedHere] = useState(false);
  const [acks, setAcks] = useState([false, false, false]);
  const [passphrase, setPassphrase] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TaplyErrorCode | null>(null);
  const [words, setWords] = useState<readonly string[]>([]);
  const [saved, setSaved] = useState(false);
  const passId = useId();
  const repeatId = useId();
  const savedId = useId();

  if (state.status === 'unavailable') return <InlineNotice copy={n.unavailable} tone="neutral" />;
  if (!createdHere && (state.status === 'local_only' || state.status === 'provisioned' || state.status === 'unknown')) {
    return (
      <InlineNotice
        copy={{ title: n.createdAlready, body: n.restoreFlow.restored }}
        tone="neutral"
        action={<ButtonLink href="/wallet">{n.taply}</ButtonLink>}
      />
    );
  }

  const stepIndex = step === 'understand' ? 1 : step === 'username' ? 2 : step === 'passphrase' ? 3 : 4;
  const problem = passphraseProblem(passphrase);
  const strength = passphraseStrength(passphrase);
  const mismatch = repeat !== '' && repeat !== passphrase;
  const canCreate = problem === null && repeat === passphrase && !busy;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="eyebrow text-[var(--text-muted)]">{fill(c.stepOf, { n: String(stepIndex) })}</p>
        <div className="mt-2 grid grid-cols-4 gap-1" aria-hidden="true">
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className={`h-1 rounded-full transition-colors duration-300 ${i <= stepIndex ? 'bg-[var(--taply-lime)]' : 'bg-[var(--border-subtle)]'}`} />
          ))}
        </div>
      </div>

      {step === 'understand' && (
        <section key="understand" className="animate-page flex flex-col gap-4" aria-labelledby="understand-title">
          <h2 id="understand-title" className="text-xl font-semibold tracking-tight">
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
          <Button size="lg" block disabled={!acks.every(Boolean)} onClick={() => setStep('username')}>
            {c.continue}
            <Icon name="arrow-right" size={18} />
          </Button>
        </section>
      )}

      {step === 'username' && (
        <section key="username" className="animate-page flex flex-col gap-4" aria-labelledby="username-title">
          <div className="flex flex-col gap-1.5">
            <h2 id="username-title" className="text-xl font-semibold tracking-tight">
              {n.username.title}
            </h2>
            <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{n.username.body}</p>
          </div>
          <UsernameForm
            submitLabel={c.continue}
            onAvailable={(id) => {
              setAccountId(id);
              setStep('passphrase');
            }}
          />
          <p className="text-xs leading-relaxed text-[var(--text-muted)]">{n.username.noGas}</p>
          <Button variant="ghost" block onClick={() => setStep('understand')}>
            <Icon name="arrow-left" size={18} />
            {c.back}
          </Button>
        </section>
      )}

      {step === 'passphrase' && (
        <form
          key="passphrase"
          className="animate-page flex flex-col gap-4"
          aria-labelledby="pass-title"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            if (!canCreate) return;
            setBusy(true);
            setError(null);
            setCreatedHere(true);
            const result = await createNamed(passphrase, accountId);
            if (!result.ok) {
              setBusy(false);
              setCreatedHere(false);
              setError(result.code);
              return;
            }
            const phrase = await revealPhrase(passphrase);
            setBusy(false);
            // The password is not kept once the vault exists.
            setPassphrase('');
            setRepeat('');
            if (!phrase.ok) {
              setError(phrase.code);
              return;
            }
            setWords(phrase.value);
            setStep('phrase');
          }}
        >
          <h2 id="pass-title" className="text-xl font-semibold tracking-tight">
            {c.passTitle}
          </h2>
          <p className="text-sm text-[var(--text-secondary)]">
            {n.identityLabel}: <span className="chain-id break-all text-[var(--text-primary)]">{accountId}</span>
          </p>
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
          <Button variant="ghost" block disabled={busy} onClick={() => setStep('username')}>
            <Icon name="arrow-left" size={18} />
            {c.back}
          </Button>
        </form>
      )}

      {step === 'phrase' && (
        <section key="phrase" className="animate-page flex flex-col gap-4" aria-labelledby="phrase-title">
          <div className="flex flex-col gap-1.5">
            <h2 id="phrase-title" className="text-xl font-semibold tracking-tight">
              {n.phrase.title}
            </h2>
            <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{n.phrase.body}</p>
          </div>
          <PhraseGrid words={words} />
          <p className="flex items-start gap-2 text-sm font-medium text-[var(--tone-caution-fg)]" role="note">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
            {n.phrase.warning}
          </p>
          <p className="text-xs leading-relaxed text-[var(--text-muted)]">{n.phrase.compatible}</p>
          <label htmlFor={savedId} className="flex min-h-[var(--tap-target)] cursor-pointer items-start gap-3 text-sm leading-relaxed">
            <input
              id={savedId}
              type="checkbox"
              checked={saved}
              onChange={(e) => setSaved(e.target.checked)}
              className="mt-0.5 size-5 shrink-0 accent-[var(--taply-lime)]"
            />
            {n.phrase.saved}
          </label>
          <Button
            size="lg"
            block
            disabled={!saved}
            onClick={() => {
              // Drop the words from memory once the user confirmed saving them.
              setWords([]);
              setStep('activate');
            }}
          >
            {n.phrase.continue}
            <Icon name="arrow-right" size={18} />
          </Button>
        </section>
      )}

      {step === 'activate' && (
        <section key="activate" className="animate-page flex flex-col gap-4" aria-labelledby="activate-title">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="activate-title" className="text-xl font-semibold tracking-tight">
              {state.status === 'provisioned' ? fill(n.username.activeTitle, { account: state.identity.accountId }) : c.createdTitle}
            </h2>
            {/* While the account is being activated, the progress line below says so; no "local only" warning. */}
            {state.status === 'provisioned' && <TaplyStatusBadge state={state} />}
          </div>
          {state.status === 'provisioned' ? (
            <>
              <p className="text-sm text-[var(--text-secondary)]">{n.username.activeBody}</p>
              <Button
                size="lg"
                block
                onClick={() => {
                  setMode('taply');
                  router.push('/');
                }}
              >
                {n.backup.finish}
              </Button>
            </>
          ) : (
            <ActivationPanel autoStart />
          )}
        </section>
      )}
    </div>
  );
}
