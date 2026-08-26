'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { readCart, writeCart, setQty as setCartQty, clearCart } from '../../lib/cart.js';
import { cartTotals } from '../../lib/pricing.js';

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
    email: 'الإيميل (اختياري — نبعتلك تأكيد الأوردر)', notes: 'ملاحظات (اختياري)',
    place: 'أكّد الأوردر — الدفع عند الاستلام', placing: 'بنسجل الأوردر…',
    e_name: 'اكتب اسمك.', e_phone: 'رقم موبايل مصري غير صحيح.', e_addr: 'اكتب العنوان بالتفصيل.',
    e_email: 'اكتب إيميل صحيح.', e_net: 'مفيش اتصال بالسيرفر. جرّب تاني.',
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
    email: 'Email (optional — we send a confirmation)', notes: 'Notes (optional)',
    place: 'Confirm order — cash on delivery', placing: 'Placing your order…',
    e_name: 'Please enter your name.', e_phone: 'Enter a valid Egyptian mobile number.',
    e_addr: 'Please enter a full address.', e_email: 'Enter a valid email address.',
    e_net: 'Could not reach the server. Try again.',
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

function Field({ id, label, val, set, err, type = 'text', ta, ...rest }) {
  return (
    <div className="ff">
      <label htmlFor={id}>{label}</label>
      {ta ? (
        <textarea id={id} rows="2" className={err ? 'bad' : ''} value={val}
          onChange={e => set(e.target.value)} {...rest} />
      ) : (
        <input id={id} type={type} className={err ? 'bad' : ''} value={val}
          onChange={e => set(e.target.value)} {...rest} />
      )}
      {err && <div className="err">{err}</div>}
    </div>
  );
}

export default function CheckoutClient({ lang, add, catalog, shipping, currency }) {
  const T = COPY[lang] || COPY.ar;
  const ar = lang === 'ar';
  const q = ar ? '' : '?lang=en';

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
      window.history.replaceState(null, '', `/checkout${q}`);
    }
    setCart(next);
    setReady(true);
  }, [add, q]);

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
    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) next.email = T.e_email;
    setErrs(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    setTop('');
    try {
      const res = await api('/api/order', {
        name: f.name.trim(), phone: f.phone.trim(), address: f.addr.trim(),
        city: f.city.trim(), email: f.email.trim(), notes: f.notes.trim(),
        coupon: applied ? applied.code : '', consent: consent ? 1 : 0,
        lang, hp, items: lines.map(l => ({ sku: l.sku, qty: l.qty })),
      });
      setDone(res);
      clearCart();
      setCart([]);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
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
        <Link className="btn btn-red btn-full" href={`/shop${q}`}>{T.done_more}</Link>
      </div>
    );
  }

  if (!lines.length) {
    return (
      <div className="co-empty">
        <div className="big">★</div>
        <h2 style={{ fontWeight: 900, fontSize: 22, margin: '8px 0 6px' }}>{T.empty}</h2>
        <p style={{ marginBottom: 22 }}>{T.empty_p}</p>
        <Link className="btn btn-red" href={`/shop${q}`}>{T.shop}</Link>
      </div>
    );
  }

  return (
    <div className="checkout">
      <div className="co-main">
        <h2>{ar ? 'بيانات التوصيل' : 'Delivery details'}</h2>
        <form onSubmit={submit} noValidate>
          {top && <div className="formmsg">{top}</div>}

          <div className="ff2">
            <Field id="name" label={T.name} val={f.name} set={upd('name')} err={errs.name}
              autoComplete="name" />
            <Field id="phone" label={T.phone} val={f.phone} set={upd('phone')} err={errs.phone}
              type="tel" dir="ltr" inputMode="tel" autoComplete="tel" placeholder="01xxxxxxxxx" />
          </div>

          <Field id="addr" label={T.addr} val={f.addr} set={upd('addr')} err={errs.addr} ta
            autoComplete="street-address" />

          <div className="ff2">
            <Field id="city" label={T.city} val={f.city} set={upd('city')}
              autoComplete="address-level2" />
            <Field id="email" label={T.email} val={f.email} set={upd('email')} err={errs.email}
              type="email" dir="auto" autoComplete="email" />
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
            {T.agree_a} <Link href={`/terms${q}`}>{T.agree_terms}</Link> {T.agree_and}{' '}
            <Link href={`/privacy${q}`}>{T.agree_priv}</Link>.
          </p>
        </form>
      </div>

      <div className="co-side">
        <h2>{T.items}</h2>

        {lines.map(l => (
          <div className="co-item" key={l.sku}>
            <img src={`/${l.img}`} alt={l[lang].name} width="52" height="52" />
            <div>
              <h4>{l[lang].name}</h4>
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
