import CheckoutView from '../../_views/checkout.js';

/**
 * The English checkout, at /en/checkout.
 *
 * /en/checkout is a live URL today, served by the middleware rewrite that is
 * about to be deleted, so it needs a file of its own or it 404s the moment the
 * rewrite goes. It stays dynamic for the same reasons the Arabic one does, and
 * the two files differ only in the language constant and the title. See
 * app/checkout/page.js and app/_views/checkout.js.
 */

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
};

export default function CheckoutPage({ searchParams }) {
  return <CheckoutView lang="en" searchParams={searchParams} />;
}
