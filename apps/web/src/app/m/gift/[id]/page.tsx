import { notFound } from 'next/navigation';
import { OpenGiftPage } from '@/components/mainnet/GiftPages';
import { MainnetProduct } from '@/components/mainnet/MainnetProduct';
import { IS_MAINNET_BUILD } from '@/lib/mainnet/build';

/** `/m/gift/<32-hex id>` Open Gift (claim/expiry/refund/retry); `new` and `p` stay product screens. */
export default async function MainnetGiftPage({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  if (!IS_MAINNET_BUILD) notFound();
  const { id } = await params;
  if (id === 'new' || id === 'p') return <MainnetProduct key={id} path={`gift/${id}`} />;
  if (!/^[0-9a-f]{32}$/.test(id)) notFound();
  return <OpenGiftPage id={id} />;
}
