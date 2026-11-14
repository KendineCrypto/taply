'use client';

import { useState } from 'react';
import { Button } from '@/components/primitives/Button';
import { useT } from '@/lib/i18n/provider';

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
