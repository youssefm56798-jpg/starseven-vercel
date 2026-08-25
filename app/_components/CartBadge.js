'use client';

import { useEffect, useState } from 'react';
import { readCart, cartCount, CART_KEY } from '../../lib/cart.js';

/**
 * The little count on the nav cart icon.
 *
 * Renders nothing on the server and nothing until the first cart read, so the
 * server HTML and the first client render agree and React never has to patch a
 * hydration mismatch.
 */
export default function CartBadge() {
  const [n, setN] = useState(0);

  useEffect(() => {
    const sync = () => setN(cartCount(readCart()));
    sync();
    // 's7cart' fires for changes made in this tab, 'storage' for other tabs.
    window.addEventListener('s7cart', sync);
    const cross = e => { if (!e.key || e.key === CART_KEY) sync(); };
    window.addEventListener('storage', cross);
    return () => {
      window.removeEventListener('s7cart', sync);
      window.removeEventListener('storage', cross);
    };
  }, []);

  if (!n) return null;
  return <span className="cart-badge">{n > 99 ? '99+' : n}</span>;
}
