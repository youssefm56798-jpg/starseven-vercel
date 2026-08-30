'use client';

import { useState } from 'react';
import { addToCart } from '../../lib/cart.js';

/**
 * Add-to-cart for the product grid and product pages.
 *
 * The cart lives in localStorage so a visitor can browse without an account and
 * the basket survives a page change. The server still recomputes every price at
 * checkout, so nothing here is trusted.
 */
export default function AddButton({ sku, label, className = 'buy', addedLabel, name }) {
  const [added, setAdded] = useState(false);

  function onClick() {
    addToCart(sku);
    setAdded(true);
    setTimeout(() => setAdded(false), 1400);
  }

  return (
    <button
      type="button"
      className={className + (added ? ' added' : '')}
      onClick={onClick}
      aria-live="polite"
      /* A grid of 32 products rendered 32 buttons all called "Add". Pulling up a
         list of controls gave a screen-reader user "Add" thirty-two times with
         nothing to tell them apart; the product name makes each one an answer. */
      aria-label={name ? `${label} — ${name}` : undefined}
    >
      {added ? (addedLabel || '✓') : label}
    </button>
  );
}
