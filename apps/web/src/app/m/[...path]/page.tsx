import { notFound } from 'next/navigation';
import { MainnetProduct } from '@/components/mainnet/MainnetProduct';
import { isProductRoute } from '@/lib/mainnet/product';

export default async function Page({ params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join('/');
  if (!isProductRoute(path)) notFound();
  return <MainnetProduct key={path} path={path} />;
}
