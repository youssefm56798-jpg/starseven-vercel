/**
 * The customer-facing order number, and the two checkout guards that bound how
 * much one request can take.
 *
 * lib/order-number.js is pure and imports nothing, so it is exercised directly.
 * The route guards are checked as text, the same way tests/db-grants.test.mjs
 * and tests/route-handler-auth.test.mjs read their subjects: app/api/order/
 * route.js imports next/server and the database client, neither of which
 * resolves under node:test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatRef, normaliseRef, isRef, fakeOrderRef } from '../lib/order-number.js';
import { maxOrderLines, orderHoldHours, limits } from '../lib/config.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ORDER_ROUTE = readFileSync(`${ROOT}app/api/order/route.js`, 'utf8');

/* ----------------------------------------------------------- how it reads */

test('a number is shown with a hash, an old reference unchanged', () => {
  assert.equal(formatRef('10001'), '#10001');
  assert.equal(formatRef(10001), '#10001');
  // Orders placed before the change keep their reference and must not acquire a
  // hash, which would make the printed value disagree with the stored one.
  assert.equal(formatRef('S7-2708-12345'), 'S7-2708-12345');
  assert.equal(formatRef(''), '');
  assert.equal(formatRef(null), '');
});

test('what a customer types comes back as what the database stores', () => {
  // All four are the same order. The hash is printed, so it gets pasted back.
  for (const typed of ['10001', '#10001', ' #10001 ', '# 10001']) {
    assert.equal(normaliseRef(typed), '10001', `${JSON.stringify(typed)} did not normalise`);
  }
  // The old shape is uppercased, because a customer types what they see.
  assert.equal(normaliseRef('s7-2708-12345'), 'S7-2708-12345');
  assert.equal(normaliseRef(null), '');
});

test('normalising is what makes a printed number findable', () => {
  // The property that matters, stated as a round trip: anything this app shows
  // a customer must survive being typed back in.
  for (const stored of ['10001', '999999', 'S7-2708-12345']) {
    assert.equal(normaliseRef(formatRef(stored)), stored);
  }
});

test('both shapes are recognised, and nothing else is', () => {
  assert.ok(isRef('10001'));
  assert.ok(isRef('S7-2708-12345'));
  assert.ok(isRef('S7-2708-1234'), 'the four-digit era must still be accepted');

  for (const junk of ['', '#10001', 'S7-2708', 'DROP TABLE', '10001; --', 'S7--1234', '1'.repeat(20)]) {
    assert.equal(isRef(junk), false, `${JSON.stringify(junk)} was accepted as a reference`);
  }
});

/* --------------------------------------------------------- the honeypot */

test('the honeypot answer looks like a real number and comes from nowhere', () => {
  /*
   * A bot that fills the hidden field is answered exactly as a customer is, so
   * the reply has to be number-shaped. It must NOT come from the sequence: that
   * would let a bot advance the real numbering, and would tell it where the
   * counter is - which is the shop's order volume.
   */
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const ref = fakeOrderRef();
    assert.match(ref, /^\d{5}$/);
    seen.add(ref);
  }
  assert.ok(seen.size > 400, `only ${seen.size} distinct values in 500 - this is not random`);

  const src = readFileSync(`${ROOT}lib/order-number.js`, 'utf8');
  assert.doesNotMatch(src, /nextval/, 'lib/order-number.js reaches for the sequence');
  assert.doesNotMatch(src, /from '\.\/db\.js'/,
    'lib/order-number.js imports the database client, which drags Neon into the browser bundle');
});

test('the honeypot does not draw from the sequence', () => {
  // Asserted at the call site as well as in the module, because the mistake
  // would be made here: replying to a bot with the next real number.
  const at = ORDER_ROUTE.indexOf('trapped(body.hp)');
  assert.ok(at > 0, 'the honeypot branch has moved');
  assert.match(ORDER_ROUTE.slice(at, at + 200), /fakeOrderRef\(\)/);
});

/* --------------------------------------------------------- the sequence */

