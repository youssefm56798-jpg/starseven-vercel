'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CART_KEY, cartCount, readCart, setQty } from '../../lib/cart.js';
import { cartTotals } from '../../lib/pricing.js';
import { imageUrl } from '../../lib/product-image.js';
import { localePath } from '../../lib/urls.js';
import './cart-drawer.css';

/**
 * The cart button in the nav, and the drawer it opens.
 *
 * It used to be a plain link to /checkout, which asked the visitor to commit to
 * a form before they could see what they were committing to — and gave them
 * nowhere to fix a wrong quantity except by abandoning the page they were on.
 * The drawer is the review step that link skipped: it opens over the current
 * page, so changing your mind costs nothing and returning to shopping costs a
 * click.
 *
 * The catalogue arrives as a prop from the server. The cart in localStorage
 * holds only {sku, qty} — deliberately no prices, see lib/cart.js — so the
 * names, images and prices to show have to come from somewhere, and a component
 * in the nav is on every page and cannot fetch per render without putting a
 * request in front of every navigation. Prices here are for display only; the
 * order route recomputes every figure from the database before it writes.
 */

/** The custom event any part of the site can fire to open the drawer. */
export const OPEN_CART = 's7cart:open';

/** Fire from a client component to open the drawer — used by the landing page. */
export function openCart() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OPEN_CART));
}

const T = {
  ar: {
    cart: 'السلة', title: 'السلة', close: 'إغلاق',
    empty: 'السلة فاضية', emptyP: 'اختار حاجة من المنتجات وهتلاقيها هنا.',
    shop: 'اتفرج على المنتجات',
    sub: 'المجموع', ship: 'الشحن', free: 'مجاني', tot: 'الإجمالي',
    checkout: 'إتمام الطلب', egp: 'ج.م',
    away: n => `ضيف بـ ${n} كمان والشحن يبقى مجاني`,
    gotFree: 'الشحن مجاني ✓',
    cod: 'الدفع عند الاستلام',
    less: 'أقل', more: 'أكثر',
  },
  en: {
    cart: 'Cart', title: 'Your cart', close: 'Close',
    empty: 'Your cart is empty', emptyP: 'Pick something from the range and it will show up here.',
    shop: 'Browse the range',
    sub: 'Subtotal', ship: 'Delivery', free: 'Free', tot: 'Total',
    checkout: 'Checkout', egp: 'EGP',
    away: n => `Add ${n} more and delivery is free`,
    gotFree: 'Delivery is free',
    cod: 'Cash on delivery',
    less: 'Less', more: 'More',
  },
};

