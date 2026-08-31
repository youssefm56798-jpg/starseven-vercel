'use client';

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { localePath } from '../../lib/urls.js';
import { currencyLabel, whole } from '../../lib/money.js';
import { site } from '../../lib/config.js';
import AddButton from './AddButton.js';
import './quickview.css';
import { imageUrl, imageSrcSet } from '../../lib/product-image.js';

/**
 * Quick view for the shop grid.
 *
 * The grid is a server component that renders every card, so the modal cannot
 * live on the card - sixty-three cards would mean sixty-three dialogs sitting in
 * the DOM. Instead there is exactly one dialog, held here by the provider that
 * wraps the grid, and each card carries only a small client trigger. The button
 * hands the clicked product up through context; the provider drops it into the
 * single dialog and opens it. Closing empties the state and the dialog stops
 * rendering entirely.
 *
 * The product arrives as plain serialisable fields already resolved for the
 * page language, because the trigger is a client component and cannot re-read
 * the row from the server. The one thing kept out of the payload is the
 * unpriced WhatsApp copy, which is rebuilt from the name so it stays identical
 * to the sentence the card sends.
 */

const QuickViewCtx = createContext(null);

// A live-region-free focusable set. The dialog traps Tab within these so focus
// can never reach the page behind it while it is open.
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function QuickViewProvider({ lang, children }) {
  // null is the whole closed state - nothing renders, nothing is trapped.
  const [product, setProduct] = useState(null);
  // The element that opened the dialog, so focus can return to it on close.
  const triggerRef = useRef(null);

  const open = useCallback((p, trigger) => {
    triggerRef.current = trigger || null;
    setProduct(p);
  }, []);
  const close = useCallback(() => setProduct(null), []);

  return (
    <QuickViewCtx.Provider value={open}>
      {children}
      <QuickViewModal lang={lang} product={product} onClose={close} triggerRef={triggerRef} />
    </QuickViewCtx.Provider>
  );
}

/**
 * The per-card trigger. A button, deliberately a sibling of the card <Link> and
 * not a child of it: nested inside the anchor a click would navigate to the
 * product page instead of opening the dialog.
 */
export function QuickViewButton({ product, lang }) {
  const open = useContext(QuickViewCtx);
  const ref = useRef(null);
  const ar = lang === 'ar';
  const label = ar ? `نظرة سريعة على ${product.name}` : `Quick view: ${product.name}`;

  return (
    <button
      type="button"
      ref={ref}
      className="qv-trigger"
      aria-label={label}
      title={ar ? 'نظرة سريعة' : 'Quick view'}
      onClick={() => open && open(product, ref.current)}
    >
      {/* An eye, drawn rather than an emoji, so it inherits colour and never
          renders as a coloured glyph the brand did not choose. */}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="3.2" />
      </svg>
    </button>
  );
}

function QuickViewModal({ lang, product, onClose, triggerRef }) {
  const ar = lang === 'ar';
  const L = p => localePath(p, lang);
  const dialogRef = useRef(null);
  const titleId = useId();
  const open = Boolean(product);

  // Everything that has to happen for as long as the dialog is open: focus in,
  // Esc and Tab handling, a scroll lock on the page behind, and focus back to
  // the trigger on the way out. Keyed on `open` so it arms on open and its
  // cleanup runs on close.
  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    // Lock the page behind the dialog. The document element rather than body,
    // because that is what actually scrolls here.
    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    html.style.overflow = 'hidden';

    // Move focus into the dialog - the close button, which is marked, or the
    // first focusable thing, or the dialog itself as a last resort.
    const first = dialog.querySelector('[data-autofocus]') || dialog.querySelector(FOCUSABLE);
    (first || dialog).focus();

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      // Trap Tab. The list is read live because the actions differ between a
      // priced product and an unpriced one.
      const items = Array.from(dialog.querySelectorAll(FOCUSABLE)).filter(
        el => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === firstEl || active === dialog)) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      html.style.overflow = prevOverflow;
      // Return focus to the control that opened the dialog.
      const t = triggerRef.current;
      if (t && typeof t.focus === 'function') t.focus();
    };
  }, [open, onClose, triggerRef]);

  if (!open) return null;

  const priced = Number(product.price) > 0;
  const highlights = Array.isArray(product.highlights) ? product.highlights.slice(0, 4) : [];
  // Rebuilt here, not passed in, so the sentence stays identical to the card.
  const waHref = `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(
    ar ? `عايز أعرف سعر ${product.name}` : `What is the price of ${product.name}?`,
  )}`;

  function onOverlayMouseDown(e) {
    // Only a press that both starts and lands on the backdrop closes the
    // dialog, so a text selection that drags out of the panel does not.
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div className="qv-overlay" onMouseDown={onOverlayMouseDown}>
      <div
        className="qv-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
        style={{ '--c': product.color }}
      >
        <button type="button" className="qv-close" onClick={onClose} data-autofocus
          aria-label={ar ? 'إغلاق' : 'Close'}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>

        <div className="qv-media">
          <img src={imageUrl(product.image)} srcSet={imageSrcSet(product.image)} sizes="(max-width: 700px) 80vw, 360px"
            alt={product.name} width="360" height="360" />
        </div>

        <div className="qv-info">
          {product.chip && <span className="qv-chip">{product.chip}</span>}
          <h2 id={titleId} className="qv-name">{product.name}</h2>
          {product.sub && <div className="qv-sub">{product.sub}</div>}

          {priced ? (
            <div className="qv-price">
              <bdi className="qv-now">{whole(product.price)} <small>{currencyLabel(lang)}</small></bdi>
              {product.compareAt != null && <bdi className="qv-was">{whole(product.compareAt)}</bdi>}
            </div>
          ) : (
            <div className="qv-price qv-ask">{ar ? 'اسأل عن السعر' : 'Ask for price'}</div>
          )}

          {/* Key info: the same three facts the product page leads with. */}
          <div className="spec qv-specrow">
            <div>
              <b dir="ltr">{product.hold}/5</b>
              <span>{ar ? 'قوة التثبيت' : 'Hold strength'}</span>
            </div>
            {product.sizeMl ? (
              <div>
                <b dir="ltr">{product.sizeMl}ml</b>
                <span>{ar ? 'الحجم' : 'Size'}</span>
              </div>
            ) : null}
            <div>
              <b>{String(product.kind).toUpperCase()}</b>
              <span>{ar ? 'النوع' : 'Type'}</span>
            </div>
          </div>

          {highlights.length > 0 && (
            <ul className="qv-highlights">
              {highlights.map((h, i) => <li key={i}>{h}</li>)}
            </ul>
          )}

          <div className="qv-actions">
            {priced ? (
              <AddButton
                sku={product.sku}
                className="btn btn-red qv-add"
                label={ar ? 'ضيفه للسلة' : 'Add to cart'}
                addedLabel={ar ? 'اتضاف للسلة ✓' : 'Added ✓'}
              />
            ) : (
              <a className="btn btn-red qv-add" target="_blank" rel="noopener" href={waHref}>
                {ar ? 'واتساب' : 'WhatsApp'}
              </a>
            )}
            <Link className="btn btn-line qv-details" href={L(`/product/${product.slug}`)} onClick={onClose}>
              {ar ? 'كل التفاصيل ←' : 'Full details →'}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
