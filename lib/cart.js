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

/**
 * The most distinct products a basket may hold.
 *
 * The number is repeated from `maxOrderLines` in lib/config.js rather than
 * imported, and the duplication is deliberate: this module runs in the browser,
 * and importing lib/config.js would pull SHIPPING_FEE, FREE_DELIVERY_OVER and
 * the rate-limit table into the client bundle to read one integer.
 * tests/pricing.test.mjs asserts the two spellings still agree, so it cannot
 * drift unnoticed — the same arrangement middleware.js uses for the CSRF cookie
 * name.
 *
 * This is a COURTESY and not the control. The control is in
 * app/api/order/route.js, which refuses an oversized basket whatever the
 * browser did, because /api/order is a plain POST endpoint that anything can
 * call. What this buys is that a customer meets the limit at the moment they
 * add the twenty-first product, rather than after filling in their name,
 * address and phone number.
 */
export const MAX_LINES = 20;

export function readCart() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    return Array.isArray(raw)
      ? raw.filter(r => r && typeof r.sku === 'string').map(r => ({
          sku: r.sku,
          qty: Math.max(1, Math.min(MAX_QTY, Number(r.qty) || 1)),
        }))
        /*
         * Trimmed on the way OUT as well as on the way in, because localStorage
         * outlives a deploy. A basket built before the line cap existed — or by
         * anybody who edited the key by hand — would otherwise be refused by
         * /api/order after the customer had filled in the whole form, with no
         * way to see which product was the problem.
         *
         * Truncating here is the gentler of the two failures and the only one
         * that is honest: the drawer and the checkout summary both render this
         * array, so what is dropped is dropped visibly, before anything is
         * confirmed. The server truncating instead would mean shipping an order
         * the customer did not agree to, which is why it refuses.
         */
        .slice(0, MAX_LINES)
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

  // A product already in the basket is never refused — "make it two" is not a
  // new line and must keep working at the limit. Only a NEW line can be over
  // it, and the caller is told so by getting the unchanged cart back, which is
  // what the add buttons already read to update their label.
  if (!row && cart.length >= MAX_LINES) return cart;

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
