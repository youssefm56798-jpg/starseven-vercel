import ShopView from '../../shop/view.js';
import { shopMeta } from '../../shop/lib.js';

/**
 * The whole line, in English, at /en/shop.
 *
 * This is app/shop/page.js with one word changed, and it is a separate file
 * rather than a shared one because that one word has to be a compile-time
 * constant. A single route file serving both languages could only learn which
 * one it was rendering by reading the request, which is exactly the dynamic API
 * this migration exists to remove. The reasoning is written out in full over
 * the Arabic file; the two must not drift apart.
 */

export const revalidate = 60;

export const metadata = shopMeta(null, 'en');

export default function ShopPage() {
  return <ShopView kind={null} lang="en" />;
}
