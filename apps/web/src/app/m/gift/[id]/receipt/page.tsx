import { notFound } from 'next/navigation';
import { OpenGiftReceipt } from '@/components/mainnet/GiftPages';
import { IS_MAINNET_BUILD } from '@/lib/mainnet/build';

/** Open Gift receipt from the Gift contract's own record (never "Verified Paid"). */
export default async function MainnetGiftReceiptPage({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  if (!IS_MAINNET_BUILD) notFound();
  const { id } = await params;
  if (!/^[0-9a-f]{32}$/.test(id)) notFound();
  return <OpenGiftReceipt id={id} />;
}
