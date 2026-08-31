'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { localePath } from '../../lib/urls.js';
import Link from 'next/link';
import { readCart, writeCart, setQty as setCartQty, clearCart } from '../../lib/cart.js';
import { cartTotals } from '../../lib/pricing.js';
import { SERVED, SERVED_LABELS } from '../../lib/delivery-eta.js';

/**
 * Checkout.
 *
 * The totals shown here are a preview computed from the same pricing module the
 * server uses, so the two agree — but the order route recomputes everything from
 * the database before writing, so nothing a visitor edits in the browser can
 * change what they are charged.
 */

const COPY = {
  ar: {
    empty: 'السلة فاضية', empty_p: 'ضيف منتج وابدأ الأوردر.', shop: 'روح للمنتجات',
    items: 'طلبك', sub: 'المجموع', ship: 'التوصيل', free: 'مجاني', disc: 'الخصم', tot: 'الإجمالي',
    cop_ph: 'كود الخصم', cop_go: 'طبّق', cop_off: 'شيل',
    name: 'الاسم', phone: 'رقم الموبايل', addr: 'العنوان بالتفصيل', city: 'المحافظة / المدينة',
    email: 'الإيميل', email_hint: 'هنبعتلك عليه لينك تتابع بيه الأوردر.', notes: 'ملاحظات (اختياري)',
    place: 'أكّد الأوردر — الدفع عند الاستلام', placing: 'بنسجل الأوردر…',
    e_name: 'اكتب اسمك.', e_phone: 'رقم موبايل مصري غير صحيح.', e_addr: 'اكتب العنوان بالتفصيل.',
    e_email: 'اكتب إيميل صحيح.', e_net: 'مفيش اتصال بالسيرفر. جرّب تاني.',
    city_pick: 'اختار المحافظة', e_city: 'اختار محافظة من القايمة.',
    done_h: 'استلمنا طلبك', done_p: 'هنكلمك نأكد العنوان والتوصيل. الدفع عند الاستلام.',
    done_more: 'ارجع للتسوق', cod: 'الدفع عند الاستلام',
    consent: 'ابعتلي العروض والخصومات على رقمي',
    consent_note: 'من غير سبام. تقدر تلغي في أي وقت.',
    agree_a: 'بإتمام الطلب أنت موافق على', agree_terms: 'الشروط', agree_and: 'و',
    agree_priv: 'سياسة الخصوصية',
  },
  en: {
    empty: 'Your cart is empty', empty_p: 'Add a product to start your order.', shop: 'Go to shop',
    items: 'Your order', sub: 'Subtotal', ship: 'Delivery', free: 'Free', disc: 'Discount', tot: 'Total',
    cop_ph: 'Discount code', cop_go: 'Apply', cop_off: 'Remove',
    name: 'Full name', phone: 'Mobile number', addr: 'Full address', city: 'City / governorate',
    email: 'Email', email_hint: 'We send you a link to follow your order.', notes: 'Notes (optional)',
    place: 'Confirm order — cash on delivery', placing: 'Placing your order…',
    e_name: 'Please enter your name.', e_phone: 'Enter a valid Egyptian mobile number.',
    e_addr: 'Please enter a full address.', e_email: 'Enter a valid email address.',
    e_net: 'Could not reach the server. Try again.',
    city_pick: 'Choose your governorate', e_city: 'Choose a governorate from the list.',
    done_h: 'Order received', done_p: 'We will call you to confirm the address and delivery. Cash on receipt.',
    done_more: 'Back to shopping', cod: 'Cash on delivery',
    consent: 'Send me offers and discounts on my number',
    consent_note: 'No spam. Unsubscribe any time.',
    agree_a: 'By placing this order you agree to our', agree_terms: 'Terms', agree_and: 'and',
    agree_priv: 'Privacy Policy',
  },
};

const NET = '__net__';

async function api(path, body) {
  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(NET);
  }
  let data;
  try { data = await res.json(); } catch { throw new Error(NET); }
  if (!res.ok || !data.ok) throw new Error(data.error || NET);
  return data;
}

/* ------------------------------------------------------- idempotency key */

