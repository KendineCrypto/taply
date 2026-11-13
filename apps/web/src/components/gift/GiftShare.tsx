'use client';

import { useState } from 'react';
import { Button } from '@/components/primitives/Button';
import { QrCode } from '@/components/payments/QrCode';
import { Icon } from '@/components/shell/Icons';
import { useCopy } from '@/lib/hooks/browser';
import { useT } from '@/lib/i18n/provider';
import { xShareUrl } from '@/lib/gift/link';

/**
 * Copy / X / native share for a gift link. X opens a prefilled web intent in a
 * new tab; nothing is posted automatically and Taply has no X API access.
 */
export function GiftShare({ url, kind }: { readonly url: string; readonly kind: 'open' | 'personal' }) {
  const t = useT();
  const s = t.gift.share;
  const { status, copy } = useCopy();
  const [showQr, setShowQr] = useState(false);
  const text = kind === 'open' ? s.xOpenText : s.xPersonalText;
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  return (
    <section className="surface-card flex flex-col gap-3 p-5" aria-labelledby="gift-share-title">
      <h2 id="gift-share-title" className="text-lg font-semibold">{s.heading}</h2>
      <p className="chain-id break-all rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[rgb(244_243_232/0.04)] p-3 text-xs text-[var(--text-secondary)]" data-testid="gift-url">
        {url}
      </p>
      <Button size="lg" block onClick={() => copy(url)}>
        <Icon name={status === 'copied' ? 'check' : 'copy'} size={18} />
        {status === 'copied' ? s.copied : status === 'failed' ? s.copyFailed : s.copy}
      </Button>
      <div className="grid grid-cols-2 gap-2">
        <a
          className="pressable inline-flex min-h-[var(--tap-target)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-2)] px-4 text-sm font-semibold hover:border-[var(--border-strong)]"
          href={xShareUrl(text, url)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
            <path d="M17.8 3h3.1l-6.8 7.7 8 10.3h-6.3l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.8 3h6.4l4.4 5.8zm-1.1 16.2h1.7L7.4 4.7H5.6z" />
          </svg>
          {s.x}
        </a>
        {canNativeShare ? (
          <Button variant="secondary" onClick={() => void navigator.share({ title: t.gift.title, text, url }).catch(() => undefined)}>
            <Icon name="share" size={16} /> {s.native}
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => setShowQr((v) => !v)} aria-expanded={showQr}>
            <Icon name="scan" size={16} /> {s.qr}
          </Button>
        )}
      </div>
      {canNativeShare && (
        <Button variant="ghost" onClick={() => setShowQr((v) => !v)} aria-expanded={showQr}>
          <Icon name="scan" size={16} /> {s.qr}
        </Button>
      )}
      {showQr && (
        <div className="grid place-items-center rounded-[var(--radius-card)] bg-[var(--paper)] p-4">
          <QrCode value={url} label={s.qr} size={220} />
        </div>
      )}
      {kind === 'open' && <p className="text-xs text-[var(--text-muted)]">{s.secretNote}</p>}
    </section>
  );
}
