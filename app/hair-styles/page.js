import HairStylesIndexView from '../_views/hair-styles-index.js';
import { styleIndexMeta } from './lib.js';

// Prices and stock move, so do not serve a stale page for long — the same
// window /hair-types, the shop and the product pages use.
export const revalidate = 60;

/**
 * Arabic, as a constant, because this file IS the Arabic route.
 *
 * The language is never read from the request. `searchParams` and `headers()`
 * are dynamic APIs, and awaiting either opts a route out of static generation
 * and zeroes the revalidate window declared above on the way out — a page that
 * says it caches for a minute and in fact caches nothing. /en is a real path
 * segment, so app/en/hair-styles/page.js is the English twin of this file and
 * the answer is known when the page is compiled.
 *
 * Static metadata rather than generateMetadata for the same reason: with no
 * params and no query to consult, there is nothing left to defer to a request.
 */
export const metadata = styleIndexMeta('ar');

export default function HairStylesPage() {
  return <HairStylesIndexView lang="ar" />;
}
