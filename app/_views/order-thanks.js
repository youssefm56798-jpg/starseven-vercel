import Link from 'next/link';
import { Dir, Nav, Footer, Crumb } from '../_components/Chrome.js';
import { localePath } from '../../lib/urls.js';
import { formatRef, normaliseRef } from '../../lib/order-number.js';
import { site } from '../../lib/config.js';

/**
 * The thank-you page, at its own address.
 *
 * Checkout used to swap itself for a success panel in place, which meant a
 * completed order and an abandoned one shared a URL. Three things came out of
 * that, and only the third is about analytics:
 *
 *   the back button   went to a form the customer had already submitted, with
 *                     the cart cleared underneath it - so the honest reading of
 *                     that screen was "your order vanished".
 *
 *   the address bar   still said /checkout on the one screen a customer wants
 *                     to screenshot or send to somebody.
 *
 *   the funnel        had no page to mark as the end of it. GA4 gets `purchase`
 *                     from CheckoutClient either way, but a destination URL is
 *                     what Google Ads and Search Console can be pointed at, and
 *                     what a human reading the analytics recognises.
 *
 * The order reference travels in the query string on purpose, and it is not a
 * credential: it is printed in the confirmation email and read out on the
 * phone. What opens an order is the token in `?t=`, which lives only in that
 * email and never appears here. So this page shows the reference and links to
 * the finder rather than deep-linking into the order - somebody who lands on
 * this URL with a guessed reference learns nothing they could not guess.
 *
 * app/robots.js disallows /order, so this is not indexed, which is what a
 * thank-you page should be.
 */
export default function OrderThanksView({ lang, refCode }) {
  const ar = lang === 'ar';
  const L = p => localePath(p, lang);
  /*
   * Normalised on the way in and formatted on the way out, because this value
   * arrives from the query string and a stranger can type anything into it.
   * normaliseRef strips the decoration a customer may have pasted back; the
   * slice is what stops the page rendering an essay somebody put in ?ref=.
   */
  const ref = formatRef(normaliseRef(refCode).slice(0, 32));

  return (
    <Dir lang={lang}>
      <Nav lang={lang} path="order" />
      <div className="wrap">
        <div style={{ marginTop: '34px' }}>
          <Crumb lang={lang} trail={[{ label: ar ? 'تم استلام الأوردر' : 'Order received' }]} />
        </div>

        <div className="co-done" style={{ marginTop: 18 }}>
          <div className="star">★</div>
          {ref ? <div className="ref" dir="ltr">{ref}</div> : null}
          <h1>{ar ? 'استلمنا طلبك' : 'Order received'}</h1>
          <p>
            {ar
              ? 'هنكلمك على الموبايل نأكد العنوان وميعاد التوصيل. الدفع عند الاستلام — مش محتاج تدفع حاجة دلوقتي.'
              : 'We will call you to confirm the address and the delivery slot. Cash on delivery — nothing to pay now.'}
          </p>

          {/* The next step, which is the part a thank-you page is actually for. */}
          <div className="nf-links" style={{ marginTop: 6 }}>
            <Link className="btn btn-red" href={L('/order/find')}>
              {ar ? 'تابع الأوردر' : 'Track your order'}
            </Link>
            <a
              className="btn btn-line"
              href={`https://wa.me/${site.whatsapp}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {ar ? 'كلّمنا واتساب' : 'Message us on WhatsApp'}
            </a>
          </div>

          <p className="nf-more" style={{ marginTop: 18 }}>
            {ar
              ? 'بعتنالك إيميل فيه لينك تتابع بيه الأوردر. لو مالقتهوش، بص في السبام.'
              : 'We have emailed you a link to follow the order. If it has not arrived, check your spam folder.'}
          </p>

          <p className="nf-more">
            <Link href={L('/shop')}>{ar ? 'ارجع للتسوق' : 'Back to shopping'}</Link>
          </p>
        </div>
      </div>
      <Footer lang={lang} />
    </Dir>
  );
}

export function orderThanksMeta(lang) {
  const ar = lang === 'ar';
  return {
    title: ar ? 'استلمنا طلبك' : 'Order received',
    // Not indexed, and it should not be: a thank-you page reached from a search
    // result is a thank-you page somebody did not earn.
    robots: { index: false, follow: false },
  };
}
