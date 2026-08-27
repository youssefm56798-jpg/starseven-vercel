import OrderDetail, { OrderLinkBroken, readOrder } from '../../_views/order.js';

/**
 * The Arabic order-status page. Its English twin is app/en/order/[ref]/page.js,
 * and the two differ only in the language constant and the title.
 *
 * This route is not being made static and must never be. The token in `?t=` is
 * the credential that opens exactly one order, so a cached copy would be one
 * customer's order served to the next — a security defect rather than a stale
 * page. `force-dynamic` and the request read in readOrder() are both
 * load-bearing, and tests/render-mode exempts this route on those grounds.
 * What the locale migration changed here is only the language, which used to
 * arrive as `?lang=en` through the middleware rewrite. See app/_views/order.js.
 */

export const dynamic = 'force-dynamic';

// Nothing on this page is public and nothing on it is rankable, so it is kept
// out of the index at the page level as well as in app/robots.js. The robots.txt
// disallow stops a well-behaved crawler asking; this stops a URL that leaked
// into a link from being indexed by one that asked anyway.
export const metadata = {
  title: 'حالة الأوردر',
  robots: { index: false, follow: false },
};

export default async function OrderPage({ params, searchParams }) {
  const { order, token } = await readOrder({ params, searchParams });

  // One failure branch, and it has to stay one. A wrong token, a wrong
  // reference and a reference that does not exist must be indistinguishable
  // from outside, or this page becomes a way to ask whether an order exists.
  if (!order) return <OrderLinkBroken lang="ar" />;

  return <OrderDetail order={order} token={token} />;
}
