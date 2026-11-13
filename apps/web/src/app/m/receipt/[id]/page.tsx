import { notFound } from 'next/navigation';
import { ContractReceipt } from '@/components/mainnet/Activity';
import { IS_MAINNET_BUILD } from '@/lib/mainnet/build';

/** Contract-state receipt (mainnet build only). Never "Verified Paid". */
export default async function MainnetReceiptPage({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  if (!IS_MAINNET_BUILD) notFound();
  const { id } = await params;
  if (!/^[0-9a-f]{64}$/.test(id)) notFound();
  return <ContractReceipt id={id} />;
}
