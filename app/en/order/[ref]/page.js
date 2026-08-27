import OrderDetail, { OrderLinkBroken, readOrder } from '../../../_views/order.js';

/**
 * The English order-status page, at /en/order/[ref].
 *
 * /en/order/... is a live URL today — it is where the confirmation email sends
 * an English customer — and it is served by the middleware rewrite that is
 * about to be deleted, so it needs a file of its own or those links 404. It
 * stays dynamic for the same reasons the Arabic one does, and the two files
 * differ only in the language constant and the title. See
 * app/order/[ref]/page.js and app/_views/order.js.
 *
 * That constant decides the language of the broken-link screen only. A real
 * order is shown in the language it was placed in, whichever tree the customer
 * opened it from, which is why OrderDetail below takes no language at all.
 */

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Order status',
  robots: { index: false, follow: false },
};

export default async function OrderPage({ params, searchParams }) {
  const { order, token } = await readOrder({ params, searchParams });

  // The same single failure branch as the Arabic route, saying the same thing
  // in the other language. See app/order/[ref]/page.js.
  if (!order) return <OrderLinkBroken lang="en" />;

  return <OrderDetail order={order} token={token} />;
}
