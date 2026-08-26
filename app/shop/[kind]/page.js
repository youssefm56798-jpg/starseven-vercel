import { notFound } from 'next/navigation';
import ShopView from '../view.js';
import { shopMeta, KINDS, kindColumn } from '../lib.js';
import { sql, hasDb } from '../../../lib/db.js';

export const revalidate = 60;

/**
 * One page per category, and only those. Anything else under /shop/ is a 404
 * rather than another empty grid — the old `?kind=anything` returned a 200
 * with the whole catalogue on it, which is how a crawl trap starts.
 */
export function generateStaticParams() {
  return KINDS.map(kind => ({ kind }));
}
export const dynamicParams = false;

/**
 * Whether a category has anything to show.
 *
 * Most of the range is seeded unpriced and inactive, waiting on the client. An
 * empty category page is worse than no page: it is a thin, indexable URL that
 * says the shop sells something it currently cannot sell. So an empty category
 * 404s until its first product goes live, and the sitemap agrees.
 */
async function isStocked(slug) {
  if (!hasDb()) return true;   // no database in a preview build — don't 404 everything
  try {
    const rows = await sql`
      SELECT 1 FROM products
       WHERE active = true AND kind = ${kindColumn(slug)} LIMIT 1`;
    return rows.length > 0;
  } catch {
    return true;
  }
}

export async function generateMetadata({ params, searchParams }) {
  const { kind } = await params;
  const sp = await searchParams;
  if (!KINDS.includes(kind)) return { title: 'Not found', robots: { index: false } };
  return shopMeta(kind, sp?.lang === 'en' ? 'en' : 'ar');
}

export default async function ShopKindPage({ params, searchParams }) {
  const { kind } = await params;
  if (!KINDS.includes(kind)) notFound();
  if (!(await isStocked(kind))) notFound();

  const sp = await searchParams;
  return <ShopView kind={kind} lang={sp?.lang === 'en' ? 'en' : 'ar'} />;
}
