import { notFound } from 'next/navigation';
import ShopView from '../../../shop/view.js';
import { shopMeta, KINDS, liveCategories } from '../../../shop/lib.js';
import { sql } from '../../../../lib/db.js';

/**
 * One page per category, in English, at /en/shop/[kind].
 *
 * This is app/shop/[kind]/page.js with one word changed, and it has to be a
 * separate file because that word must be a compile-time constant — a single
 * route file serving both languages could only tell them apart by reading the
 * request, which is the dynamic API this migration removes.
 *
 * Everything worth explaining is explained over the Arabic file: why
 * generateStaticParams asks the database instead of returning all seven slugs,
 * why dynamicParams is true, and why the `KINDS.includes(kind)` guard below is
 * the thing that keeps /en/shop/anything from answering 200. Read that file
 * before changing this one, and change both together — a category that is
 * prerendered in one language and not the other is a difference nobody will
 * notice until it is in production.
 */

export async function generateStaticParams() {
  try {
    const rows = await sql`SELECT DISTINCT kind FROM products WHERE active = true`;
    return liveCategories(rows.map(r => r.kind)).map(c => ({ kind: c.slug }));
  } catch {
    return [];   // no database at build time — categories render on request instead
  }
}

export const dynamicParams = true;

export const revalidate = 60;

export async function generateMetadata({ params }) {
  const { kind } = await params;
  if (!KINDS.includes(kind)) return { title: 'Not found', robots: { index: false } };
  return shopMeta(kind, 'en');
}

export default async function ShopKindPage({ params }) {
  const { kind } = await params;
  if (!KINDS.includes(kind)) notFound();

  // The empty-category 404 lives in the view, which already has the product
  // list this check needs. See app/shop/view.js.
  return <ShopView kind={kind} lang="en" />;
}
