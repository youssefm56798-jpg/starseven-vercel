import BrandView, { brandMeta } from '../../_views/brand.js';

/**
 * The English brand page, at /en/brand.
 *
 * /en is a real path segment, so this file exists purely to name the language
 * of the shared view. Pinning it as a constant is what lets the page prerender:
 * every channel that could carry a locale in from outside — `searchParams`,
 * `headers()`, a cookie — is a dynamic API, and touching one opts the route out
 * of static generation and zeroes the `revalidate` window below.
 */

// Matches the Arabic twin at app/brand/page.js: both count and list the same
// live range and must not disagree about how stale that count is allowed to be.
export const revalidate = 300;

export const metadata = brandMeta('en');

export default function BrandPageEn() {
  return <BrandView lang="en" />;
}
