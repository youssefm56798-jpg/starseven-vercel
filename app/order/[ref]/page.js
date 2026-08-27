import Link from 'next/link';
import { localePath } from '../../../lib/urls.js';
import { currencyLabel, whole } from '../../../lib/money.js';
import { orderFor, itemsFor } from '../../../lib/order-access.js';
import { Dir, Nav, Footer, waLink } from '../../_components/Chrome.js';
import RefundRequest from './RefundRequest.js';

/**
 * A customer looking at their own order.
 *
 * There is no account behind this. The link in the confirmation email carries
 * a token, the token is the credential, and it opens exactly one order. See
 * lib/order-access.js for why it is built that way.
 *
 * Always dynamic and never cached: the whole point is that the status is
 * current, and a cached copy would be a stranger's order served to whoever
 * asked next.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'حالة الأوردر',
  robots: { index: false, follow: false },
};

const STATUS = {
  new: { ar: 'استلمنا الأوردر', en: 'Order received', step: 1 },
  confirmed: { ar: 'اتأكد بالتليفون', en: 'Confirmed by phone', step: 2 },
  shipped: { ar: 'في الطريق ليك', en: 'On its way', step: 3 },
  delivered: { ar: 'اتسلّم', en: 'Delivered', step: 4 },
  cancelled: { ar: 'اتلغى', en: 'Cancelled', step: 0 },
};

export default async function OrderPage({ params, searchParams }) {
  const { ref } = await params;
  const sp = await searchParams;
  const token = typeof sp?.t === 'string' ? sp.t : '';

  const order = await orderFor(ref, token);

  // A wrong token, a wrong reference, and a reference that does not exist all
  // land here with the same words. Distinguishing them would turn this page
  // into a way to test whether an order reference is real.
  if (!order) {
    const lang = sp?.lang === 'en' ? 'en' : 'ar';
    const ar = lang === 'ar';
    return (
      <Dir lang={lang}>
        <Nav lang={lang} path="order" />
        <div className="wrap nf">
          <h1>{ar ? 'اللينك ده مش شغال' : 'That link does not work'}</h1>
          <p>
            {ar
              ? 'يمكن اللينك ناقص، أو اتنسخ غلط. افتحه من إيميل تأكيد الأوردر مرة تانية — أو كلّمنا على واتساب ومعاك رقم الأوردر.'
              : 'The link may be incomplete, or copied wrong. Open it again from your order confirmation email — or message us on WhatsApp with your order number.'}
          </p>
          <div className="nf-links">
            <a className="btn btn-red" href={waLink()} target="_blank" rel="noopener">
              {ar ? 'كلّمنا على واتساب' : 'Message us on WhatsApp'}
            </a>
            <Link className="btn btn-line" href={localePath('/', lang)}>
              {ar ? 'الرئيسية' : 'Home'}
            </Link>
          </div>
        </div>
        <Footer lang={lang} />
      </Dir>
    );
  }

  // The order remembers the language it was placed in, so the page comes back
  // in the language the customer actually used.
  const lang = order.lang === 'en' ? 'en' : 'ar';
  const ar = lang === 'ar';
  const L = p => localePath(p, lang);

  const items = await itemsFor(order.id);
  const st = STATUS[order.status] || STATUS.new;
  const cancelled = order.status === 'cancelled';
  const money = v => `${whole(v)} ${currencyLabel(lang)}`;

  const steps = ['new', 'confirmed', 'shipped', 'delivered'];

  return (
    <Dir lang={lang}>
      <Nav lang={lang} path="order" />

      <div className="wrap ordpage">
        <div className="ord-head">
          <span className="ord-ref" dir="ltr">{order.ref}</span>
          <h1>{ar ? `أهلاً ${order.name}` : `Hi ${order.name}`}</h1>
          <p className="ord-status">{ar ? st.ar : st.en}</p>
        </div>

        {!cancelled && (
          <ol className="ord-track" aria-label={ar ? 'حالة الأوردر' : 'Order status'}>
            {steps.map((k, i) => (
              <li key={k} className={i < st.step ? 'done' : ''}>
                <span>{ar ? STATUS[k].ar : STATUS[k].en}</span>
              </li>
            ))}
          </ol>
        )}

        <section className="ord-sec">
          <h2>{ar ? 'اللي طلبته' : 'What you ordered'}</h2>
          <ul className="ord-items">
            {items.map(i => (
              <li key={i.sku}>
                <span>{i.name}</span>
                <b dir="ltr">× {i.qty}</b>
                <bdi>{money(i.price * i.qty)}</bdi>
              </li>
            ))}
          </ul>
          <dl className="ord-totals">
            <div><dt>{ar ? 'المجموع' : 'Subtotal'}</dt><dd><bdi>{money(order.subtotal)}</bdi></dd></div>
            {Number(order.discount) > 0 && (
              <div><dt>{ar ? 'الخصم' : 'Discount'}</dt><dd><bdi>−{money(order.discount)}</bdi></dd></div>
            )}
            <div><dt>{ar ? 'التوصيل' : 'Delivery'}</dt><dd><bdi>{money(order.shipping)}</bdi></dd></div>
            <div className="tot"><dt>{ar ? 'الإجمالي' : 'Total'}</dt><dd><bdi>{money(order.total)}</bdi></dd></div>
          </dl>
          <p className="ord-cod">{ar ? 'الدفع عند الاستلام.' : 'Payment is cash on delivery.'}</p>
        </section>

        <section className="ord-sec">
          <h2>{ar ? 'التوصيل' : 'Delivery'}</h2>
          <p className="ord-addr">
            {order.address}{order.city ? ` — ${order.city}` : ''}
            <br />
            <bdi dir="ltr">{order.phone}</bdi>
          </p>
        </section>

        <RefundRequest
          lang={lang}
          refValue={order.ref}
          token={token}
          status={order.status}
          requestedAt={order.refund_requested_at ? String(order.refund_requested_at) : null}
          reason={order.refund_reason || ''}
        />

        <p className="ord-help">
          {ar ? 'محتاج حاجة تانية؟ ' : 'Need anything else? '}
          <a href={waLink(ar ? `عندي سؤال عن الأوردر ${order.ref}` : `A question about order ${order.ref}`)}
            target="_blank" rel="noopener">
            {ar ? 'كلّمنا على واتساب' : 'Message us on WhatsApp'}
          </a>
          {' · '}
          <Link href={L('/shop')}>{ar ? 'كمّل تسوق' : 'Keep shopping'}</Link>
        </p>
      </div>

      <Footer lang={lang} />
    </Dir>
  );
}
