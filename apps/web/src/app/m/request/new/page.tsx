import { notFound } from 'next/navigation';
import { CreateRequest } from '@/components/mainnet/CreateRequest';
import { IS_MAINNET_BUILD } from '@/lib/mainnet/build';

export default function MainnetCreateRequestPage() {
  if (!IS_MAINNET_BUILD) notFound();
  return <CreateRequest />;
}