export default function CartDrawer({ catalogue = [], lang = 'ar', shipping = 30, freeOver = 300 }) {
  const d = T[lang] || T.ar;
  const L = p => localePath(p, lang);

  const [open, setOpen] = useState(false);
  const [cart, setCart] = useState([]);
  // Nothing is read from localStorage during the first render, so the server
  // HTML and the first client render agree and React never patches a mismatch.
  // Same reason CartBadge starts at zero.
  const [ready, setReady] = useState(false);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    const sync = () => setCart(readCart());
    sync();
    setReady(true);
    const cross = e => { if (!e.key || e.key === CART_KEY) sync(); };
    const onOpen = () => { sync(); setOpen(true); };
    window.addEventListener('s7cart', sync);
    window.addEventListener('storage', cross);
    window.addEventListener(OPEN_CART, onOpen);
    return () => {
      window.removeEventListener('s7cart', sync);
      window.removeEventListener('storage', cross);
      window.removeEventListener(OPEN_CART, onOpen);
    };
  }, []);

  const close = useCallback(() => setOpen(false), []);

  /* Escape closes, the page behind stops scrolling, focus moves into the panel
     and returns to the button that opened it. A drawer that traps neither focus
     nor scroll is a dialog only to people using a mouse. */
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = e => {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const f = panelRef.current.querySelectorAll(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    window.addEventListener('keydown', onKey, true);
    const t = setTimeout(() => panelRef.current?.querySelector('.cd-x')?.focus(), 0);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey, true);
      clearTimeout(t);
      triggerRef.current?.focus();
    };
  }, [open, close]);

  const onQty = (sku, qty) => setCart(setQty(sku, qty));

  // Cart rows joined to the catalogue. A sku the catalogue no longer carries —
  // a product retired since the basket was filled — drops out rather than
  // rendering a line with no name and no price.
  const lines = cart
    .map(c => {
      const p = catalogue.find(x => x.sku === c.sku);
      return p ? { ...p, qty: c.qty } : null;
    })
    .filter(Boolean);

  const subtotal = lines.reduce((n, l) => n + Number(l.price) * l.qty, 0);
  const t = cartTotals(subtotal, 0, shipping, freeOver);
  const money = v => `${Math.round(v * 100) / 100} ${d.egp}`;
  const n = ready ? cartCount(cart) : 0;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="cart-link cd-trigger"
        aria-label={d.cart}
        aria-haspopup="dialog"
        aria-expanded={open ? 'true' : 'false'}
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
          <path d="M3 4h2.2l2 11.2a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 2-1.55L20.7 8H6.2"
            strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="10" cy="20" r="1.4" /><circle cx="17.5" cy="20" r="1.4" />
        </svg>
        {n > 0 && <span className="cart-badge">{n > 99 ? '99+' : n}</span>}
      </button>

      {open && (
        <>
          <div className="cd-scrim" onClick={close} />
          <aside className="cd-panel" ref={panelRef} role="dialog" aria-modal="true" aria-label={d.title}>
            <div className="cd-head">
              <h3>{d.title}</h3>
              <button className="cd-x" onClick={close} aria-label={d.close} type="button">×</button>
            </div>

            {lines.length === 0 ? (
              <div className="cd-body">
                <div className="cd-empty">
                  <span aria-hidden="true">★</span>
                  <b>{d.empty}</b>
                  {d.emptyP}
                  <div style={{ marginTop: 20 }}>
                    <Link className="btn btn-red" href={L('/shop')} onClick={close}>{d.shop}</Link>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="cd-body">
                  {lines.map(l => (
                    <div className="cd-item" key={l.sku}>
                      <Link href={L(`/product/${l.slug}`)} onClick={close}>
                        <img src={imageUrl(l.img)} alt="" width="64" height="64" />
                      </Link>
                      <div>
                        <h4>
                          <Link href={L(`/product/${l.slug}`)} onClick={close}>
                            {(l[lang] || l.ar || {}).name}
                          </Link>
                        </h4>
                        <div className="cd-pr">{l.price} {d.egp}</div>
                      </div>
                      <div className="cd-qty">
                        <button type="button" onClick={() => onQty(l.sku, l.qty - 1)} aria-label={d.less}>−</button>
                        <span>{l.qty}</span>
                        <button type="button" onClick={() => onQty(l.sku, l.qty + 1)} aria-label={d.more}>+</button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="cd-foot">
                  {/* The one number a basket can act on. freeOver was already
                      known here and never said, so a customer 20 EGP short of
                      free delivery had no way to find that out. */}
                  {freeOver > 0 && (
                    t.shipping === 0
                      ? <div className="cd-nudge cd-nudge-got">{d.gotFree}</div>
                      : <div className="cd-nudge">
                          {d.away(money(Math.max(0, freeOver - subtotal)))}
                          <span className="cd-bar" aria-hidden="true">
                            <span style={{ width: `${Math.min(100, Math.round(subtotal / freeOver * 100))}%` }} />
                          </span>
                        </div>
                  )}
                  <div className="cd-row"><span>{d.sub}</span><span>{money(t.subtotal)}</span></div>
                  <div className="cd-row">
                    <span>{d.ship}</span>
                    <span className={t.shipping === 0 ? 'cd-free' : ''}>
                      {t.shipping === 0 ? d.free : money(t.shipping)}
                    </span>
                  </div>
                  <div className="cd-row cd-tot"><span>{d.tot}</span><span>{money(t.total)}</span></div>
                  <Link className="btn btn-red btn-full" href={L('/checkout')} onClick={close}>
                    {d.checkout}
                  </Link>
                  <div className="cd-cod">{d.cod}</div>
                </div>
              </>
            )}
          </aside>
        </>
      )}
    </>
  );
}