test('the order number comes from a sequence, drawn once', () => {
  assert.match(ORDER_ROUTE, /nextval\('order_ref_seq'\)/,
    'the checkout no longer draws its reference from the sequence');

  // Once, not per attempt. A sequence cannot collide, so re-drawing inside the
  // retry loop would burn numbers to no purpose.
  const draws = ORDER_ROUTE.match(/nextval\('order_ref_seq'\)/g) || [];
  assert.equal(draws.length, 1, 'the sequence is read more than once per checkout');

  const draw = ORDER_ROUTE.indexOf("nextval('order_ref_seq')");
  const loop = ORDER_ROUTE.indexOf('for (let attempt =');
  assert.ok(loop > draw, 'the number is drawn inside the retry loop rather than before it');
});

test('the sequence carries a grant, or every order fails in production', () => {
  /*
   * The failure this exists for is invisible in development. nextval() on a
   * STANDALONE sequence needs USAGE granted explicitly - an identity column's
   * hidden sequence does not - and the owner role used locally can do anything.
   * So the checkout works on every developer machine and every order fails on
   * the deployment that actually sets DATABASE_URL_APP.
   */
  const schema = readFileSync(`${ROOT}db/schema.sql`, 'utf8');
  const sequences = [...schema.matchAll(/CREATE SEQUENCE (?:IF NOT EXISTS )?([a-z_]+)/gi)].map(m => m[1]);
  assert.ok(sequences.includes('order_ref_seq'), 'order_ref_seq is not created by the schema');

  const grants = readFileSync(`${ROOT}db/grants.mjs`, 'utf8');
  for (const seq of sequences) {
    assert.match(grants, new RegExp(`${seq}:`), `${seq} has no entry in SEQUENCE_GRANTS`);
  }
  assert.match(grants, /GRANT \$\{privs\.join\(', '\)\} ON SEQUENCE/,
    'grantStatements no longer emits sequence grants');
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

test('the order number sequence starts where the shop says it does', () => {
  // This assertion earns its place because the failure it guards is silent.
  // The line is CREATE SEQUENCE IF NOT EXISTS, so on any database that already
  // has the sequence - which is every deployed one - editing the number here
  // does precisely nothing. Someone changes it, deploys, sees no error, and
  // believes it took. Only a fresh database would ever disagree.
  //
  // It also has to match what the customer is told. The find form's
  // placeholder, the error message when a reference will not parse and the
  // examples in the Arabic and English copy all print a specimen number, and a
  // specimen of the wrong length teaches people to type the wrong thing.
  const START = 100001;
  const schema = readFileSync(`${ROOT}db/schema.sql`, 'utf8');

  const line = schema.match(/CREATE SEQUENCE IF NOT EXISTS order_ref_seq[^;]*;/);
  assert.ok(line, 'the order_ref_seq sequence is gone from db/schema.sql');
  // Read the numbers out and compare them as numbers. Building the pattern
  // from a template literal is a trap here: a lone backslash-b in a template
  // literal is a backspace character, not a word boundary, so the regex
  // silently matches nothing and the test fails on a correct schema.
  const startsAt = Number((line[0].match(/START WITH (\d+)/) || [])[1]);
  const minimum  = Number((line[0].match(/MINVALUE (\d+)/) || [])[1]);

  assert.equal(startsAt, START, `the sequence starts at ${startsAt}, not ${START}`);
  assert.equal(minimum, START,
    `MINVALUE is ${minimum}, not ${START} - a RESTART could drop below the floor`);

  // Every place a specimen number is shown to a customer.
  const shown = [
    'app/order/find/FindForm.js',
    'app/_views/order-find.js',
    'app/api/order/find/route.js',
  ];
  for (const file of shown) {
    const text = readFileSync(ROOT + file, 'utf8');
    const specimens = [...text.matchAll(/#\s?(\d{4,})/g)].map(m => m[1]);
    for (const n of specimens) {
      assert.equal(n.length, String(START).length,
        `${file} shows #${n} as an example, which is ${n.length} digits — `
        + `real order numbers are ${String(START).length}`);
    }
  }
});
