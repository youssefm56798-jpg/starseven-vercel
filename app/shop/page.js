import ShopView from './view.js';
import { shopMeta } from './lib.js';

// Prices and stock change, so don't serve a stale page for long. In practice
// this window is never reached: awaiting `searchParams` below opts the route
// out of static rendering entirely. Why the language has to arrive that way,
// and what it would take to change, is written out over app/shop/[kind]/page.js.
export const revalidate = 60;

export async function generateMetadata({ searchParams }) {
  const sp = await searchParams;
  return shopMeta(null, sp?.lang === 'en' ? 'en' : 'ar');
}

export default async function ShopPage({ searchParams }) {
  const sp = await searchParams;
  return <ShopView kind={null} lang={sp?.lang === 'en' ? 'en' : 'ar'} />;
}
