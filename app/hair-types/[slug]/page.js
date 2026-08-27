import HairTypeView, { hairTypeMeta } from '../../_views/hair-type.js';
import { HAIR_SLUGS } from '../lib.js';

export const revalidate = 60;

/** Six pages, and only six. The slugs are data, not a hand-typed list. */
export function generateStaticParams() {
  return HAIR_SLUGS.map(slug => ({ slug }));
}

/**
 * Arabic, as a constant, because this file IS the Arabic route.
 *
 * The language used to arrive on `searchParams`: middleware rewrote
 * /en/hair-types/fine onto /hair-types/fine?lang=en, so one route file served
 * both. Awaiting a dynamic API opts a route out of static generation, which
 * meant the six params enumerated above were rendered on demand anyway and the
 * `revalidate` window above was quietly overwritten with zero. /en is a real
 * path segment now — app/en/hair-types/[slug]/page.js is the English twin of
 * this file — so the language is known at build time and only the slug is not.
 *
 * `params` is still awaited, and that is fine: it is the route's own address
 * rather than a property of the request, and generateStaticParams hands it
 * over at build time.
 */
export async function generateMetadata({ params }) {
  const { slug } = await params;
  return hairTypeMeta(slug, 'ar');
}

export default async function HairTypePage({ params }) {
  const { slug } = await params;
  return <HairTypeView slug={slug} lang="ar" />;
}
