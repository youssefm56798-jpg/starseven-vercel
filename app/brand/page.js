import BrandView, { brandMeta } from '../_views/brand.js';

/**
 * The Arabic brand page, at /brand.
 *
 * The language is a constant rather than something read off the request. It is
 * the one fact this file adds to the shared view, and hard-coding it is what
 * lets the page prerender: every channel that could carry a locale in from
 * outside — `searchParams`, `headers()`, a cookie — is a dynamic API, and
 * touching one opts the route out of static generation and zeroes the
 * `revalidate` window below. English is the same view at app/en/brand/page.js.
 */

// The page counts the live waxes and gels and lists the whole range, so it goes
// stale the moment the client switches a product on or off.
export const revalidate = 300;

export const metadata = brandMeta('ar');

export default function BrandPage() {
  return <BrandView lang="ar" />;
}
