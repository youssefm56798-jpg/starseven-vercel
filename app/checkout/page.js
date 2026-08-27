import CheckoutView from '../_views/checkout.js';

/**
 * The Arabic checkout. Its English twin is app/en/checkout/page.js, and the two
 * differ only in the language constant and the title.
 *
 * Unlike the rest of the storefront this route is not being made static, and
 * the `searchParams` handed down below is deliberate: the page reads `?add=` so
 * a product page's Add button can drop a SKU into the cart, and it queries live
 * prices to show what the customer is about to pay. tests/render-mode exempts
 * it for that reason. Only the language moved out of the request — it used to
 * arrive as `?lang=en` through the middleware rewrite. See
 * app/_views/checkout.js.
 */

// Always fresh: prices and stock decide what the customer is about to pay.
export const dynamic = 'force-dynamic';

// A cart is a per-visitor page with nothing rankable on it. app/robots.js
// disallows /checkout and /en/checkout by name as well; this is the half that
// survives a crawler that asked anyway.
export const metadata = {
  title: 'إتمام الطلب',
  robots: { index: false, follow: false },
};

export default function CheckoutPage({ searchParams }) {
  return <CheckoutView lang="ar" searchParams={searchParams} />;
}
