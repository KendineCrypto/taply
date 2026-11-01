'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { Icon } from '@/components/shell/Icons';
import type { IconName } from '@/components/shell/Icons';
import { ConnectWalletButton, WalletErrorNotice } from '@/components/wallet/WalletConnect';
import type { ErrorCopy } from '@/lib/i18n';
import { useT } from '@/lib/i18n/provider';

/**
 * Wallet onboarding.
 *
 * Only "Connect existing wallet" is functional: it uses the NEAR Connect
 * adapter, and the person's keys stay in their own wallet. Creating or
 * restoring a Taply-controlled wallet needs a reviewed native wallet engine
 * (owned by core) that does not exist in this build, so those options are shown
 * as "Not available yet". They never collect a password, phrase or key; they
 * open an explanation with a working alternative, so nothing is a dead end.
 *
 * When core ships the native engine, it should expose its availability through
 * the wallet adapter; this component then enables the rows from that signal.
 */
export function WalletOnboarding() {
  const t = useT();
  const o = t.walletUx.onboarding;
  const connectId = useId();

  return (
    <div className="flex flex-col gap-4">
      <section className="surface-hero p-5" aria-labelledby={connectId}>
        <div className="flex items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--taply-lime)] text-[var(--taply-night)]">
            <Icon name="wallet" size={24} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={connectId} className="text-lg font-semibold tracking-tight">
                {o.connect.title}
              </h2>
              <span className="rounded-full bg-[var(--tone-success-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--taply-lime)]">
                {o.works}
              </span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">{o.connect.body}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-3">
          <WalletErrorNotice />
          <ConnectWalletButton />
        </div>
      </section>

      <ul className="flex flex-col gap-3">
        <NotYetOption icon="shield" copy={o.create} />
        <NotYetOption icon="refresh" copy={o.restore} />
      </ul>
    </div>
  );
}

function NotYetOption({ icon, copy }: { readonly icon: IconName; readonly copy: ErrorCopy }) {
  const t = useT();
  const o = t.walletUx.onboarding;
  const panelId = useId();
  const [open, setOpen] = useState(false);
  return (
    <li className="surface-card overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-4 p-4 text-left"
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[var(--surface-2)] text-[var(--text-secondary)] ring-1 ring-[var(--border-subtle)]">
          <Icon name={icon} size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-[var(--text-primary)]">{copy.title}</span>
            <span className="rounded-full bg-[var(--tone-muted-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)] ring-1 ring-[var(--border-subtle)]">
              {o.notYet}
            </span>
          </span>
          <span className="mt-1 block text-sm leading-relaxed text-[var(--text-secondary)]">{copy.body}</span>
        </span>
        <Icon name="chevron" size={18} className={`mt-1 shrink-0 text-[var(--text-muted)] transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div id={panelId} className="border-t border-[var(--border-subtle)] px-4 pb-4 pt-3">
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{o.notYetBody}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/demo"
              className="tap-target inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-sm font-medium text-[var(--text-primary)] ring-1 ring-[var(--border-strong)] hover:bg-[var(--tone-neutral-bg)]"
            >
              {o.tour}
              <Icon name="arrow-right" size={16} />
            </Link>
          </div>
        </div>
      )}
    </li>
  );
}
