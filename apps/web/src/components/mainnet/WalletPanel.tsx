'use client';

import { Button, Spinner } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import { useT } from '@/lib/i18n/provider';
import { useMainnetWallet } from '@/lib/mainnet/wallet';
import { Notice } from './bits';
import { fill, useMainnetCopy } from '@/lib/mainnet/copy';

/** Connect/disconnect a NEAR mainnet wallet. Connecting signs nothing and adds no key. */
/** `primary`: the Testnet ConnectWalletButton look (first-launch card). */
export function WalletPanel({ primary = false }: { readonly primary?: boolean } = {}) {
  const c = useMainnetCopy();
  const t = useT();
  const w = useMainnetWallet();
  return (
    <div className="flex flex-col gap-2">
      {w.status === 'connected' && w.accountId !== null ? (
        <div className="flex items-center justify-between gap-3">
          <p data-testid="wallet-account" className="min-w-0 break-all text-[14px]">{fill(c.wallet.connectedAs, { account: w.accountId })}</p>
          <Button variant="ghost" onClick={() => void w.disconnect()}>{c.wallet.disconnect}</Button>
        </div>
      ) : (
        primary ? (
          <Button variant="primary" size="lg" block onClick={() => void w.connect()} disabled={w.status === 'connecting'}>
            {w.status === 'connecting' ? <Spinner /> : <Icon name="wallet" />}
            {w.status === 'connecting' ? t.wallet.connecting : t.wallet.connect}
          </Button>
        ) : (
          <Button variant="secondary" block onClick={() => void w.connect()} disabled={w.status === 'connecting'}>
            {w.status === 'connecting' ? c.wallet.connecting : c.wallet.connect}
          </Button>
        )
      )}
      {w.error !== null && (
        <Notice tone="danger" live>
          {w.error === 'unavailable' ? c.wallet.unavailable : w.error === 'rejected' ? c.wallet.rejected : w.error === 'testnet_account' ? c.wallet.testnetAccount : c.wallet.failed}
        </Notice>
      )}
    </div>
  );
}
