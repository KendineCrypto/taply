'use client';

import { useId, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '@/components/shell/Icons';
import { fill } from '@/lib/i18n';
import { useT } from '@/lib/i18n/provider';
import { openLivePath, parseScanInput } from '@/lib/payments/pay-link';
import type { ScanInput } from '@/lib/payments/pay-link';
import { approvedPayOrigins } from '@/lib/share/origin';

/**
 * Pay entry (Phase 6A): exactly two ways to open a request someone sent you.
 * Both end on this app's own /pay/<id>, where the terms are read from the
 * contract and the wallet is asked only after a full review.
 */
export function PayChoices({ onLink, onScan }: { readonly onLink: () => void; readonly onScan: () => void }) {
  const t = useT();
  const e = t.oneTap.payEntry;
  return (
    <div className="grid grid-cols-2 gap-3" role="group" aria-label={e.choicesLabel}>
      <ChoiceTile index={0} icon={<Icon name="link" size={24} />} label={e.link.label} body={e.link.body} onSelect={onLink} />
      <ChoiceTile index={1} primary icon={<Icon name="scan" size={24} />} label={e.scan.label} body={e.scan.body} onSelect={onScan} />
    </div>
  );
}

function ChoiceTile({
  icon,
  label,
  body,
  onSelect,
  primary = false,
  index,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly body: string;
  readonly onSelect: () => void;
  readonly primary?: boolean;
  readonly index: number;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{ '--i': index } as CSSProperties}
      className="stagger-item pressable flex min-h-[148px] flex-col items-start gap-3 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]"
    >
      <span
        aria-hidden="true"
        className={`grid size-12 place-items-center rounded-2xl ${
          primary
            ? 'bg-[var(--taply-lime)] text-[var(--taply-night)] shadow-[0_10px_24px_-12px_rgb(199_252_117/0.7)]'
            : 'bg-[var(--surface-2)] text-[var(--text-primary)] ring-1 ring-[var(--border-subtle)]'
        }`}
      >
        {icon}
      </span>
      <span className="flex flex-col gap-1">
        <span className="font-semibold">{label}</span>
        <span className="text-[0.8125rem] leading-snug text-[var(--text-secondary)]">{body}</span>
      </span>
    </button>
  );
}

/** Paste a pay link or a bare request ID. Only an approved Taply request ID is opened. */
export function PayLinkForm({
  onBack,
  onOpen,
  onMerchant,
  onLive = openLivePath,
  approvedOrigins,
}: {
  readonly onBack?: () => void;
  readonly onOpen: (id: string) => void;
  /** Opens this app's read-only checkout page for a validated merchant discovery link. */
  readonly onMerchant?: (accountId: string) => void;
  /** Opens this app's own validated live-session path (`/s/<room>#j=<token>`). */
  readonly onLive?: (path: string) => void;
  readonly approvedOrigins?: ReadonlyArray<string>;
}) {
  const t = useT();
  const p = t.oneTap.payLink;
  const inputId = useId();
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<Exclude<ScanInput, { kind: 'request' } | { kind: 'merchant' } | { kind: 'live' }> | { kind: 'invalid' } | null>(null);

  return (
    <form
      className="animate-page flex flex-col gap-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = parseScanInput(value, approvedOrigins ?? approvedPayOrigins(window.location.origin));
        if (parsed.kind === 'request') {
          onOpen(parsed.id);
          return;
        }
        if (parsed.kind === 'live') {
          onLive(parsed.path);
          return;
        }
        if (parsed.kind === 'merchant') {
          if (onMerchant !== undefined) onMerchant(parsed.accountId);
          else setProblem({ kind: 'invalid' });
          return;
        }
        setProblem(parsed);
      }}
    >
      <label htmlFor={inputId} className="text-sm font-medium">
        {p.label}
      </label>
      <input
        id={inputId}
        type="url"
        inputMode="url"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder={p.placeholder}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setProblem(null);
        }}
        aria-invalid={problem !== null || undefined}
        aria-describedby={`${inputId}-error`}
        className="taply-input chain-id"
        // Opened by an explicit choice; focusing the only field is expected.
        autoFocus
      />
      <p id={`${inputId}-error`} role={problem !== null ? 'alert' : undefined} className="min-h-5 text-sm text-[var(--tone-danger-fg)]">
        {problem === null
          ? ''
          : problem.kind === 'other_site'
            ? fill(p.otherSite, { host: problem.host })
            : problem.kind === 'invalid_merchant'
              ? problem.reason === 'not_testnet'
                ? t.commerce.scan.notTestnetMerchant
                : t.commerce.scan.invalidMerchant
              : p.invalid}
      </p>
      <button
        type="submit"
        disabled={value.trim() === ''}
        className="pressable inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--taply-lime)] px-5 text-base font-semibold text-[var(--taply-night)] disabled:cursor-not-allowed disabled:bg-[rgb(199_252_117/0.35)]"
      >
        {p.open}
        <Icon name="arrow-right" size={18} />
      </button>
      {onBack !== undefined && (
        <button
          type="button"
          onClick={onBack}
          className="tap-target inline-flex items-center justify-center gap-1.5 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <Icon name="arrow-left" size={16} />
          {p.back}
        </button>
      )}
    </form>
  );
}
