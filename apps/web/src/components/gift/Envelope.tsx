'use client';

import type { CSSProperties, ReactNode } from 'react';
import { TaplyIcon } from '@/components/brand/TaplyIcon';
import { designKey } from '@/lib/gift/design';
import type { GiftDesignKey } from '@/lib/gift/design';

/**
 * The gift envelope: pure CSS/SVG, no images. Closed -> (Unwrap) -> the flap
 * folds back, the seal lifts and the letter slides out. The animation is a
 * visual interaction only: opening it never claims or sends anything, and the
 * letter's content is whatever the parent passes (for Open Gifts that includes
 * the chain status, never a "you received" line before the chain says so).
 *
 * Reduced motion: CSS swaps the movement for a short cross-fade (globals.css).
 */
export const DESIGN_SWATCH: Readonly<Record<GiftDesignKey, { readonly paper: string; readonly seal: string }>> = {
  forest: { paper: '#203226', seal: '#c7fc75' },
  lime: { paper: '#c7fc75', seal: '#0b120e' },
  linen: { paper: '#f4f3e8', seal: '#111c15' },
  midnight: { paper: '#111c15', seal: '#f4f3e8' },
};

export function Envelope({
  design,
  open,
  label,
  children,
  size = 'lg',
}: {
  readonly design: number;
  readonly open: boolean;
  /** Accessible name, e.g. "Closed gift envelope". */
  readonly label: string;
  /** The letter. Rendered (for layout) but hidden from AT until open. */
  readonly children?: ReactNode;
  readonly size?: 'sm' | 'lg';
}) {
  const key = designKey(design);
  return (
    <div
      className={`gift-env gift-env--${key} gift-env--${size}`}
      data-open={open ? 'true' : 'false'}
      role="img"
      aria-label={label}
      style={{ '--env-seal': DESIGN_SWATCH[key].seal } as CSSProperties}
    >
      <div className="gift-env__stage">
        <div className="gift-env__back" aria-hidden="true" />
        <div className="gift-env__letter" aria-hidden={!open}>
          {children}
        </div>
        <svg className="gift-env__pocket" viewBox="0 0 300 200" preserveAspectRatio="none" aria-hidden="true">
          <path className="gift-env__pocket-side" d="M0 6 L146 112 Q150 115 154 112 L300 6 L300 200 L0 200 Z" />
          <path className="gift-env__pocket-fold" d="M0 200 L138 104 Q150 96 162 104 L300 200 Z" />
          <path className="gift-env__pocket-line" d="M12 192 L150 100 L288 192" fill="none" />
        </svg>
        <div className="gift-env__flap" aria-hidden="true">
          <svg viewBox="0 0 300 120" preserveAspectRatio="none">
            <path className="gift-env__flap-shape" d="M0 0 H300 L160 112 Q150 120 140 112 Z" />
            <path className="gift-env__flap-line" d="M14 6 L150 112 L286 6" fill="none" />
          </svg>
        </div>
        <span className="gift-env__seal" aria-hidden="true">
          <TaplyIcon size={size === 'lg' ? 26 : 16} variant="plate" />
        </span>
      </div>
    </div>
  );
}

/** Small swatch envelope for the design picker. */
export function EnvelopeSwatch({ design }: { readonly design: number }) {
  return <Envelope design={design} open={false} label="" size="sm" />;
}