/**
 * One key per checkout attempt. POST /api/order claims it inside the same
 * transaction that writes the order, so two requests carrying the same key can
 * only ever produce one order — the second is answered with the first one's
 * confirmation. See db/schema.sql.
 *
 * It lives in localStorage rather than in a ref alone, because the retry that
 * matters most is the one the component does not survive: the request left the
 * phone, the connection dropped before the reply came back, and the customer
 * reloaded and pressed Confirm again. A key held only in memory is gone by
 * then, the second submit looks brand new to the server, and that is the
 * double order.
 *
 * The attempt ends the moment the server answers at all — success or refusal —
 * because an answer means the server has decided and there is nothing left to
 * replay. Only a request that got no answer keeps its key.
 */
const KEY_STORE = 's7_checkout_key';

/**
 * How long a key that never got an answer stays usable.
 *
 * There has to be a limit, and it is a real trade-off in both directions. Too
 * short and a customer who reloads after a dropped connection gets a fresh key
 * and a second order — the exact bug. Too long and a stale key from an attempt
 * whose answer was lost could be picked up by a genuinely NEW order much later,
 * which would be shown the old confirmation and never placed at all. Half an
 * hour is comfortably longer than any retry and far shorter than the gap
 * between two real orders from one person.
 */
const KEY_TTL_MS = 30 * 60 * 1000;

function mintKey() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // No Web Crypto at all, which in practice means a browser old enough that
    // nothing else here works either. Weaker than random, still long enough to
    // be a usable deduplication token, and never trusted as a secret.
    return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  }
}

/** A key from an attempt that never got an answer, if it is still fresh. */
function storedKey() {
  try {
    const held = JSON.parse(localStorage.getItem(KEY_STORE) || 'null');
    if (held && typeof held.k === 'string' && Date.now() - Number(held.t) < KEY_TTL_MS) {
      return held.k;
    }
  } catch { /* private mode, or something else wrote over the slot */ }
  return '';
}

function rememberKey(k) {
  try { localStorage.setItem(KEY_STORE, JSON.stringify({ k, t: Date.now() })); }
  catch { /* private mode: the key still covers this page, just not a reload */ }
}

function forgetKey() {
  try { localStorage.removeItem(KEY_STORE); } catch { /* nothing to forget */ }
}

/*
 * A field, its label, and its error - wired together so the error is not purely
 * a colour.
 *
 * It used to render the message in an anonymous div and mark the input with a
 * class. Someone who cannot see the red border got no announcement, no name for
 * what was wrong, and a Place order button that appeared to do nothing.
 * aria-invalid states it, aria-describedby reads the message out with the field.
 */
function Field({ id, label, val, set, err, hint, type = 'text', ta, sel, ...rest }) {
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  const props = {
    id,
    className: err ? 'bad' : '',
    value: val,
    onChange: e => set(e.target.value),
    'aria-invalid': err ? 'true' : undefined,
    'aria-describedby': err ? errId : (hint ? hintId : undefined),
    ...rest,
  };
  return (
    <div className="ff">
      <label htmlFor={id}>{label}</label>
      {sel
        ? <select {...props}>{sel}</select>
        : ta
          ? <textarea rows="2" {...props} />
          : <input type={type} {...props} />}
      {err
        ? <div className="err" id={errId}>{err}</div>
        : hint && <div className="hint" id={hintId}>{hint}</div>}
    </div>
  );
}

