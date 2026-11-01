'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { Button, ButtonLink, Spinner } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import { useT } from '@/lib/i18n/provider';
import { useTaplyWallet } from './TaplyWalletProvider';
import type { TaplyErrorCode } from './TaplyWalletProvider';
import { PassphraseField, TaplyErrorNotice } from './TaplyWalletUi';
import { useWalletMode } from './mode';

/** Largest backup accepted from a file or paste (the vault record is far smaller). */
const MAX_BACKUP_CHARS = 8192;

/**
 * Restore from an ENCRYPTED backup only. The controller authenticates and
 * decrypts, checks the key pair and refuses to overwrite an existing wallet.
 * The restored wallet is locked. No seed phrase or plaintext key is accepted.
 */
export function RestoreWalletFlow() {
  const t = useT();
  const n = t.walletNative;
  const r = n.restoreFlow;
  const router = useRouter();
  const [, setMode] = useWalletMode();
  const { state, restore } = useTaplyWallet();
  const fileId = useId();
  const pasteId = useId();
  const passId = useId();
  const [backup, setBackup] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TaplyErrorCode | null>(null);

  if (state.status === 'unavailable') return <InlineNotice copy={n.unavailable} tone="neutral" />;
  if (state.status === 'local_only' || state.status === 'provisioned' || state.status === 'unknown') {
    return (
      <InlineNotice
        copy={{ title: n.createdAlready, body: n.errors.ALREADY_EXISTS }}
        tone="neutral"
        action={<ButtonLink href="/wallet">{n.taply}</ButtonLink>}
      />
    );
  }

  return (
    <form
      className="animate-page flex flex-col gap-4"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || backup.trim() === '' || passphrase === '') return;
        setBusy(true);
        setError(null);
        const result = await restore(backup.trim(), passphrase);
        setBusy(false);
        if (!result.ok) {
          setError(result.code);
          return;
        }
        setPassphrase('');
        setBackup('');
        setMode('taply');
        router.push('/wallet');
      }}
    >
      <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{r.body}</p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fileId} className="text-sm font-medium">
          {r.file}
        </label>
        <input
          id={fileId}
          type="file"
          accept="application/json,.json"
          className="taply-input file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--surface-1)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[var(--text-primary)]"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file === undefined) return;
            setError(null);
            if (file.size > MAX_BACKUP_CHARS) {
              setError('INVALID_RECORD');
              return;
            }
            setFileName(file.name);
            setBackup(await file.text());
          }}
        />
        {fileName !== null && (
          <p className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
            <Icon name="check" size={14} className="text-[var(--taply-lime)]" />
            <span className="chain-id">{fileName}</span>
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={pasteId} className="text-sm font-medium">
          {r.paste}
        </label>
        <textarea
          id={pasteId}
          value={backup}
          rows={3}
          maxLength={MAX_BACKUP_CHARS}
          onChange={(e) => {
            setBackup(e.target.value);
            setFileName(null);
          }}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="taply-input chain-id"
        />
      </div>
      <PassphraseField
        id={passId}
        label={n.lock.passphrase}
        value={passphrase}
        onChange={setPassphrase}
        autoComplete="current-password"
        describedBy={error !== null ? `${passId}-error` : undefined}
        invalid={error !== null}
      />
      <div id={`${passId}-error`}>
        <TaplyErrorNotice code={error} />
      </div>
      <Button type="submit" size="lg" block disabled={busy || backup.trim() === '' || passphrase === ''}>
        {busy ? <Spinner /> : <Icon name="refresh" size={18} />}
        {busy ? r.restoring : r.restoreButton}
      </Button>
    </form>
  );
}
