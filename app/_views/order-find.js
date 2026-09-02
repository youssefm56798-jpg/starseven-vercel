import Link from 'next/link';
import { localePath } from '../../lib/urls.js';
import { Dir, Nav, Footer, waLink } from '../_components/Chrome.js';
// The bracketed sibling folder is a real directory name, not a placeholder.
// Only page.js, layout.js and route.js are routes, so a client component
// colocated with the route it belongs to is ordinary module resolution.
import FindForm from '../order/find/FindForm.js';

/**
 * "I lost the link", rendered once and mounted at /order/find and
 * /en/order/find.
 *
 * There are no accounts here, so the confirmation email was the only way back
 * into an order — and losing it was a dead end, because the token in it was
 * never stored. See lib/order-access.js. An order can hold several live links
 * now, so this page can hand out another one without breaking the first.
 *
 * What it must not become is a way to find out whether an order exists. The
 * endpoint behind it answers the same sentence to a customer and to a stranger
 * guessing; the reasoning is written out in app/api/order/find/route.js, and
 * the copy on this page is written to be true in both cases.
 *
 * Split into a view here and two thin route files for the same reason
 * app/_views/order.js is: the language is a constant per file and the markup
 * has one copy, so the two trees cannot drift apart.
 *
 * `/order/find` sits beside `/order/[ref]` and wins, because Next matches a
 * static segment before a dynamic one. No reference can collide with it —
 * every one this shop mints begins S7-.
 */
export default function OrderFind({ lang }) {
  const ar = lang !== 'en';
  const L = p => localePath(p, ar ? 'ar' : 'en');

  return (
    <Dir lang={ar ? 'ar' : 'en'}>
      {/* The full path, not just "order". Nav builds the language toggle as
          localePath('/' + path), so the short form would send the Arabic
          reader of this page to /order — which no route file answers. */}
      <Nav lang={ar ? 'ar' : 'en'} path="order/find" />
      <main id="content">

      <div className="wrap ordpage">
        <div className="ord-head">
          <h1>{ar ? 'ضاع لينك الأوردر؟' : 'Lost your order link?'}</h1>
        </div>

        <p className="ord-lead">
          {ar
            ? 'اكتب الإيميل اللي طلبت بيه ورقم الأوردر، وهنبعتلك لينك جديد للمتابعة. رقم الأوردر موجود في إيميل تأكيد الأوردر وشكله كده: ‎#100001'
            : 'Enter the email you ordered with and your order number, and we will send you a fresh tracking link. The number is in your order confirmation email and looks like #100001'}
        </p>

        <FindForm lang={ar ? 'ar' : 'en'} />

        <p className="ord-help">
          {ar ? 'مش لاقي رقم الأوردر؟ ' : 'Cannot find your order number? '}
          <a
            href={waLink(ar
              ? 'ضاع مني رقم الأوردر ومحتاج أتابع طلبي'
              : 'I have lost my order number and need to track my order')}
            target="_blank"
            rel="noopener"
          >
            {ar ? 'كلّمنا على واتساب' : 'Message us on WhatsApp'}
          </a>
          {' · '}
          <Link href={L('/shop')}>{ar ? 'كمّل تسوق' : 'Keep shopping'}</Link>
        </p>
      </div>

      </main>
      <Footer lang={ar ? 'ar' : 'en'} />
    </Dir>
  );
}
