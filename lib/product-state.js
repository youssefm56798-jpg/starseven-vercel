/**
 * Whether a product can be bought.
 *
 * Pure, and in its own file, because three screens have to agree about it: the
 * product page, the shop grid card and the quick view. They each used to decide
 * for themselves, from the same two columns, and they had already drifted - the
 * grid and the quick view read only the price and would happily offer an
 * "Add to cart" for something the checkout then refused.
 *
 * Two columns, one answer. stock = 0 means there are none. price = 0 means the
 * client has not given a price for it yet, and that is not free and it is not
 * an invitation to ask - it is a product nobody can sell you, which is the same
 * fact as having none of it. There used to be a third state that sent the
 * customer to WhatsApp to ask the price; 23 of 63 live products were in it,
 * each one a message the owner had to answer by hand about a product nobody had
 * costed. The way out of the state is a price in the admin.
 */

/** Cannot be bought at all: there are none. */
export const OUT = 'out';
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
  return Number(product?.price) > 0 ? BUY : OUT;
}
