import Link from 'next/link';
import { localePath } from '../../lib/urls.js';
import { currencyLabel, whole } from '../../lib/money.js';
import { orderFor, itemsFor, timelineFor } from '../../lib/order-access.js';
import { formatStamp, formatWindow } from '../../lib/delivery-eta.js';
import { formatRef } from '../../lib/order-number.js';
import { Dir, Nav, Footer, waLink } from '../_components/Chrome.js';
// The bracketed folder is a real directory name, not a placeholder. The client
// component is colocated with the route it belongs to, and only files named
// page.js, layout.js or route.js are treated as routes, so importing across the
// segment from here is ordinary module resolution.
import CancelOrder from '../order/[ref]/CancelOrder.js';
import { canSelfCancel } from '../../lib/order-status.js';

/**
 * A customer looking at their own order, rendered once and mounted at
 * /order/[ref] and /en/order/[ref].
 *
 * There is no account behind this. The link in the confirmation email carries
 * a token, the token is the credential, and it opens exactly one order. See
 * lib/order-access.js for why it is built that way.
 *
 * Always dynamic and never cached, and here that is a security requirement
 * rather than a freshness preference: the page is keyed by a token in the query
 * string, so a cached copy is one customer's name, address and phone number
 * served to whoever asks next. Both route files declare `force-dynamic` and
 * both read `searchParams` for the token, and tests/render-mode exempts them
 * from its no-searchParams rule on exactly those grounds. What the locale
 * migration changes here is only that the language of the failure screen is a
 * constant per route file instead of a `?lang=` value.
 *
 * The file is split into three exports rather than one component, so that the
 * route files can hold the one decision worth reading in a route file — is
 * there an order to show — while the markup for both answers stays here, in a
 * single copy that the two languages cannot drift apart from.
 */

/**
 * Everything this page reads out of the request, in one place.
 *
 * Both route files hand their two promises straight to this function, so there
 * is no second opinion about what the token is or how it is validated.
 */
export async function readOrder({ params, searchParams }) {
  const { ref } = await params;
  const sp = await searchParams;
  const token = typeof sp?.t === 'string' ? sp.t : '';
  return { ref, token, order: await orderFor(ref, token) };
}

/**
 * The one thing every failed lookup says.
 *
 * A wrong token, a wrong reference, and a reference that does not exist all
 * land here with the same words. Distinguishing them would turn this page into
 * a way to test whether an order reference is real, which is the enumeration
 * hole the single failure branch exists to close — so this screen has one
 * implementation and both trees render it.
 *
 * There is no order to take a language from when the lookup failed, so it
 * answers in the language of the tree the visitor is standing in. That is what
 * reading `?lang=` amounted to before, now that /en is a path segment.
 *
 * The first button used to be WhatsApp, because there was nothing else to
 * offer: the token was not stored, so nobody could re-send a link and the only
 * way back was a human. /order/find can hand out a fresh one now, so it leads,
 * and it says nothing this screen does not — the endpoint behind it answers the
 * same sentence whether or not the details matched anything.
 */
export function OrderLinkBroken({ lang }) {
  const ar = lang !== 'en';
  return (
    <Dir lang={ar ? 'ar' : 'en'}>
      <Nav lang={ar ? 'ar' : 'en'} path="order" />
      <div className="wrap nf">
        <h1>{ar ? 'اللينك ده مش شغال' : 'That link does not work'}</h1>
        <p>
          {ar
            ? 'يمكن اللينك ناقص، أو اتنسخ غلط، أو قديم. اطلب لينك جديد بالإيميل ورقم الأوردر — أو كلّمنا على واتساب.'
            : 'The link may be incomplete, copied wrong, or expired. Ask for a fresh one with your email and order number — or message us on WhatsApp.'}
        </p>
        <div className="nf-links">
          <Link className="btn btn-red" href={localePath('/order/find', ar ? 'ar' : 'en')}>
            {ar ? 'ابعتلي لينك جديد' : 'Email me a new link'}
          </Link>
          <a className="btn btn-wa" href={waLink()} target="_blank" rel="noopener">
            {ar ? 'كلّمنا على واتساب' : 'Message us on WhatsApp'}
          </a>
          <Link className="btn btn-line" href={localePath('/', ar ? 'ar' : 'en')}>
            {ar ? 'الرئيسية' : 'Home'}
          </Link>
        </div>
      </div>
      <Footer lang={ar ? 'ar' : 'en'} />
    </Dir>
  );
}

