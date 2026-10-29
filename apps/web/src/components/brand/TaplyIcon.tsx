import type { CSSProperties, ReactNode } from 'react';
import {
  CLEARSPACE_RATIO,
  ICON_DOT,
  ICON_VIEWBOX,
  MASTER_T_PATH,
  WORDMARK_ASSETS,
  WORDMARK_VIEWBOX,
} from './brand-geometry';

/**
 * Brand mark rendering.
 *
 * Rules enforced here rather than left to call sites:
 *  - geometry comes from brand-geometry.ts, never from new path data;
 *  - aspect ratio is fixed, so the mark cannot be stretched;
 *  - no rotation, no glow, no 3D (BRAND_GUIDELINES.md usage rules);
 *  - clearspace is reserved by <BrandClearspace>.
 */

interface TaplyIconProps {
  /** Rendered width in px. Height follows the fixed 1:1 artboard. */
  readonly size?: number;
  /**
   * `plate` draws the approved Night rounded-square ground; `bare` renders only
   * the mark so it can sit on an existing surface.
   */
  readonly variant?: 'plate' | 'bare';
  /**
   * Decorative by default — the wordmark or adjacent text usually names the app.
   * Pass a label when the icon is the only identification present.
   */
  readonly label?: string;
  readonly className?: string;
}

export function TaplyIcon({ size = 32, variant = 'plate', label, className }: TaplyIconProps) {
  const decorative = label === undefined;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${ICON_VIEWBOX.width} ${ICON_VIEWBOX.height}`}
      className={className}
      role={decorative ? 'presentation' : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={label}
      focusable="false"
    >
      {!decorative && <title>{label}</title>}
      {variant === 'plate' && (
        <rect
          width={ICON_VIEWBOX.width}
          height={ICON_VIEWBOX.height}
          rx={ICON_VIEWBOX.cornerRadius}
          fill="var(--taply-night)"
        />
      )}
      {/* Verbatim approved master path. Do not edit. */}
      <path d={MASTER_T_PATH} fill="var(--taply-cream)" />
      <circle cx={ICON_DOT.cx} cy={ICON_DOT.cy} r={ICON_DOT.r} fill="var(--taply-lime)" />
    </svg>
  );
}

interface TaplyWordmarkProps {
  /** Rendered width in px. Height follows the fixed 591:250 artboard. */
  readonly width?: number;
  readonly className?: string;
}

/**
 * The wordmark is served as the approved SVG file, not reconstructed: the `aply`
 * glyph outlines exist only in brand/assets and must not be redrawn. Rendered via
 * <img> with a fixed aspect ratio so it can never be distorted.
 */
export function TaplyWordmark({ width = 112, className }: TaplyWordmarkProps) {
  const height = Math.round((width * WORDMARK_VIEWBOX.height) / WORDMARK_VIEWBOX.width);

  return (
    // eslint-disable-next-line @next/next/no-img-element -- a static brand SVG
    // must be byte-identical to the approved asset; the image optimizer would
    // re-encode it.
    <img
      src={WORDMARK_ASSETS.transparent}
      alt="Taply"
      width={width}
      height={height}
      className={className}
      style={{ aspectRatio: `${WORDMARK_VIEWBOX.width} / ${WORDMARK_VIEWBOX.height}` }}
      draggable={false}
    />
  );
}

/**
 * Reserves the brand minimum clearspace ("at least the dot diameter on every
 * side") so no layout can crop the mark.
 */
export function BrandClearspace({
  children,
  style,
}: {
  readonly children: ReactNode;
  readonly style?: CSSProperties;
}) {
  return <span style={{ display: 'inline-flex', padding: `${CLEARSPACE_RATIO * 100}%`, ...style }}>{children}</span>;
}
