'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { normalizePhrase, RECOVERY_WORDS } from '@taply/near-client';
import { Button, Spinner } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import { fill } from '@/lib/i18n';
import { useT } from '@/lib/i18n/provider';
import { normalizeUsername, usernameAccountId, usernameProblem } from '@/lib/wallet/testnet-account';
import { useTaplyWallet } from './TaplyWalletProvider';
import type { TaplyErrorCode } from './TaplyWalletProvider';
import { PassphraseField, TaplyErrorNotice } from './TaplyWalletUi';
import { useWalletMode } from './mode';
import { passphraseProblem } from './passphrase';

/**
 * Secret Recovery Phrase UI (Phantom-style): 12 numbered words, hidden until the
 * user taps, optional copy. Words live only in component state and are dropped
 * when hidden or unmounted; they are never logged, stored or sent.
 */
export function PhraseGrid({ words }: { readonly words: readonly string[] }) {
  const t = useT();
  const p = t.walletNative.phrase;
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-[var(--radius-control)] ring-1 ring-[var(--border-strong)]">
        <ol
          aria-label={p.title}
          aria-hidden={!revealed || undefined}
          className={`grid grid-cols-2 gap-2 p-3 min-[380px]:grid-cols-3 ${revealed ? '' : 'select-none blur-md'}`}
        >
          {words.map((word, i) => (
            <li key={i} className="flex items-baseline gap-2 rounded-lg bg-[var(--surface-2)] px-2.5 py-2 text-sm">
              <span className="w-5 shrink-0 text-right text-xs text-[var(--text-muted)]">{i + 1}</span>
              <span className="chain-id font-medium text-[var(--text-primary)]">{revealed ? word : '•••••'}</span>
            </li>
          ))}
        </ol>
        {!revealed && (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="absolute inset-0 flex items-center justify-center gap-2 bg-[rgb(11_18_14/0.55)] text-sm font-semibold text-[var(--text-primary)]"
          >
            <Icon name="shield" size={18} className="text-[var(--taply-lime)]" />
            {p.reveal}
          </button>
        )}
      </div>
      {revealed && (
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(words.join(' ')).then(() => setCopied(true), () => setCopied(false));
            }}
          >
            <Icon name={copied ? 'check' : 'copy'} size={16} />
            {copied ? p.copied : p.copy}
          </Button>
          <Button variant="ghost" onClick={() => setRevealed(false)}>
            {p.hide}
          </Button>
        </div>
      )}
    </div>
  );
}

/** /wallet: show the phrase again after the password is checked. */
export function ShowPhrasePanel() {
  const t = useT();
  const p = t.walletNative.phrase;
  const { revealPhrase } = useTaplyWallet();
  const id = useId();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TaplyErrorCode | null>(null);
  const [words, setWords] = useState<readonly string[] | null>(null);
  return (
    <section className="surface-card flex flex-col gap-3 p-5" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="font-semibold">
        {p.showTitle}
      </h3>
      {words === null ? (
        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || password === '') return;
            setBusy(true);
            setError(null);
            const result = await revealPhrase(password);
            setBusy(false);
            setPassword('');
            if (result.ok) setWords(result.value);
            else setError(result.code);
          }}
        >
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{p.showBody}</p>
          <PassphraseField id={id} label={t.walletNative.lock.passphrase} value={password} onChange={setPassword} autoComplete="current-password" />
          <TaplyErrorNotice code={error} />
          <Button type="submit" variant="secondary" size="lg" block disabled={busy || password === ''}>
            {busy ? <Spinner /> : <Icon name="shield" size={18} />}
            {p.showButton}
          </Button>
        </form>
      ) : (
        <>
          <p className="text-sm font-medium text-[var(--tone-caution-fg)]">{p.warning}</p>
          <PhraseGrid words={words} />
          <Button variant="ghost" block onClick={() => setWords(null)}>
            {p.hide}
          </Button>
        </>
      )}
    </section>
  );
}

/** Restore: 12 words (+ username for a named account) + a new device password. */
export function ImportPhraseForm() {
  const t = useT();
  const n = t.walletNative;
  const p = n.phrase;
  const router = useRouter();
  const [, setMode] = useWalletMode();
  const { restorePhrase } = useTaplyWallet();
  const phraseId = useId();
  const nameId = useId();
  const passId = useId();
  const repeatId = useId();
  const [phrase, setPhrase] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TaplyErrorCode | null>(null);
  const count = normalizePhrase(phrase).length;
  const username = normalizeUsername(name);
  const nameProblem = username === '' ? null : usernameProblem(username);
  const passProblem = passphraseProblem(password);
  const ready = count === RECOVERY_WORDS && nameProblem === null && passProblem === null && repeat === password && !busy;

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        if (!ready) return;
        setBusy(true);
        setError(null);
        const result = await restorePhrase(phrase, password, username === '' ? undefined : usernameAccountId(username));
        setBusy(false);
        if (!result.ok) {
          setError(result.code);
          return;
        }
        setPhrase('');
        setPassword('');
        setRepeat('');
        setMode('taply');
        router.push('/');
      }}
    >
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-semibold tracking-tight">{p.importTitle}</h2>
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{p.importBody}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={phraseId} className="text-sm font-medium">
          {p.phraseLabel}
        </label>
        <textarea
          id={phraseId}
          value={phrase}
          onChange={(e) => {
            setPhrase(e.target.value);
            setError(null);
          }}
          rows={4}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="taply-input chain-id min-h-[112px] py-2"
          aria-describedby={`${phraseId}-count`}
          aria-invalid={error === 'INVALID_PHRASE' || undefined}
        />
        <p id={`${phraseId}-count`} className="text-xs text-[var(--text-muted)]">
          {fill(p.wordCount, { n: String(count) })}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={nameId} className="text-sm font-medium">
          {p.usernameOptional}
        </label>
        <div className="flex items-center rounded-[var(--radius-control)] ring-1 ring-[var(--border-strong)] focus-within:ring-2 focus-within:ring-[var(--taply-lime)]">
          <input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="alice"
            className="chain-id min-h-[var(--tap-target)] w-full min-w-0 bg-transparent px-3 text-base focus-visible:outline-none"
            aria-invalid={nameProblem !== null || undefined}
          />
          <span className="chain-id shrink-0 pr-3 text-base text-[var(--text-muted)]" aria-hidden="true">
            .testnet
          </span>
        </div>
        {nameProblem !== null && <p className="text-xs text-[var(--tone-danger-fg)]">{n.username.problems[nameProblem]}</p>}
      </div>
      <PassphraseField id={passId} label={p.newPassword} value={password} onChange={setPassword} autoComplete="new-password" invalid={password !== '' && passProblem !== null} />
      {password !== '' && passProblem === 'too_short' && <p className="-mt-2 text-xs text-[var(--tone-danger-fg)]">{n.createFlow.tooShort}</p>}
      <PassphraseField id={repeatId} label={n.createFlow.confirmLabel} value={repeat} onChange={setRepeat} autoComplete="new-password" invalid={repeat !== '' && repeat !== password} />
      {repeat !== '' && repeat !== password && <p className="-mt-2 text-sm text-[var(--tone-danger-fg)]">{n.createFlow.mismatch}</p>}
      <TaplyErrorNotice code={error} />
      <Button type="submit" size="lg" block disabled={!ready}>
        {busy ? <Spinner /> : <Icon name="shield" size={18} />}
        {busy ? p.importing : p.importButton}
      </Button>
    </form>
  );
}
