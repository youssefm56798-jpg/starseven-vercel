import HairStyleView, { hairStyleMeta } from '../../../_views/hair-style.js';
import { STYLE_SLUGS } from '../../../hair-styles/lib.js';

// The same window as the Arabic twin. Both pages rank the same catalogue, so
// letting them fall out of step would serve one language a pick the other had
// already dropped.
export const revalidate = 60;

/**
 * The English tree enumerates its own six pages.
 *
 * generateStaticParams does not cross route trees: app/hair-styles/[slug] lists
 * the slugs it will prerender under the bare path, and says nothing at all
 * about /en. Without this the six English pages would be built on first request
 * instead — and app/sitemap.js submits every one of them to Search Console, so
 * they are the last pages that should be discovered cold.
 */
export function generateStaticParams() {
  return STYLE_SLUGS.map(slug => ({ slug }));
}

/**
 * English, as a constant, because this file IS the English route.
 *
 * There is no query string to consult and no header to read: the /en in the
 * URL is a real path segment, and reaching this file is itself the answer to
 * "which language?". Only the slug is unknown, and `params` carries that — it
 * is the route's own address rather than a property of the request, so awaiting
 * it costs the page nothing.
 */
export async function generateMetadata({ params }) {
  const { slug } = await params;
  return hairStyleMeta(slug, 'en');
}

export default async function EnHairStylePage({ params }) {
  const { slug } = await params;
  return <HairStyleView slug={slug} lang="en" />;
}
