import OrderFind from '../../_views/order-find.js';

/**
 * The Arabic "email me my link again" page. Its English twin is
 * app/en/order/find/page.js, and the two differ only in the language constant
 * and the title. See app/_views/order-find.js.
 *
 * Dynamic, and it has to be. The form posts to an endpoint that deliberately
 * answers identically whether or not the details matched an order, and a
 * cached rendering of that answer served to the next visitor would be a
 * different customer being told their link had been sent.
 *
 * Not indexed, for the same reason /order/[ref] is not: app/robots.js
 * disallows /order in both trees, and this stops a URL that leaked into a link
 * being indexed by a crawler that asked anyway. It is reached from the
 * broken-link screen and from the footer, which is where somebody holding a
 * dead link actually is.
 */

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'ضاع لينك الأوردر',
  robots: { index: false, follow: false },
};

export default function OrderFindPage() {
  return <OrderFind lang="ar" />;
}
