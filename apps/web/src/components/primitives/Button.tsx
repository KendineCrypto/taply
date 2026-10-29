import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'md' | 'lg';

const VARIANTS: Readonly<Record<Variant, string>> = {
  // Lime is reserved for the key action on a screen (brand guidelines).
  primary:
    'bg-[var(--taply-lime)] text-[var(--taply-night)] hover:bg-[#d4fd92] active:bg-[#b8ef63] disabled:bg-[rgb(199_252_117/0.35)]',
  secondary:
    'bg-[var(--surface-2)] text-[var(--text-primary)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] disabled:opacity-50',
  ghost: 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--tone-neutral-bg)] disabled:opacity-50',
};

const SIZES: Readonly<Record<Size, string>> = {
  md: 'min-h-[var(--tap-target)] px-4 text-sm',
  lg: 'min-h-[52px] px-5 text-base',
};

function classes(variant: Variant, size: Size, block: boolean, extra?: string): string {
  return [
    'inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-semibold',
    'transition-colors disabled:cursor-not-allowed',
    VARIANTS[variant],
    SIZES[size],
    block ? 'w-full' : '',
    extra ?? '',
  ].join(' ');
}

export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  className,
  type = 'button',
  ...rest
}: ComponentProps<'button'> & {
  readonly variant?: Variant;
  readonly size?: Size;
  readonly block?: boolean;
}) {
  return <button type={type} className={classes(variant, size, block, className)} {...rest} />;
}

export function ButtonLink({
  href,
  variant = 'secondary',
  size = 'md',
  block = false,
  className,
  children,
  external = false,
}: {
  readonly href: string;
  readonly variant?: Variant;
  readonly size?: Size;
  readonly block?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
  /** Opens in a new tab without leaking the opener or referrer. */
  readonly external?: boolean;
}) {
  const cls = classes(variant, size, block, className);
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {children}
      </a>
    );
  }
  // typedRoutes: internal hrefs are app routes; cast is confined to this primitive.
  return (
    <Link href={href as ComponentProps<typeof Link>['href']} className={cls}>
      {children}
    </Link>
  );
}

/** Small inline spinner; hidden from assistive tech, motion-reduced globally. */
export function Spinner({ className }: { readonly className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent ${className ?? ''}`}
    />
  );
}
