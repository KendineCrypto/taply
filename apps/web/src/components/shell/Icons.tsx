import type { ReactNode } from 'react';

/**
 * Interface icons. Stroke-only, `currentColor`, 24px grid, decorative by
 * default: every icon in this app sits next to a visible or sr-only label.
 *
 * These are generic UI glyphs. The Taply mark itself is never drawn here; it
 * comes only from components/brand.
 */
export type IconName =
  | 'home'
  | 'pay'
  | 'scan'
  | 'activity'
  | 'settings'
  | 'send'
  | 'receive'
  | 'request'
  | 'refresh'
  | 'copy'
  | 'external'
  | 'wallet'
  | 'check'
  | 'alert'
  | 'chevron'
  | 'logout';

const PATHS: Readonly<Record<IconName, ReactNode>> = {
  home: <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />,
  pay: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10.5h18M7 15h4" />
    </>
  ),
  scan: (
    <>
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
      <path d="M8 12h8" />
    </>
  ),
  activity: <path d="M4 12h3.5l2.5-6 4 12 2.5-6H20" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
    </>
  ),
  send: <path d="M12 19V5M6 11l6-6 6 6" />,
  receive: <path d="M12 5v14M6 13l6 6 6-6" />,
  request: (
    <>
      <path d="M12 5v14M5 12h14" />
    </>
  ),
  refresh: <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8m0-4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16m0 4v-4h-4" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" />
    </>
  ),
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />,
  wallet: (
    <>
      <path d="M19 7V5.5A1.5 1.5 0 0 0 17.5 4h-12A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V9a2 2 0 0 0-2-2H4" />
      <circle cx="16" cy="13.5" r="1" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  alert: (
    <>
      <path d="M12 4 2.8 19.5h18.4z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  chevron: <path d="m9 6 6 6-6 6" />,
  logout: <path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14M10 16l-4-4 4-4M6 12h10" />,
};

export function Icon({
  name,
  size = 20,
  className,
}: {
  readonly name: IconName;
  readonly size?: number;
  readonly className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
