import { notFound } from 'next/navigation';
import ShopView from '../view.js';
import { shopMeta, KINDS, liveCategories } from '../lib.js';
import { sql } from '../../../lib/db.js';

/**
 * One page per category, in Arabic. The English twin is
 * app/en/shop/[kind]/page.js and carries the same two guards; the reasoning
 * below covers both.
 *
 * The language is a constant now. It used to arrive as `?lang=en` from the
 * middleware rewrite, which meant awaiting `searchParams` — a dynamic API that
 * opts the route out of static generation and zeroes `revalidate` on its way
 * out, so nothing here was ever prerendered and the sixty-second window below
 * never once applied. /en is a real path segment, so the only thing this file
 * reads is `params`, which is not a dynamic API and does not cost the prerender.
 */

/**
 * The categories worth building HTML for: the ones that hold a live product.
 *
 * This deliberately no longer returns all seven slugs. app/shop/view.js 404s a
 * category with nothing live in it, so listing an unpriced category here would
 * ask the build to prerender a 404 and then serve that 404 from the cache —
 * which is a build artefact nobody would think to look at when the client
 * finally prices the thing and the page stays gone.
 *
 * The segment is named `kind` because the URL is /shop/[kind], but the value it
 * carries is a category's URL SLUG, not its `kind` column: /shop/cream-gel
 * selects kind = 'cream'. liveCategories() is the function that already does
 * that translation, and app/shop/lib.js explains at length why the two strings
 * are kept apart. Doing the mapping by hand here is how they get conflated.
 *
 * A build with no DATABASE_URL has to succeed — that is the condition on any
 * checkout without a .env, and every other route file in this repo degrades the
 * same way. Returning nothing prerenders nothing, which is a slower shop rather
 * than a broken one, precisely because dynamicParams stays true below.
 */
export async function generateStaticParams() {
  try {
    const rows = await sql`SELECT DISTINCT kind FROM products WHERE active = true`;
    return liveCategories(rows.map(r => r.kind)).map(c => ({ kind: c.slug }));
  } catch {
    return [];   // no database at build time — categories render on request instead
  }
}

/**
 * Why this is true, when the whole point of the old `false` was to close a
 * crawl trap.
 *
 * `dynamicParams = false` refuses any param that generateStaticParams did not
 * return, at the routing layer, before this file runs. That was safe while the
 * list was the complete, hard-coded set of seven categories. It is not safe now
 * that the list is whatever the database happened to hold at build time:
 *
 *   - The day the client prices cologne, /shop/cologne would 404 until somebody
 *     redeployed. No `revalidate` can rescue it, because revalidation refreshes
 *     pages the route is willing to render, and a rejected param never gets
 *     that far.
 *   - On a build with no DATABASE_URL the list is empty, and `false` would turn
 *     that from a shop that prerenders nothing into a shop where every single
 *     category 404s.
 *
 * With `true`, an unpriced category is simply rendered on request and 404s
 * through the view's own check, which means the 404 inherits `revalidate = 60`
 * and corrects itself a minute after the catalogue changes rather than at the
 * next deploy.
 *
 * What `false` was actually protecting is now protected by the line in the page
 * body below, and it is worth being exact about this because the obvious
 * assumption is wrong. app/shop/view.js does NOT reject an unknown slug: it
 * computes `active = KINDS.includes(kind) ? kind : 'all'`, so /shop/bogus falls
 * through to the whole-catalogue branch, its `products.length === 0` check never
 * fires, and the page would answer 200 with the entire catalogue on it — the
 * exact crawl trap the old `?kind=anything` filter was. The guard that closes
 * it is `KINDS.includes(kind)` in this file, which runs before the view is ever
 * reached. That check is load-bearing and must not be removed on the grounds
 * that the view "already handles it".
 *
 * So the three cases, all still closed: a live category is prerendered, an
 * unpriced one renders on demand and 404s in the view, and an invented slug
 * 404s here without touching the database.
 */
export const dynamicParams = true;

// Prices and stock move, so the prerendered copy is only good for a minute.
export const revalidate = 60;

export async function generateMetadata({ params }) {
  const { kind } = await params;
  if (!KINDS.includes(kind)) return { title: 'Not found', robots: { index: false } };
  return shopMeta(kind, 'ar');
}

export default async function ShopKindPage({ params }) {
  const { kind } = await params;
  if (!KINDS.includes(kind)) notFound();

  // A category holding nothing live 404s as well, so the shop never offers a
  // page for something it cannot sell. That check used to be a SELECT of its
  // own here, awaited to completion before the view was allowed to begin; the
  // view's own product list gives the same answer for free, so it makes the
  // call itself now. See app/shop/view.js.
  return <ShopView kind={kind} lang="ar" />;
}
