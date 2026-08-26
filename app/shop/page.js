import ShopView from './view.js';
import { shopMeta } from './lib.js';

// Prices and stock change, so don't serve a stale page for long.
export const revalidate = 60;

export async function generateMetadata({ searchParams }) {
  const sp = await searchParams;
  return shopMeta(null, sp?.lang === 'en' ? 'en' : 'ar');
}

export default async function ShopPage({ searchParams }) {
  const sp = await searchParams;
  return <ShopView kind={null} lang={sp?.lang === 'en' ? 'en' : 'ar'} />;
}
