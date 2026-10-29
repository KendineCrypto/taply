/**
 * Approved Taply mark geometry — VERBATIM.
 *
 * BRAND_GUIDELINES.md: "The `t` glyph is not separately typeset. The identical
 * literal SVG path is inserted into every icon AND wordmark." CLAUDE.md forbids
 * a newly invented or approximated `t`.
 *
 * The strings below are copied byte-for-byte out of brand/assets/*.svg. They are
 * DATA, not design decisions:
 *   - never retype, re-trace, re-space or "optimise" a path;
 *   - never substitute a font glyph;
 *   - never alter the dot coordinates or radius.
 *
 * `scripts/verify-brand-assets.mjs` re-extracts the master path from
 * brand/assets/icon-transparent.svg and fails the build if MASTER_T_PATH stops
 * matching it. Run `pnpm verify:brand` (part of `pnpm check`).
 */

/** The single master `t` path, shared by every icon and the wordmark. */
export const MASTER_T_PATH =
  'M91 38 C91 31 97 25 104 25 H120 C127 25 133 31 133 38 V63 H154 C162 63 168 69 168 77 V89 C168 97 162 103 154 103 H133 V141 C133 155 140 161 153 161 H158 C167 161 173 167 173 176 V185 C173 193 167 199 158 199 H150 C108 199 91 178 91 141 V103 H75 C67 103 61 97 61 89 V77 C61 69 67 63 75 63 H91 Z';

/** Icon artboard. The `t` and the dot live in this coordinate space. */
export const ICON_VIEWBOX = { width: 240, height: 240, cornerRadius: 53 } as const;

/** Dot position and radius inside the icon artboard. Identical in all variants. */
export const ICON_DOT = { cx: 185, cy: 183, r: 17 } as const;

/** Wordmark artboard, from brand/assets/wordmark-*.svg. */
export const WORDMARK_VIEWBOX = { width: 591, height: 250 } as const;

/** Dot position and radius inside the wordmark artboard. */
export const WORDMARK_DOT = { cx: 547.4, cy: 202, r: 17 } as const;

/**
 * Minimum clearspace as a fraction of artboard width: "at least the dot
 * diameter on every side" (BRAND_GUIDELINES.md). Applied by <BrandClearspace>.
 */
export const CLEARSPACE_RATIO = (ICON_DOT.r * 2) / ICON_VIEWBOX.width;

/**
 * The `aply` lettering is NOT reproduced inline. Those glyph outlines only exist
 * in the approved wordmark SVGs, so any wordmark rendering uses the file itself
 * (public/brand/wordmark-*.svg) rather than a reconstruction. Inline rendering
 * is limited to the icon, where the master path plus the dot is the whole mark.
 */
export const WORDMARK_ASSETS = {
  dark: '/brand/wordmark-dark.svg',
  light: '/brand/wordmark-light.svg',
  transparent: '/brand/wordmark-transparent.svg',
} as const;

export const ICON_ASSETS = {
  dark: '/brand/icon-dark.svg',
  light: '/brand/icon-light.svg',
  transparent: '/brand/icon-transparent.svg',
  favicon: '/brand/favicon.svg',
} as const;
