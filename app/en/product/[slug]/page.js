import ProductView, { productMetadata, productParams } from '../../../_views/product.js';

/**
 * The English product page, mirroring app/product/[slug]/page.js. Both render
 * app/_views/product.js and differ only in the language they pass it.
 *
 * The language is a compile-time constant rather than something read off the
 * request. English used to be a fiction maintained by middleware, which
 * rewrote /en/product/... onto the Arabic route with `?lang=en` attached — so
 * the page had to await a dynamic API to find out what language it was, which
 * opted it out of static generation and zeroed the revalidate window below.
 * /en is a real path segment now, so this file simply is the English one.
 */

// Prices and stock change, so don't serve a stale page for long. Same window
// as the Arabic page: it is the same catalogue behind both of them.
export const revalidate = 60;

/**
 * Pre-render every product at build time; new ones fall back to on-demand.
 *
 * The English tree needs its own copy of this export — Next reads
 * generateStaticParams per route file, and the Arabic page's does nothing for
 * /en/product/... The slugs are the same in both languages, so both call the
 * one query in the view.
 */
export async function generateStaticParams() {
  return productParams();
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  return productMetadata(slug, 'en');
}

export default async function ProductPage({ params }) {
  const { slug } = await params;
  return <ProductView slug={slug} lang="en" />;
}