const STATUS = {
  new: { ar: 'استلمنا الأوردر', en: 'Order received', step: 1 },
  confirmed: { ar: 'اتأكد بالتليفون', en: 'Confirmed by phone', step: 2 },
  shipped: { ar: 'في الطريق ليك', en: 'On its way', step: 3 },
  delivered: { ar: 'اتسلّم', en: 'Delivered', step: 4 },
  cancelled: { ar: 'اتلغى', en: 'Cancelled', step: 0 },
};

/**
 * When it is coming.
 *
 * The tracker above this says which of four boxes the order is in and nothing
 * about time, which is not the question anyone opens this page to ask. The
 * window itself is written on the order when the shop confirms it by phone —
 * see lib/order-status.js and lib/delivery-eta.js — so this component only
 * renders what is already there and never invents a date of its own.
 *
 * Four cases, and each one says something different rather than falling back
 * to a shrug:
 *
 *   cancelled   the window is irrelevant; what matters is when it was stopped,
 *               which is what orders.cancelled_at is for and what nothing on
 *               this site rendered until now. The date is dropped rather than
 *               guessed at for a row cancelled before that column existed.
 *   delivered   also no window: it has arrived, the tracker says so, and a
 *               line predicting its arrival would read as a mistake.
 *   a window    the whole point.
 *   no window   an order the shop has not confirmed yet. Saying so is better
 *               than saying nothing, because the silence otherwise reads as a
 *               page that is broken.
 *
 * The range goes inside a <bdi>. It mixes Arabic weekday names with digits and
 * an en dash, and in an RTL paragraph the bidi algorithm will happily reorder
 * the two ends of a range that is not isolated — so the customer is shown the
 * window backwards. The tracking reference is isolated for the same reason and
 * pinned to LTR on top of it, because it is a Latin-and-digits code the
 * courier printed and it has to be readable back to them character for
 * character.
 */
function ExpectedDelivery({ order, ar }) {
  const lang = ar ? 'ar' : 'en';

  if (order.status === 'cancelled') {
    const when = formatStamp(order.cancelled_at, lang);
    return (
      <p className="ord-eta ord-eta-off">
        {when
          ? (ar ? <>الأوردر ده اتلغى يوم <bdi>{when}</bdi>.</> : <>This order was cancelled on <bdi>{when}</bdi>.</>)
          : (ar ? 'الأوردر ده اتلغى.' : 'This order was cancelled.')}
      </p>
    );
  }

  if (order.status === 'delivered') return null;

  const arriving = formatWindow(order.expected_from, order.expected_to, lang);

  if (!arriving) {
    return (
      <p className="ord-eta ord-eta-off">
        {ar
          ? 'هنكلمك نأكد الأوردر الأول، وأول ما يتأكد هتلاقي معاد التوصيل هنا.'
          : 'We will call to confirm your order first. Your delivery window shows up here as soon as we do.'}
      </p>
    );
  }

  return (
    <div className="ord-eta">
      <p className="ord-eta-when">
        {ar ? 'بيوصلك ' : 'Arrives '}
        <bdi>{arriving}</bdi>
      </p>
      <p className="ord-eta-note">
        {ar
          ? 'دي أيام شغل من السبت للخميس، والمندوب بيكلمك قبل ما يجي.'
          : 'Working days, Saturday to Thursday. The courier calls you before they arrive.'}
      </p>
      {(order.courier || order.tracking_ref) && (
        <p className="ord-eta-courier">
          {order.courier ? (ar ? `مع ${order.courier}` : `With ${order.courier}`) : null}
          {order.courier && order.tracking_ref ? ' · ' : null}
          {order.tracking_ref
            ? (<>{ar ? 'رقم الشحنة ' : 'Tracking '}<bdi dir="ltr">{order.tracking_ref}</bdi></>)
            : null}
        </p>
      )}
    </div>
  );
}