export default function CheckoutClient({ lang, add, catalog, shipping, currency }) {
  const T = COPY[lang] || COPY.ar;
  const ar = lang === 'ar';
  const L = p => localePath(p, lang);
  const router = useRouter();

  const [cart, setCart] = useState([]);
  const [ready, setReady] = useState(false);
  const [applied, setApplied] = useState(null);
  const [coupon, setCoupon] = useState('');
  const [copErr, setCopErr] = useState('');
  const [copBusy, setCopBusy] = useState(false);
  const [f, setF] = useState({ name: '', phone: '', addr: '', city: '', email: '', notes: '' });
  const [hp, setHp] = useState('');
  const [consent, setConsent] = useState(false);
  const [errs, setErrs] = useState({});
  const [top, setTop] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  // Not state: nothing renders from it, and a re-render must not change it.
  const attempt = useRef('');

  /** The key for the attempt in progress, recovered or minted on first use. */
  const attemptKey = () => {
    if (!attempt.current) {
      attempt.current = storedKey() || mintKey();
      rememberKey(attempt.current);
    }
    return attempt.current;
  };

  const endAttempt = () => {
    attempt.current = '';
    forgetKey();
  };

  // Plain interpolation put the ISO code and the number in one bidi run, so an
  // Arabic page rendered "EGP 295" instead of "295 جنيه". The caller now sends the
  // localised label, and money() returns the two parts already ordered.
  const money = v => `${Math.round(v * 100) / 100} ${currency}`;

  // localStorage is only available in the browser, so seed after mount.
  useEffect(() => {
    let next = readCart();
    if (add) {
      const row = next.find(c => c.sku === add);
      if (row) row.qty = Math.min(20, row.qty + 1);
      else next = [...next, { sku: add, qty: 1 }];
      writeCart(next);
      // Drop ?add= so a refresh doesn't add the product again.
      window.history.replaceState(null, '', L(`/checkout`));
    }
    setCart(next);
    setReady(true);
    // `lang`, not `L`. L is rebuilt every render, so listing it here would
    // re-run this effect on every render — and it writes the cart and calls
    // replaceState. `lang` is the reactive value L is derived from.
  }, [add, lang]);

  const lines = cart
    .map(c => {
      const p = catalog.find(x => x.sku === c.sku);
      return p ? { ...p, qty: c.qty } : null;
    })
    .filter(Boolean);

  const subtotalNow = lines.reduce((n, l) => n + l.price * l.qty, 0);
  const t = cartTotals(subtotalNow, applied ? applied.amount : 0, shipping.fee, shipping.freeOver);

  const upd = k => v => setF(s => ({ ...s, [k]: v }));

  function changeQty(sku, qty) {
    setCart(setCartQty(sku, qty));
  }

  async function applyCoupon(silent = false) {
    const code = (silent && applied ? applied.code : coupon).trim().toUpperCase();
    if (!code || copBusy) return;
    setCopBusy(true);
    if (!silent) setCopErr('');
    try {
      const res = await api('/api/coupon', { code, subtotal: subtotalNow, lang });
      setApplied({ code: res.code, amount: res.discount });
    } catch (e) {
      setApplied(null);
      if (!silent) setCopErr(e.message === NET ? T.e_net : e.message);
    } finally {
      setCopBusy(false);
    }
  }

  // A code applied to one basket is wrong for a different basket, so re-check.
  useEffect(() => {
    if (applied) applyCoupon(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtotalNow]);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;

    const next = {};
    if (f.name.trim().length < 3) next.name = T.e_name;
    if (!/^(?:\+?20|0020)?0?1[0125]\d{8}$/.test(f.phone.replace(/\D/g, ''))) next.phone = T.e_phone;
    if (f.addr.trim().length < 8) next.addr = T.e_addr;
    // The picker starts empty, so this catches somebody submitting without
    // touching it. The server refuses an unserved governorate regardless -
    // this only saves the round trip.
    if (!f.city.trim()) next.city = T.e_city;
    // Required. There are no accounts, so this address is the only way the
    // customer can reach their order again — to check it or to cancel it.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) next.email = T.e_email;
    setErrs(next);
    if (Object.keys(next).length) {
      /* Put the caret on the first thing that is wrong. Without this the page
         does not move, nothing is announced, and the only feedback a keyboard
         user gets is that the button did nothing. */
      const first = Object.keys(next)[0];
      requestAnimationFrame(() => {
        const el = document.getElementById(first);
        if (el) { el.focus(); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      });
      return;
    }

    setBusy(true);
    setTop('');
    try {
      const res = await api('/api/order', {
        name: f.name.trim(), phone: f.phone.trim(), address: f.addr.trim(),
        city: f.city.trim(), email: f.email.trim(), notes: f.notes.trim(),
        coupon: applied ? applied.code : '', consent: consent ? 1 : 0,
        lang, hp, idempotency_key: attemptKey(),
        items: lines.map(l => ({ sku: l.sku, qty: l.qty })),
      });
      endAttempt();

      /*
       * The conversion, fired where the conversion happens.
       *
       * This is the only moment in the app that knows an order was actually
       * written: the server has answered with a reference and the cart is about
       * to be cleared. Reporting it from the thank-you screen instead would
       * count a refresh twice, and reporting it from the submit handler before
       * the response would count every failure as a sale.
       *
       * Optional-chained rather than guarded: gtag only exists when
       * NEXT_PUBLIC_GA_ID is set, and a shop with no analytics configured must
       * still be able to take an order. `lines` is read rather than `res`
       * because the reply carries totals, not the basket.
       */
      window.gtag?.('event', 'purchase', {
        transaction_id: res.ref,
        value: Number(res.total) || 0,
        shipping: Number(res.shipping) || 0,
        currency: 'EGP',
        items: lines.map(l => ({
          item_id: l.sku,
          item_name: l.name,
          price: Number(l.price) || 0,
          quantity: l.qty,
        })),
      });

      clearCart();
      setCart([]);
      setDone(res);

      /*
       * router.replace, not push.
       *
       * The order is written and the cart is gone, so the form behind this is
       * not a page anybody can use again - and push would leave the browser's
       * back button pointing straight at it, showing a submitted form over an
       * empty basket. replace takes /checkout out of the history entirely, so
       * back goes to whatever the customer was looking at before they checked
       * out, which is the shop.
       *
       * setDone still runs, so the panel renders for the instant before the
       * navigation lands and there is no blank frame in between.
       */
      router.replace(L(`/order/thanks?ref=${encodeURIComponent(res.ref)}`));
    } catch (e) {
      // A refusal is still an answer: the server saw this attempt and decided,
      // so it is over and the next submit is a new one with a new key. Only a
      // request that got NO answer keeps its key, because that is the case
      // where the order may well have been written and only the reply lost —
      // and sending the same key again is what stops it being written twice.
      if (e.message !== NET) endAttempt();
      setTop(e.message === NET ? T.e_net : e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return <div className="empty-note" style={{ padding: '80px 20px' }}>
      {ar ? 'بنحمّل السلة…' : 'Loading your cart…'}
    </div>;
  }

  if (done) {
    return (
      <div className="co-done">
        <div className="star">★</div>
        <div className="ref" dir="ltr">{done.ref}</div>
        <h1>{T.done_h}</h1>
        <p>{done.message || T.done_p}</p>
        <Link className="btn btn-red btn-full" href={L(`/shop`)}>{T.done_more}</Link>
      </div>
    );
  }

  if (!lines.length) {
    return (
      <div className="co-empty">
        <div className="big">★</div>
        <h2 style={{ fontWeight: 900, fontSize: 22, margin: '8px 0 6px' }}>{T.empty}</h2>
        <p style={{ marginBottom: 22 }}>{T.empty_p}</p>
        <Link className="btn btn-red" href={L(`/shop`)}>{T.shop}</Link>
      </div>
    );
  }

  return (
    <div className="checkout">
      <div className="co-main">
        <h2>{ar ? 'بيانات التوصيل' : 'Delivery details'}</h2>
        <form onSubmit={submit} noValidate>
          {/* role=alert so a failure that lands at the top of the form is spoken,
              rather than only appearing above a button already scrolled past. */}
          {top && <div className="formmsg" role="alert">{top}</div>}

          <div className="ff2">
            <Field id="name" label={T.name} val={f.name} set={upd('name')} err={errs.name}
              autoComplete="name" />
            <Field id="phone" label={T.phone} val={f.phone} set={upd('phone')} err={errs.phone}
              type="tel" dir="ltr" inputMode="tel" autoComplete="tel" placeholder="01xxxxxxxxx" />
          </div>

          <Field id="addr" label={T.addr} val={f.addr} set={upd('addr')} err={errs.addr} ta
            autoComplete="street-address" />

          <div className="ff2">
            {/* A picker, not a text box. The shop delivers to three
                governorates; letting somebody type a fourth and be refused by
                the server after they have filled the whole form is a worse
                way to tell them. The server still checks - see
                app/api/order/route.js - because this select is markup and
                markup is not a control. */}
            <Field id="city" label={T.city} val={f.city} set={upd('city')} err={errs.city}
              autoComplete="address-level2" required sel={[
                <option key="" value="">{T.city_pick}</option>,
                ...SERVED.map(g => (
                  <option key={g} value={SERVED_LABELS[g][ar ? 'ar' : 'en']}>
                    {SERVED_LABELS[g][ar ? 'ar' : 'en']}
                  </option>
                )),
              ]} />
            <Field id="email" label={T.email} val={f.email} set={upd('email')} err={errs.email}
              hint={T.email_hint}
              type="email" dir="auto" autoComplete="email" required />
          </div>

          <Field id="notes" label={T.notes} val={f.notes} set={upd('notes')} ta />

          <label className="consent">
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
            <span>
              <b>{T.consent}</b>
              <br />
              <span className="cn">{T.consent_note}</span>
            </span>
          </label>

          {/* Spam trap. .hp-field in globals.css takes it off screen with
              clip-path. Never remove that rule: anything typed in here makes the
              order route discard the order. */}
          <input type="text" tabIndex={-1} autoComplete="off" aria-hidden="true"
            name="company_website" value={hp} onChange={e => setHp(e.target.value)}
            className="hp-field" />

          <button className="btn btn-red btn-full" type="submit" disabled={busy}
            style={{ marginTop: 6 }}>
            {busy ? T.placing : T.place}
          </button>

          <p className="agree">
            {T.agree_a} <Link href={L(`/terms`)}>{T.agree_terms}</Link> {T.agree_and}{' '}
            <Link href={L(`/privacy`)}>{T.agree_priv}</Link>.
          </p>
        </form>
      </div>

      <div className="co-side">
        <h2>{T.items}</h2>

        {lines.map(l => (
          <div className="co-item" key={l.sku}>
            <img src={`/${l.img}`} alt={l[lang].name} width="52" height="52" />
            <div>
              <h3>{l[lang].name}</h3>
              <div className="q"><bdi>{money(l.price)}</bdi></div>
            </div>
            <div className="qc">
              <button onClick={() => changeQty(l.sku, l.qty - 1)} aria-label="-">−</button>
              <span>{l.qty}</span>
              <button onClick={() => changeQty(l.sku, l.qty + 1)} aria-label="+">+</button>
            </div>
          </div>
        ))}

        <div className="coupon" style={{ marginTop: 16 }}>
          <input value={applied ? applied.code : coupon} disabled={!!applied}
            onChange={e => { setCoupon(e.target.value); setCopErr(''); }}
            placeholder={T.cop_ph} dir="ltr" aria-label={T.cop_ph} />
          <button type="button" disabled={copBusy}
            onClick={() => (applied ? (setApplied(null), setCoupon('')) : applyCoupon(false))}>
            {copBusy ? '…' : applied ? T.cop_off : T.cop_go}
          </button>
        </div>
        {copErr && <div className="formmsg" style={{ marginBottom: 12 }}>{copErr}</div>}

        <div className="co-row"><span>{T.sub}</span><span><bdi>{money(t.subtotal)}</bdi></span></div>
        {t.discount > 0 && (
          <div className="co-row">
            <span>{T.disc} {applied.code}</span>
            <span className="free"><bdi>−{money(t.discount)}</bdi></span>
          </div>
        )}
        <div className="co-row">
          <span>{T.ship}</span>
          <span className={t.shipping === 0 ? 'free' : ''}>
            {t.shipping === 0 ? T.free : <bdi>{money(t.shipping)}</bdi>}
          </span>
        </div>
        <div className="co-row tot"><span>{T.tot}</span><span><bdi>{money(t.total)}</bdi></span></div>

        <div style={{ color: '#8B867B', fontSize: 12, fontWeight: 700, marginTop: 12, textAlign: 'center' }}>
          {T.cod}
        </div>
      </div>
    </div>
  );
}
