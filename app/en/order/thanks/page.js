import OrderThanksView, { orderThanksMeta } from '../../../_views/order-thanks.js';

/** The English thank-you page. See app/order/thanks/page.js. */
export const dynamic = 'force-dynamic';

export const metadata = orderThanksMeta('en');

export default async function OrderThanksPage({ searchParams }) {
  const sp = await searchParams;
  return <OrderThanksView lang="en" refCode={sp?.ref} />;
}
