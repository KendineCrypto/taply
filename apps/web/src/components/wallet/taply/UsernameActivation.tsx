'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { isNamedTestnetAccount } from '@taply/near-client';
import { Button, Spinner } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import { fill } from '@/lib/i18n/fill';
import { useT } from '@/lib/i18n/provider';
import { normalizeUsername, usernameAccountId, usernameProblem, USERNAME_MAX } from '@/lib/wallet/testnet-account';
import { useTaplyWallet } from './TaplyWalletProvider';
import type { TaplyErrorCode } from './TaplyWalletProvider';
import { PassphraseField, TaplyErrorNotice } from './TaplyWalletUi';

/**
 * `username.testnet` onboarding pieces (owner decision 2026-11-09, no sponsored gas):
 *  - UsernameForm: syntax rules + FINAL availability read before anything is created;
 *  - ActivationPanel: Testnet faucet request, then FINAL reads until the account
 *    holds this vault's key. Every failure keeps the local vault and says that
 *    nothing was confirmed on chain; a taken name can be swapped for another one
 *    (same key, passphrase required).
 */

type Availability = { readonly accountId: string; readonly available: boolean } | null;

export function UsernameForm({
  submitLabel,
  onAvailable,
  busyExternal = false,
  children,
}: {
  readonly submitLabel: string;
  /** Called with a syntactically valid name that was free at a FINAL block. */
  readonly onAvailable: (accountId: string) => void | Promise<void>;
  readonly busyExternal?: boolean;
  /** Extra fields rendered above the submit button (e.g. a passphrase). */
  readonly children?: ReactNode;
}) {
  const t = useT();
  const u = t.walletNative.username;
  const { checkAvailable } = useTaplyWallet();
  const id = useId();
  const [value, setValue] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Availability>(null);
  const [error, setError] = useState<TaplyErrorCode | null>(null);
  const name = normalizeUsername(value);
  const problem = name === '' ? null : usernameProblem(name);
  const accountId = usernameAccountId(name);
  const shownResult = result !== null && result.accountId === accountId ? result : null;
  const busy = checking || busyExternal;

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || name === '' || problem !== null) return;
        setChecking(true);
        setError(null);
        const check = await checkAvailable(accountId);
        setChecking(false);
        if (!check.ok) {
          setError(check.code);
          return;
        }
        setResult({ accountId, available: check.value });
        if (check.value) await onAvailable(accountId);
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          {u.label}
        </label>
        <div className="flex items-center rounded-[var(--radius-control)] ring-1 ring-[var(--border-strong)] focus-within:ring-2 focus-within:ring-[var(--taply-lime)]">
          <input
            id={id}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            maxLength={USERNAME_MAX + '.testnet'.length + 4}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            placeholder="alice"
            className="chain-id min-h-[var(--tap-target)] w-full min-w-0 bg-transparent px-3 text-base focus-visible:outline-none"
            aria-describedby={`${id}-hint ${id}-status`}
            aria-invalid={problem !== null || shownResult?.available === false || undefined}
          />
          <span className="chain-id shrink-0 pr-3 text-base text-[var(--text-muted)]" aria-hidden="true">
            .testnet
          </span>
        </div>
        <p id={`${id}-hint`} className={`text-xs ${problem !== null ? 'text-[var(--tone-danger-fg)]' : 'text-[var(--text-muted)]'}`}>
          {problem !== null ? u.problems[problem] : u.rules}
        </p>
        <p id={`${id}-status`} aria-live="polite" className="text-sm">
          {checking ? (
            <span className="flex items-center gap-2 text-[var(--text-secondary)]">
              <Spinner /> {u.checking}
            </span>
          ) : shownResult !== null ? (
            <span className={`flex items-center gap-1.5 ${shownResult.available ? 'text-[var(--taply-lime)]' : 'text-[var(--tone-danger-fg)]'}`}>
              <Icon name={shownResult.available ? 'check' : 'alert'} size={15} />
              {fill(shownResult.available ? u.available : u.taken, { account: shownResult.accountId })}
            </span>
          ) : null}
        </p>
      </div>
      {children}
      <TaplyErrorNotice code={error} />
      <Button type="submit" size="lg" block disabled={busy || name === '' || problem !== null}>
        {busy ? <Spinner /> : null}
        {submitLabel}
        {!busy && <Icon name="arrow-right" size={18} />}
      </Button>
    </form>
  );
}

