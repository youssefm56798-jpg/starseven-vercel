import ProductView, { productMetadata, productParams } from '../../_views/product.js';

/**
 * The Arabic product page. Its English twin is app/en/product/[slug]/page.js
 * and the two share app/_views/product.js.
 *
 * The language is a compile-time constant rather than something read off the
 * request, and that is the whole point of this file. It used to arrive as a
 * `?lang=` query parameter that middleware rewrote /en/product/... onto, which
 * meant awaiting a dynamic API here — enough on its own to opt the route out of
 * static generation and to quietly rewrite the revalidate window below to zero.
 * Now that /en is a real path segment, the address already says which language
 * it is, so the file says it too and the page can prerender.
 */

// Prices and stock change, so don't serve a stale page for long.
export const revalidate = 60;

/** Pre-render every product at build time; new ones fall back to on-demand. */
export async function generateStaticParams() {
  return productParams();
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  return productMetadata(slug, 'ar');
}

export default async function ProductPage({ params }) {
  const { slug } = await params;
  return <ProductView slug={slug} lang="ar" />;
}
