'use client';

import { Card } from '@/components/primitives/Surface';
import { WalletPanel } from './WalletPanel';

/** The Testnet "connect first" card: text + the primary connect button. */
export function NoWalletCard({ text }: { readonly text: string }) {
  return (
    <Card className="flex flex-col gap-4 p-5">
      <p className="text-sm text-[var(--text-secondary)]">{text}</p>
      <WalletPanel primary />
    </Card>
  );
}
