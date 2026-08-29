import OrderFind from '../../../_views/order-find.js';

/**
 * The English "email me my link again" page, at /en/order/find.
 *
 * It differs from the Arabic route file in the language constant and the title
 * and in nothing else — the markup has one copy, in app/_views/order-find.js,
 * so the two trees cannot drift. Dynamic and noindex for the same reasons.
 * See app/order/find/page.js.
 */

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Lost your order link',
  robots: { index: false, follow: false },
};

export default function OrderFindPage() {
  return <OrderFind lang="en" />;
}
