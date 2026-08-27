import HairTypesIndexView from '../../_views/hair-types-index.js';
import { indexMeta } from '../../hair-types/lib.js';

// The same window as the Arabic twin. The two pages read the same catalogue,
// so letting them fall out of step would serve one language a price the other
// had already stopped showing.
export const revalidate = 60;

/**
 * English, as a constant, because this file IS the English route.
 *
 * There is no query string to consult and no header to read: the /en in the
 * URL is a real path segment, and reaching this file is itself the answer to
 * "which language?". That is the whole point of the twin — a route file that
 * has to ask the request what it is cannot be prerendered.
 *
 * Static metadata rather than generateMetadata: with no params and no query,
 * there is nothing left to defer to a request.
 */
export const metadata = indexMeta('en');

export default function EnHairTypesPage() {
  return <HairTypesIndexView lang="en" />;
}
