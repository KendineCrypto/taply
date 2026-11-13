import type { ReactNode } from 'react';
import type { MainnetCall } from '@taply/near-client';

export function Row({ label, children, mono = false }: { readonly label: string; readonly children: ReactNode; readonly mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-[var(--border-subtle)] py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-[13px] text-[var(--text-secondary)]">{label}</dt>
      <dd className={`min-w-0 break-all text-[15px] sm:text-right ${mono ? 'font-mono text-[13px]' : 'font-medium'}`}>{children}</dd>
    </div>
  );
}

type Tone = 'neutral' | 'caution' | 'danger' | 'success' | 'muted';
const TONES: Readonly<Record<Tone, string>> = {
  neutral: 'border-[var(--border-subtle)] bg-[var(--tone-neutral-bg)] text-[var(--text-primary)]',
  caution: 'border-[var(--tone-caution-border)] bg-[var(--tone-caution-bg)] text-[var(--tone-caution-fg)]',
  danger: 'border-[var(--tone-danger-border)] bg-[var(--tone-danger-bg)] text-[var(--tone-danger-fg)]',
  success: 'border-[var(--tone-success-border)] bg-[var(--tone-success-bg)] text-[var(--tone-success-fg)]',
  muted: 'border-[var(--border-subtle)] bg-[var(--tone-muted-bg)] text-[var(--text-secondary)]',
};

export function Notice({ tone = 'neutral', children, testId, live = false }: { readonly tone?: Tone; readonly children: ReactNode; readonly testId?: string; readonly live?: boolean }) {
  return (
    <div data-testid={testId} role={live ? 'status' : undefined} className={`rounded-[var(--radius-control)] border px-3.5 py-3 text-[14px] leading-relaxed ${TONES[tone]}`}>
      {children}
    </div>
  );
}

/** The exact unsigned call a wallet would be asked to sign. Display only. */
export function CallPreview({ call, title }: { readonly call: MainnetCall; readonly title: string }) {
  return (
    <details className="rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-0)] p-3 text-[12px]">
      <summary className="cursor-pointer text-[13px] font-semibold">{title}</summary>
      <pre data-testid="call-preview" className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-[var(--text-secondary)]">
        {JSON.stringify(call, null, 2)}
      </pre>
    </details>
  );
}

export function short(value: string, head = 10, tail = 8): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}
