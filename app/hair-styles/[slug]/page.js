import HairStyleView, { hairStyleMeta } from '../../_views/hair-style.js';
import { STYLE_SLUGS } from '../lib.js';

export const revalidate = 60;

/** Six pages, and only six. The slugs are data, not a hand-typed list. */
export function generateStaticParams() {
  return STYLE_SLUGS.map(slug => ({ slug }));
}

/**
 * Arabic, as a constant, because this file IS the Arabic route.
 *
 * `params` is awaited and that is fine: it is the route's own address rather
 * than a property of the request, and generateStaticParams hands it over at
 * build time. What would cost the page its prerender is reading `searchParams`
 * or `headers()` for the language, and there is nothing to read — the English
 * twin lives at app/en/hair-styles/[slug]/page.js.
 *
 * dynamicParams is deliberately left at its default of true. The six above are
 * the ones that get built ahead of time; a seventh slug someone types is
 * rendered on demand, and app/_views/hair-style.js answers it with notFound()
 * and a noindex title. There is no crawl trap here to close.
 */
export async function generateMetadata({ params }) {
  const { slug } = await params;
  return hairStyleMeta(slug, 'ar');
}

export default async function HairStylePage({ params }) {
  const { slug } = await params;
  return <HairStyleView slug={slug} lang="ar" />;
}
