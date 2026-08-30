import OrderThanksView, { orderThanksMeta } from '../../_views/order-thanks.js';

/**
 * The Arabic thank-you page, at /order/thanks. English twin at
 * app/en/order/thanks/page.js.
 *
 * Dynamic because it reads the order reference out of the query string, which
 * is a per-visitor value and nothing to prerender. app/robots.js already
 * disallows /order, and the view sets robots noindex as well.
 */
export const dynamic = 'force-dynamic';

export const metadata = orderThanksMeta('ar');

export default async function OrderThanksPage({ searchParams }) {
  const sp = await searchParams;
  return <OrderThanksView lang="ar" refCode={sp?.ref} />;
}
