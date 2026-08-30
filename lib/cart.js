/**
 * The cart, client-side only.
 *
 * Stored as [{sku, qty}] in localStorage under one key shared by the landing
 * page, the shop, product pages and checkout — so a basket started anywhere
 * survives navigation. Deliberately holds no prices: the server recomputes
 * every figure at checkout from the database.
 */
export const CART_KEY = 's7_cart';
const MAX_QTY = 20;

export function readCart() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    return Array.isArray(raw)
      ? raw.filter(r => r && typeof r.sku === 'string').map(r => ({
          sku: r.sku,
          qty: Math.max(1, Math.min(MAX_QTY, Number(r.qty) || 1)),
        }))
      : [];
  } catch {
    return [];
  }
}

export function writeCart(cart) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    // Let other components on the page (the nav badge, the drawer) react.
    window.dispatchEvent(new CustomEvent('s7cart', { detail: cart }));
  } catch {
    /* private mode or a full quota — the basket just won't persist */
  }
}

export function addToCart(sku, qty = 1) {
  const cart = readCart();
  const row = cart.find(c => c.sku === sku);
  if (row) row.qty = Math.min(MAX_QTY, row.qty + qty);
  else cart.push({ sku, qty: Math.min(MAX_QTY, Math.max(1, qty)) });
  writeCart(cart);

  /*
   * The step before the conversion.
   *
   * Every add-to-cart on the site comes through here - the product page, the
   * quick view, the shop grid - so this is the one place that sees all of them,
   * and the funnel is only readable if none are missed.
   *
   * SKU and quantity only: the cart stores nothing else, and inventing a price
   * client-side would report a number that the server may not agree with. The
   * value of the basket is settled at checkout, where `purchase` carries it.
   *
   * Optional-chained because gtag exists only when NEXT_PUBLIC_GA_ID is set,
   * and adding to a basket must never depend on analytics being configured.
   */
  if (typeof window !== 'undefined') {
    window.gtag?.('event', 'add_to_cart', {
      currency: 'EGP',
      items: [{ item_id: sku, quantity: Math.max(1, qty) }],
    });
  }

  return cart;
}

export function setQty(sku, qty) {
  const cart = readCart().flatMap(c => {
    if (c.sku !== sku) return [c];
    const n = Math.min(MAX_QTY, Number(qty) || 0);
    return n <= 0 ? [] : [{ ...c, qty: n }];
  });
  writeCart(cart);
  return cart;
}

export function clearCart() {
  writeCart([]);
}

export const cartCount = cart => cart.reduce((n, c) => n + c.qty, 0);
