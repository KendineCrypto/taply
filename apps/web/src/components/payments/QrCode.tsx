'use client';

import { useMemo } from 'react';
import { encodeQr } from '@/lib/qr/encode';

/**
 * Renders `value` as a scannable QR code (SVG, 4-module quiet zone).
 *
 * Night-on-cream regardless of theme: scanners need dark modules on a light
 * field, and the quiet zone must stay light. The encoded text is exposed to
 * assistive technology, so the code is never the only way to get the link.
 */
export function QrCode({ value, label, size = 232 }: { readonly value: string; readonly label: string; readonly size?: number }) {
  const qr = useMemo(() => encodeQr(value, 'M'), [value]);
  const quiet = 4;
  const dim = qr.size + quiet * 2;

  const path = useMemo(() => {
    let d = '';
    qr.modules.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
      });
    });
    return d;
  }, [qr]);

  return (
    <svg
      role="img"
      aria-label={`${label}: ${value}`}
      viewBox={`0 0 ${dim} ${dim}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="block h-auto max-w-full rounded-xl"
      data-qr-version={qr.version}
    >
      <rect width={dim} height={dim} fill="#F4F3E8" />
      <path d={path} fill="#0B120E" />
    </svg>
  );
}
