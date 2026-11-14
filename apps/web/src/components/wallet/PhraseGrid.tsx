'use client';

import { useState } from 'react';
import { Button } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import { useT } from '@/lib/i18n/provider';

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
