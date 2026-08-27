import ShopView from './view.js';
import { shopMeta } from './lib.js';

/**
 * The whole line, in Arabic. The English twin is app/en/shop/page.js, and the
 * only difference between the two files is the language constant.
 *
 * The language is pinned here rather than read out of the request. It used to
 * arrive as `?lang=en`, because middleware.js rewrote /en/shop onto this route
 * and `searchParams` was the only channel that reached this far down. That is
 * also what stopped the page ever being prerendered: `searchParams` is a
 * dynamic API, and awaiting it in a legacy prerender opts the route out of
 * static generation and zeroes `revalidate` on the way out. /en is a real path
 * segment now, so each tree states its own language and this file reads nothing
 * request-scoped at all.
 */

// Prices and stock move, so a prerendered copy is only good for a minute. The
// window means something now: with no dynamic API left in the file, Next builds
// this page to HTML and honours the sixty seconds instead of rewriting it to 0.
export const revalidate = 60;

// Static metadata, because it no longer depends on anything but the language of
// the tree this file sits in. shopMeta is pure — see app/shop/lib.js.
export const metadata = shopMeta(null, 'ar');

export default function ShopPage() {
  return <ShopView kind={null} lang="ar" />;
}