/** Same key, new name: needs the passphrase (the account ID is sealed metadata). */
function RebindForm({ onRebound }: { readonly onRebound: () => void }) {
  const t = useT();
  const u = t.walletNative.username;
  const { rebindName } = useTaplyWallet();
  const passId = useId();
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TaplyErrorCode | null>(null);
  return (
    <section className="flex flex-col gap-3" aria-labelledby={`${passId}-title`}>
      <h3 id={`${passId}-title`} className="font-semibold">
        {u.rebindTitle}
      </h3>
      <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{u.rebindBody}</p>
      <UsernameForm
        submitLabel={u.rebindButton}
        busyExternal={busy}
        onAvailable={async (accountId) => {
          if (passphrase === '') {
            setError('PASSWORD_POLICY');
            return;
          }
          setBusy(true);
          setError(null);
          const result = await rebindName(passphrase, accountId);
          setBusy(false);
          if (!result.ok) {
            setError(result.code);
            return;
          }
          setPassphrase('');
          onRebound();
        }}
      >
        <PassphraseField id={passId} label={t.walletNative.lock.passphrase} value={passphrase} onChange={setPassphrase} autoComplete="current-password" />
        <TaplyErrorNotice code={error} />
      </UsernameForm>
    </section>
  );
}

/**
 * Creates the vault's named account through the Testnet faucet and confirms it
 * with FINAL reads. Shown right after creation (autoStart) and on /wallet for a
 * wallet whose account was never confirmed.
 */
export function ActivationPanel({ autoStart = false, onActive }: { readonly autoStart?: boolean; readonly onActive?: () => void }) {
  const t = useT();
  const u = t.walletNative.username;
  const { state, activate } = useTaplyWallet();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<TaplyErrorCode | null>(null);
  const [rebinding, setRebinding] = useState(false);
  const started = useRef(false);
  const identity = state.status === 'local_only' || state.status === 'unknown' || state.status === 'provisioned' ? state.identity : null;
  const named = identity !== null && isNamedTestnetAccount(identity.accountId);
  const nameTaken = state.status === 'local_only' && state.nameTaken === true;

  const run = async () => {
    setWorking(true);
    setError(null);
    const result = await activate();
    setWorking(false);
    if (result.ok) onActive?.();
    else setError(result.code);
  };

  useEffect(() => {
    if (!autoStart || started.current || !named) return;
    started.current = true;
    void run();
    // run() is intentionally captured once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, named]);

  if (identity === null) return null;

  if (working) {
    return (
      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        <p className="flex items-center gap-2 font-semibold">
          <Spinner /> {fill(u.activatingTitle, { account: identity.accountId })}
        </p>
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{u.activatingBody}</p>
      </div>
    );
  }

  // An implicit (pre-username) wallet or a taken name needs a (new) username first.
  if (!named || rebinding || nameTaken || error === 'NAME_TAKEN') {
    return (
      <div className="flex flex-col gap-3">
        {named && (nameTaken || error === 'NAME_TAKEN') && <TaplyErrorNotice code="NAME_TAKEN" />}
        <RebindForm
          onRebound={() => {
            setRebinding(false);
            void run();
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error !== null && (
        <div className="flex flex-col gap-2 border-l-2 border-[var(--tone-caution-border)] py-1 pl-4" role="note">
          <p className="font-semibold text-[var(--tone-caution-fg)]">{u.notYetTitle}</p>
          <TaplyErrorNotice code={error} />
          <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{u.keptLocal}</p>
        </div>
      )}
      <Button size="lg" block onClick={() => void run()}>
        <Icon name="refresh" size={18} />
        {error === null ? u.finishSetup : u.retry}
      </Button>
      {error !== null && (
        <Button variant="ghost" block onClick={() => setRebinding(true)}>
          {u.pickAnother}
        </Button>
      )}
      <p className="text-xs leading-relaxed text-[var(--text-muted)]">{u.noGas}</p>
    </div>
  );
}
