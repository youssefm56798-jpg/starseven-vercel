import { notFound } from 'next/navigation';
import ShopView from '../view.js';
import { shopMeta, KINDS } from '../lib.js';

export const revalidate = 60;

/**
 * Two pages, and only two. Anything else under /shop/ is a 404 rather than
 * another empty grid — the old `?kind=anything` returned a 200 with the whole
 * catalogue on it, which is how a crawl trap starts.
 */
export function generateStaticParams() {
  return KINDS.map(kind => ({ kind }));
}
export const dynamicParams = false;

export async function generateMetadata({ params, searchParams }) {
  const { kind } = await params;
  const sp = await searchParams;
  if (!KINDS.includes(kind)) return { title: 'Not found', robots: { index: false } };
  return shopMeta(kind, sp?.lang === 'en' ? 'en' : 'ar');
}

export default async function ShopKindPage({ params, searchParams }) {
  const { kind } = await params;
  if (!KINDS.includes(kind)) notFound();
  const sp = await searchParams;
  return <ShopView kind={kind} lang={sp?.lang === 'en' ? 'en' : 'ar'} />;
}
