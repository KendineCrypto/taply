import type { ReactNode } from 'react';

/** Card surface. Level maps to the approved surface ramp (night/forest/olive). */
export function Card({
  children,
  level = 1,
  className,
  as: Tag = 'div',
}: {
  readonly children: ReactNode;
  readonly level?: 1 | 2;
  readonly className?: string;
  readonly as?: 'div' | 'section' | 'article' | 'li';
}) {
  const bg = level === 1 ? 'bg-[var(--surface-1)]' : 'bg-[var(--surface-2)]';
  return (
    <Tag
      className={`rounded-[var(--radius-card)] border border-[var(--border-subtle)] ${bg} p-4 ${className ?? ''}`}
    >
      {children}
    </Tag>
  );
}

export function ScreenHeader({
  title,
  description,
  trailing,
}: {
  readonly title: string;
  readonly description?: string;
  readonly trailing?: ReactNode;
}) {
  return (
    <header className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description !== undefined && (
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{description}</p>
        )}
      </div>
      {trailing}
    </header>
  );
}

/**
 * A labelled key/value row. Used by the review sheet and receipts, where the
 * label must stay legible next to a long account ID or hash.
 */
export function DetailRow({
  label,
  children,
  emphasis = false,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly emphasis?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-[var(--border-subtle)] py-2 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{label}</dt>
      <dd className={`min-w-0 text-right sm:text-right ${emphasis ? 'font-semibold' : ''}`}>{children}</dd>
    </div>
  );
}

export function EmptyState({ title, body }: { readonly title: string; readonly body?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--border-subtle)] p-6 text-center">
      <p className="font-medium">{title}</p>
      {body !== undefined && <p className="mt-1 text-sm text-[var(--text-secondary)]">{body}</p>}
    </div>
  );
}
