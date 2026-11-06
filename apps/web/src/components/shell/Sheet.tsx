'use client';

import { useEffect, useId, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '@/components/shell/Icons';

/**
 * Bottom sheet on a native modal <dialog>: the browser provides the focus trap,
 * Escape-to-close and an inert page behind it. We add the slide animation and
 * restore focus to whatever opened the sheet. Reduced motion removes the slide
 * (global rule in globals.css).
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  closeLabel,
  children,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: string;
  readonly closeLabel: string;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const baseId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open) {
      // Also cancels a slide-out that was still running.
      dialog.classList.remove('is-closing');
      if (!dialog.open) {
        opener.current = document.activeElement;
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
      }
      return;
    }
    if (!dialog.open) return;
    const done = () => {
      dialog.classList.remove('is-closing');
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
    const reduced =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      done();
      return;
    }
    // Slide out, then close (the class only drives the CSS transition).
    dialog.classList.add('is-closing');
    const timer = window.setTimeout(done, 220);
    return () => window.clearTimeout(timer);
  }, [open]);

  const titleId = `${baseId}-title`;
  const descId = description === undefined ? undefined : `${baseId}-desc`;

  return (
    <dialog
      ref={ref}
      className="taply-sheet"
      aria-labelledby={titleId}
      aria-describedby={descId}
      onCancel={(event) => {
        // Escape: animate out instead of the instant native close.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3">
        <span aria-hidden="true" className="mx-auto mb-3 block h-1 w-10 rounded-full bg-[var(--border-strong)]" />
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="text-lg font-semibold tracking-tight">
              {title}
            </h2>
            {description !== undefined && (
              <p id={descId} className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="tap-target -mr-2 -mt-1 grid shrink-0 place-items-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--tone-neutral-bg)] hover:text-[var(--text-primary)]"
          >
            <Icon name="x" size={20} />
          </button>
        </div>
        {open && children}
      </div>
    </dialog>
  );
}

/** A large, list-style action inside a sheet. */
export function SheetAction({
  icon,
  label,
  body,
  primary = false,
  onSelect,
  index = 0,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly body: string;
  readonly primary?: boolean;
  readonly onSelect: () => void;
  readonly index?: number;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{ '--i': index } as CSSProperties}
      className="stagger-item pressable flex min-h-[68px] w-full items-center gap-4 rounded-[var(--radius-card)] px-3 py-3 text-left hover:bg-[var(--tone-neutral-bg)]"
    >
      <span
        aria-hidden="true"
        className={`grid size-12 shrink-0 place-items-center rounded-full ${
          primary
            ? 'bg-[var(--taply-lime)] text-[var(--taply-night)]'
            : 'bg-[var(--surface-2)] text-[var(--text-primary)] ring-1 ring-[var(--border-subtle)]'
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{label}</span>
        <span className="block text-sm leading-snug text-[var(--text-secondary)]">{body}</span>
      </span>
      <Icon name="chevron" size={18} className="shrink-0 text-[var(--text-muted)]" />
    </button>
  );
}
