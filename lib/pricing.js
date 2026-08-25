/**
 * Money maths. Pure functions — no database, no request state — so the
 * checkout arithmetic can be tested on its own.
 *
 * The browser is never trusted with totals: the order route recomputes every
 * figure with these before writing anything.
 */

/** What an offer is worth on a given subtotal. Never exceeds the subtotal. */
export function discountFor(subtotal, offer) {
  if (!offer) return 0;
  const min = Number(offer.min_total ?? 0);
  if (subtotal < min) return 0;

  const value = Number(offer.discount_value ?? 0);
  const round2 = n => Math.round(n * 100) / 100;

  switch (offer.discount_type) {
    case 'percent': return round2(Math.min(subtotal, subtotal * (value / 100)));
    case 'fixed':   return round2(Math.min(subtotal, value));
    default:        return 0;
  }
}

/**
 * Full basket maths.
 * Delivery is decided on the post-discount figure, so a code can tip an order
 * back under the free-delivery threshold — deliberate, and the same rule the
 * checkout shows the customer.
 */
export function cartTotals(subtotal, discount, shipFee, freeOver) {
  const round2 = n => Math.round(n * 100) / 100;

  subtotal = round2(Math.max(0, Number(subtotal) || 0));
  discount = round2(Math.max(0, Math.min(Number(discount) || 0, subtotal)));

  const afterDiscount = round2(subtotal - discount);
  const shipping = (freeOver > 0 && afterDiscount >= freeOver) ? 0 : round2(Number(shipFee) || 0);

  return { subtotal, discount, shipping, total: round2(afterDiscount + shipping) };
}
