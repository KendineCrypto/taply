'use client';

import { Icon } from '@/components/shell/Icons';
import { fill } from '@/lib/i18n/fill';
import { useT } from '@/lib/i18n/provider';

/**
 * Which kind of wallet controls the account. The two must never look alike:
 *  - external: a NEAR wallet connected through NEAR Connect. Keys stay there.
 *  - native:   the Taply Wallet (encrypted local vault on this device). Its
 *              signing is off; the payments provider never uses it.
 */
export function WalletKindBadge({
  kind,
  walletName,
}: {
  readonly kind: 'external' | 'native';
  readonly walletName?: string;
}) {
  const t = useT();
  if (kind === 'native') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--taply-lime)]">
        <Icon name="shield" size={13} />
        {t.walletUx.kind.native}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-xs text-[var(--text-muted)]">
      <Icon name="link" size={13} />
      <span>{t.walletUx.kind.external}</span>
      {walletName !== undefined && <span>· {fill(t.walletUx.kind.externalVia, { wallet: walletName })}</span>}
    </span>
  );
}
