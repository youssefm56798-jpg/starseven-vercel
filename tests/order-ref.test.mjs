/**
 * The order reference, and the two checkout guards that bound how much one
 * request can take.
 *
 * orderRef() is exercised directly — lib/http.js is pure and imports nothing.
 * The route guards are checked as text, the same way tests/db-grants.test.mjs
 * and tests/route-handler-auth.test.mjs read their subjects: app/api/order/
 * route.js imports next/server and the database client, neither of which
 * resolves under node:test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { orderRef } from '../lib/http.js';
import { maxOrderLines, orderHoldHours, limits } from '../lib/config.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ORDER_ROUTE = readFileSync(`${ROOT}app/api/order/route.js`, 'utf8');

/* ------------------------------------------------------------- the shape */

test('a reference is S7, the day and month, and five digits', () => {
  assert.match(orderRef(), /^S7-\d{4}-\d{5}$/);
});

test('the day and month are UTC, and are the ones the server is having', () => {
  // Not a formatting nicety: the reference is minted on Vercel, which runs in
  // UTC, and read by a customer in Cairo. What matters is that both halves come
  // from the same clock, so a reference cannot be minted with yesterday's date
  // and today's digits.
  const now = new Date();
  const dm = String(now.getUTCDate()).padStart(2, '0')
    + String(now.getUTCMonth() + 1).padStart(2, '0');
  assert.equal(orderRef().slice(3, 7), dm);
});

/* --------------------------------------------------------- the randomness */

test('references do not repeat the way a small or biased space would', () => {
  /*
   * Five thousand draws out of a hundred thousand. This is a smoke test for the
   * two ways the generator can go wrong and not look wrong: a space that is
   * smaller than it claims, and a modulo bias that crowds the low end.
   *
   * The bound is deliberately loose. The birthday expectation for 5000 draws
   * from 100000 is around 120 collisions, and the old four-digit generator
   * would produce thousands — so anything under 400 distinguishes the two
   * without ever failing on an unlucky run.
   */
  const seen = new Set();
  let collisions = 0;
  for (let i = 0; i < 5000; i++) {
    const digits = orderRef().slice(-5);
    if (seen.has(digits)) collisions++;
    seen.add(digits);
  }
  assert.ok(collisions < 400, `${collisions} collisions in 5000 draws — the space is not 100000 wide`);
});

test('the digits are spread across the whole range, not crowded into the low end', () => {
  // What a modulo of a 16- or 32-bit value onto 100000 looks like from outside.
  // Ten buckets, four thousand draws: an unbiased generator puts about 400 in
  // each, and 150 is far enough below that to catch a real skew and far enough
  // above zero never to fire on noise.
  const buckets = new Array(10).fill(0);
  for (let i = 0; i < 4000; i++) buckets[Math.floor(Number(orderRef().slice(-5)) / 10000)]++;

  const low = Math.min(...buckets);
  assert.ok(low > 150, `the thinnest tenth of the range held only ${low} of 4000: ${buckets.join(', ')}`);
});

test('the reference is not drawn from Math.random', () => {
  /*
   * The property, asserted against the source rather than the output, because
   * no sample of numbers can prove where they came from.
   *
   * Math.random() is a PRNG whose state is recoverable from a handful of
   * outputs, so a customer who places three orders could predict the references
   * given to the customers after them. Nothing in the app treats a reference as
   * unguessable today — the credential is the token in lib/order-access.js —
   * and this is what keeps that true for whatever is written next.
   */
  const http = readFileSync(`${ROOT}lib/http.js`, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert.doesNotMatch(http, /Math\.random/, 'lib/http.js is back on Math.random for a value that names an order');
  assert.match(http, /crypto\.getRandomValues/);
});

/* ------------------------------------------------------ the checkout caps */

test('an order is capped at a sane number of distinct products', () => {
  assert.ok(Number.isInteger(maxOrderLines) && maxOrderLines > 0 && maxOrderLines <= 50,
    `maxOrderLines is ${maxOrderLines}, which is either not a count or not a cap`);

  // The cap has to be applied to the MERGED basket. Counting the raw request
  // instead would refuse a customer whose cart happens to list one jar on three
  // lines, and counting before the merge was how the qty cap was nearly got
  // around in the first place.
  const merge = ORDER_ROUTE.indexOf('want.set(');
  const check = ORDER_ROUTE.indexOf('want.size > maxOrderLines');
  assert.ok(merge >= 0 && check > merge,
    'the line cap no longer runs after the duplicate-SKU merge');
});

test('the checkout refuses rather than truncating an oversized basket', () => {
  // Silently dropping lines would confirm an order that is not the one the
  // customer pressed Confirm on, and the first they would hear of it is the
  // driver arriving with the wrong box.
  const at = ORDER_ROUTE.indexOf('want.size > maxOrderLines');
  const branch = ORDER_ROUTE.slice(at, at + 500);
  assert.match(branch, /return fail\(/, 'the oversized-basket branch no longer refuses the order');
});

test('orders are rate limited on the phone number as well as the network', () => {
  const [max, windowSec] = limits.orderPhone;
  assert.ok(max > 0 && max <= 20, `limits.orderPhone allows ${max} an hour, which is not a limit`);
  assert.ok(windowSec >= 600, 'the per-phone window is short enough to be waited out');

  // Keyed on the normalised number, so 010…, +2010… and 0020 10… are one
  // bucket rather than three. Asserted by position: the limiter has to run
  // after normalizePhone, not on the raw field.
  const normalise = ORDER_ROUTE.indexOf('normalizePhone(body.phone)');
  const limit = ORDER_ROUTE.indexOf("rateOk('order-phone'");
  assert.ok(normalise >= 0 && limit > normalise,
    'the per-phone limiter keys on the raw request field rather than the normalised number');
});

/* --------------------------------------------------------- the stock hold */

test('the unconfirmed-order hold is set to something a real shop can live with', () => {
  // 0 is a legitimate setting — it turns the sweep off — but any value between
  // 1 and a working day would cancel real orders faster than a shop can ring
  // them back, which is a worse failure than the one the sweep prevents.
  assert.ok(orderHoldHours === 0 || orderHoldHours >= 24,
    `ORDER_HOLD_HOURS is ${orderHoldHours}, which cancels orders before the shop can call them`);
});

test('the sweep only ever touches orders nobody has looked at', () => {
  const sweep = readFileSync(`${ROOT}app/api/cron/release/route.js`, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');

  assert.match(sweep, /status\s*=\s*'new'/,
    'the sweep no longer restricts itself to new orders — a confirmed order has a real person behind it');

  // It must not have its own idea of what cancelling means. transition() owns
  // the restock, the coupon return and the audit row, and a second
  // implementation here is exactly how stock gets credited twice.
  assert.match(sweep, /transitionAndNotify\(/);
  assert.doesNotMatch(sweep, /UPDATE\s+products|UPDATE\s+orders/,
    'the sweep writes to orders or products directly instead of going through transition()');
});
