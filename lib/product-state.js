/**
 * Whether a product can be bought, asked about, or neither.
 *
 * Pure, and in its own file, because three screens have to agree about it: the
 * product page, the shop grid card and the quick view. They each used to decide
 * for themselves, from the same two columns, and they had already drifted — the
 * grid and the quick view read only the price and would happily offer an
 * "Add to cart" for something the checkout then refused.
 *
 * ---------------------------------------------------------------------------
 * Why out-of-stock beats unpriced
 *
 * The two columns mean different things and both can be zero at once:
 *
 *   price = 0   the client has not given a price for it yet. The product is
 *               listed so the range looks complete, and the call to action is
 *               a WhatsApp message asking what it costs.
 *   stock = 0   there are none.
 *
 * The old order asked about the price first, so a product that was BOTH
 * unpriced and unavailable invited a customer to WhatsApp the shop about
 * something the shop could not sell them either way. That is a message the shop
 * has to answer, about a product it cannot supply, and the customer comes away
 * having learned nothing.
 *
 * Stock first is the more useful sentence and the more honest one. "خلص من
 * المخزن" says the thing that actually decides whether they can have it, and it
 * implies it is coming back. Asking the price of something out of stock does
 * not.
 *
 * A product that is genuinely unpriced AND in stock still gets the WhatsApp
 * route, which is the case that behaviour was written for.
 */

/** Cannot be bought at all: there are none. */
export const OUT = 'out';
/** In stock, but nobody has said what it costs. Sends them to WhatsApp. */
export const ASK = 'ask';
/** Priced and on the shelf. */
export const BUY = 'buy';

/**
 * @param {{price?: unknown, stock?: unknown}} product a products row, or the
 *   public projection of one — productPublic() flattens stock to 1 or 0, and
 *   `> 0` reads both the same way.
 */
export function buyState(product) {
  // Missing rather than zero is still "cannot be sold". A caller that forgot to
  // select the column must not accidentally get a buy button.
  if (!(Number(product?.stock) > 0)) return OUT;
  return Number(product?.price) > 0 ? BUY : ASK;
}
