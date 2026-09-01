/**
 * Discount rules and checkout arithmetic — ported 1:1 from tests/run.php.
 *
 * The browser is never trusted with totals; the order route recomputes them
 * with exactly these functions, so a mistake here is money.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discountFor, cartTotals } from '../lib/pricing.js';

/* --------------------------------------------------------------- offers */

const pct10 = { discount_type: 'percent', discount_value: 10, min_total: 0 };
const pct10min = { discount_type: 'percent', discount_value: 10, min_total: 80 };
const fix25 = { discount_type: 'fixed', discount_value: 25, min_total: 0 };
const none = { discount_type: 'none', discount_value: 99, min_total: 0 };

const discountCases = [
  ['10% of 90', 90, pct10, 9],
  ['10% of 45', 45, pct10, 4.5],
  ['minimum met', 90, pct10min, 9],
  ['minimum not met', 45, pct10min, 0],
  ['fixed 25 off 90', 90, fix25, 25],
  ['fixed capped at basket', 20, fix25, 20],
  ['announcement only (type none)', 90, none, 0],
  ['empty basket', 0, pct10, 0],
];

for (const [name, subtotal, offer, want] of discountCases) {
  test(`discount: ${name}`, () => {
    assert.equal(discountFor(subtotal, offer), want);
  });
}

// Not in the PHP suite: JS can be handed a missing offer where PHP had null.
test('discount: no offer at all is worth nothing', () => {
  assert.equal(discountFor(90, null), 0);
  assert.equal(discountFor(90, undefined), 0);
});

/* ----------------------------------------------------------- cart totals */

const FEE = 30;
const FREE_OVER = 300;

const cartCases = [
  ['one wax', [45, 0, FEE, FREE_OVER], { subtotal: 45, discount: 0, shipping: 30, total: 75 }],
  ['two wax', [90, 0, FEE, FREE_OVER], { subtotal: 90, discount: 0, shipping: 30, total: 120 }],
  ['with a 10% code', [90, 9, FEE, FREE_OVER], { subtotal: 90, discount: 9, shipping: 30, total: 111 }],
  ['free shipping over the threshold', [315, 0, FEE, FREE_OVER], { subtotal: 315, discount: 0, shipping: 0, total: 315 }],
  ['exactly at the threshold', [300, 0, FEE, FREE_OVER], { subtotal: 300, discount: 0, shipping: 0, total: 300 }],
  // Deliberate: delivery is decided on the post-discount figure, so a code can
  // tip an order back under the free-delivery line. Checkout shows the same.
  ['a discount drops the order back under the threshold',
    [310, 31, FEE, FREE_OVER], { subtotal: 310, discount: 31, shipping: 30, total: 309 }],
  ['discount never exceeds the basket',
    [40, 100, FEE, FREE_OVER], { subtotal: 40, discount: 40, shipping: 30, total: 30 }],
  ['negative subtotal clamped to zero',
    [-5, 0, FEE, FREE_OVER], { subtotal: 0, discount: 0, shipping: 30, total: 30 }],
  ['free delivery disabled (threshold 0)',
    [999, 0, FEE, 0], { subtotal: 999, discount: 0, shipping: 30, total: 1029 }],
];

for (const [name, args, want] of cartCases) {
  test(`cart: ${name}`, () => {
    assert.deepEqual(cartTotals(...args), want);
  });
}

// Not in the PHP suite: floats. 3 x 45 minus 10% must not land on 121.50000001.
test('cart: money is rounded to two decimals', () => {
  const t = cartTotals(135, discountFor(135, pct10), FEE, FREE_OVER);
  assert.deepEqual(t, { subtotal: 135, discount: 13.5, shipping: 30, total: 151.5 });
});

/* ------------------------------------------------------- the basket ceiling */

test('the browser and the server agree on the line cap', async () => {
  /*
   * lib/cart.js repeats the number instead of importing lib/config.js, because
   * importing it into a client module would pull SHIPPING_FEE, the rate-limit
   * table and everything else in that file into the browser bundle to read one
   * integer. This is what stops the two spellings drifting — the same
   * arrangement middleware.js and lib/auth.js use for the CSRF cookie name.
   *
   * Drift in either direction is a real bug, not a tidiness problem. If the
   * browser's cap were the larger of the two, a customer could fill a basket
   * the checkout then refuses after they had typed their address; if it were
   * the smaller, the server's limit would be unreachable and untested.
   */
  const { MAX_LINES } = await import('../lib/cart.js');
  const { maxOrderLines } = await import('../lib/config.js');
  assert.equal(MAX_LINES, maxOrderLines,
    'lib/cart.js and lib/config.js disagree about how many products a basket may hold');
});
