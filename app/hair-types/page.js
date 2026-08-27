import HairTypesIndexView from '../_views/hair-types-index.js';
import { indexMeta } from './lib.js';

// Prices and stock move, so don't serve a stale page for long — same window
// the shop and product pages use.
export const revalidate = 60;

/**
 * Arabic, as a constant, because this file IS the Arabic route.
 *
 * The language used to arrive on `searchParams`: middleware rewrote
 * /en/hair-types onto /hair-types?lang=en, so one route file served both. That
 * made the language a request-time value, and reading a request-time value is
 * what kept this page from ever being prerendered. /en is a real path segment
 * now — app/en/hair-types/page.js is the English twin of this file — so the
 * answer is known when the page is compiled and there is nothing to read.
 *
 * Static metadata rather than generateMetadata for the same reason: with no
 * params and no query to consult, there is nothing left to defer to a request.
 */
export const metadata = indexMeta('ar');

export default function HairTypesPage() {
  return <HairTypesIndexView lang="ar" />;
}