/**
 * The history of the order, as much of it as belongs to the customer.
 *
 * The rows come from lib/order-access.js, which is where the decision about
 * what a token entitles someone to read lives, and which never selects the
 * columns this must not print — the actor, the internal notes, the mail log.
 * That filtering deliberately does not happen here: a component is the wrong
 * place to hold a security rule, because the next person to edit the markup
 * has no way of knowing one was being enforced by omission.
 *
 * So this renders whatever it is handed. A status row is shown with the same
 * words the tracker uses, so the two cannot describe the same order
 * differently, and the only free text that reaches the page is the reason the
 * customer typed into their own cancellation request.
 */
function History({ events, ar }) {
  if (!events.length) return null;
  const lang = ar ? 'ar' : 'en';

  return (
    <section className="ord-sec">
      <h2>{ar ? 'اللي حصل لحد دلوقتي' : 'What has happened so far'}</h2>
      <ol className="ord-tl">
        {events.map(e => (
          <li key={e.id}>
            <span className="ord-tl-when">{formatStamp(e.created_at, lang)}</span>
            <span className="ord-tl-what">
              <b>
                {e.kind === 'status'
                  ? (STATUS[e.to_status] ? (ar ? STATUS[e.to_status].ar : STATUS[e.to_status].en) : e.to_status)
                  : (ar ? 'طلبت الإلغاء' : 'You asked to cancel')}
              </b>
              {e.note ? <span className="ord-tl-note"> — {e.note}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * The order itself.
 *
 * This one takes no language from the route, and that is deliberate: the order
 * remembers the language it was placed in, so the page comes back in the
 * language the customer actually used. An Arabic order opened from an /en link
 * is still the customer's own order, and the words on it should be the ones
 * they read when they placed it. Which is also why both route files can render
 * this component identically.
 */
export default async function OrderDetail({ order, token }) {
  const lang = order.lang === 'en' ? 'en' : 'ar';
  const ar = lang === 'ar';
  const L = p => localePath(p, lang);

  const [items, events] = await Promise.all([itemsFor(order.id), timelineFor(order.id)]);
  const st = STATUS[order.status] || STATUS.new;
  const cancelled = order.status === 'cancelled';
  const money = v => `${whole(v)} ${currencyLabel(lang)}`;

  const steps = ['new', 'confirmed', 'shipped', 'delivered'];

  return (
    <Dir lang={lang}>
      <Nav lang={lang} path="order" />

      <div className="wrap ordpage">
        <div className="ord-head">
          <span className="ord-ref" dir="ltr">{formatRef(order.ref)}</span>
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

        <ExpectedDelivery order={order} ar={ar} />

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

        <History events={events} ar={ar} />

        {/* Whether this order is still the customer's to cancel is decided
            here, on the server, from the same module the API checks against —
            rather than in the client component, which would have to import
            lib/order-status.js and drag the database driver into the browser
            bundle to ask. */}
        <CancelOrder
          lang={lang}
          refValue={order.ref}
          token={token}
          status={order.status}
          selfCancellable={canSelfCancel(order.status)}
          requestedAt={order.refund_requested_at ? String(order.refund_requested_at) : null}
          reason={order.refund_reason || ''}
        />

        <p className="ord-help">
          {ar ? 'محتاج حاجة تانية؟ ' : 'Need anything else? '}
          <a href={waLink(ar ? `عندي سؤال عن الأوردر ${formatRef(order.ref)}` : `A question about order ${formatRef(order.ref)}`)}
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
