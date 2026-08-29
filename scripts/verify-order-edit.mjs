#!/usr/bin/env node
/**
 * NEW STAR SEVEN — editing an order, against a real Postgres.
 *
 *   npm run verify:edit
 *
 * Why this is a script and not a test: everything under tests/ runs with no
 * database, on purpose. lib/order-edit.js is almost entirely SQL, and the parts
 * of it that are expensive to get wrong cannot be exercised without a server —
 * the guard that refuses an increase there is no stock for, the compare-and-swap
 * that stops two admins saving the same order at once, the coupon swap that has
 * to return one redemption and spend another inside a single transaction. Unit
 * tests prove the policy table and the arithmetic; this proves the statements.
 *
 * It is safe to run against the production connection string, because it does
 * not use it. It creates its own database, applies the REAL db/schema.sql to it,
 * runs everything there and drops it in a finally. Before the first write it
 * asserts that current_database() is the throwaway one and that `orders`
 * resolves to nothing — if either check fails it aborts, because the failure it
 * is guarding against is writing to the real orders table.
 *
 * Three bugs in this repository have passed a sequential test and failed a
 * concurrent one: a double cancel crediting stock twice, a double-submitted
 * checkout writing two orders, and a duplicate being told an item had sold out
 * when its own twin had taken the stock. So the last third of this file is
 * nothing but overlapping requests.
 */

import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEnv } from './env-file.mjs';
import { splitStatements } from './sql-split.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

for (const f of ['.env.local', '.env']) {
  const p = join(ROOT, f);
  if (existsSync(p)) applyEnv(readFileSync(p, 'utf8'));
}

/* CREATE DATABASE is refused through a connection pooler, so this wants the
   direct endpoint. Neon supplies both. */
const base = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!base) {
  console.error('\n  ERROR  DATABASE_URL is not set. See .env.example.\n');
  process.exit(1);
}

const DB = `s7_edit_${randomBytes(4).toString('hex')}`;

const { neon } = await import('@neondatabase/serverless');
const admin = neon(base);

const url = new URL(base);
url.pathname = `/${DB}`;
const raw = neon(url.toString());
const run = typeof raw.query === 'function' ? text => raw.query(text) : text => raw(text);

let failures = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function check(name, got, want) {
  if (same(got, want)) return console.log(`    ok    ${name}`);
  failures++;
  console.log(`    FAIL  ${name}`);
  console.log(`          got  ${JSON.stringify(got)}`);
  console.log(`          want ${JSON.stringify(want)}`);
}

console.log('\n  New Star Seven — order editing');
console.log(`  throwaway database: ${DB}`);

await admin`SELECT 1`;
await admin(`CREATE DATABASE "${DB}"`);

try {
  /* --------------------------------------------------------------- guards */

  const [{ d }] = await raw`SELECT current_database() AS d`;
  if (d !== DB) throw new Error(`connected to "${d}", not "${DB}". Aborting.`);
  const [{ t }] = await raw`SELECT to_regclass('orders')::text AS t`;
  if (t !== null) throw new Error(`"orders" already resolves to ${t}. Aborting.`);
  console.log(`  guard: current_database() = ${d}, and it is empty\n`);

  // The real schema, statement by statement. Nothing here is a hand-written
  // approximation of it: a column this file invents is a column production
  // does not have.
  for (const stmt of splitStatements(readFileSync(join(ROOT, 'db/schema.sql'), 'utf8'))) {
    await run(stmt);
  }

  // The modules read DATABASE_URL on their first query, so it has to point at
  // the throwaway database before anything imports them.
  process.env.DATABASE_URL = url.toString();

  const { editOrder, EDITABLE, canEdit } = await import('../lib/order-edit.js');
  const { transition } = await import('../lib/order-status.js');
  const { timelineFor } = await import('../lib/order-access.js');
  const { cartTotals, discountFor } = await import('../lib/pricing.js');
  const { site } = await import('../lib/config.js');

  console.log(`  shipping ${site.shipping}, free over ${site.freeOver}\n`);

  /* ------------------------------------------------------------- fixtures */

  let n = 0;
  const mkProduct = async (price, stock, name = 'Wax') => {
    const sku = `S7-T-${(++n).toString().padStart(3, '0')}`;
    const [p] = await raw`
      INSERT INTO products (sku, slug, name_ar, name_en, price, stock, image, active)
      VALUES (${sku}, ${`slug-${sku}`}, ${`${name} ar`}, ${name}, ${price}, ${stock}, 'x.webp', true)
      RETURNING id, sku`;
    return { id: Number(p.id), sku: p.sku, price };
  };

  /**
   * An order written the way checkout writes one: the money recomputed with
   * lib/pricing.js, the lines carrying the price they were sold at, and the
   * stock already taken off the shelf.
   */
  const mkOrder = async (lines, { status = 'confirmed', coupon = '', city = '', discount = 0 } = {}) => {
    const subtotal = lines.reduce((s, l) => s + l.product.price * l.qty, 0);
    const t = cartTotals(subtotal, discount, site.shipping, site.freeOver);
    // The status is part of the INSERT rather than an UPDATE afterwards. A
    // fixture is not a transition, and the only thing allowed to move that
    // column on a row that already exists is lib/order-status.js.
    const [o] = await raw`
      INSERT INTO orders (ref, name, phone, address, city, email, lang, coupon, status,
                          subtotal, discount, shipping, total)
      VALUES (${`S7-T-${randomBytes(4).toString('hex')}`}, 'Test Customer', '01028282216',
              'a real looking address 12', ${city}, 'buyer@example.com', 'en', ${coupon}, ${status},
              ${t.subtotal}, ${t.discount}, ${t.shipping}, ${t.total})
      RETURNING id`;
    const id = Number(o.id);
    for (const l of lines) {
      await raw`
        INSERT INTO order_items (order_id, product_id, sku, name, price, qty)
        VALUES (${id}, ${l.product.id}, ${l.product.sku}, 'Line', ${l.product.price}, ${l.qty})`;
      await raw`UPDATE products SET stock = stock - ${l.qty} WHERE id = ${l.product.id}`;
    }
    return id;
  };

  const stockOf = async id => Number((await raw`SELECT stock FROM products WHERE id = ${id}`)[0].stock);
  const usesOf = async code => Number((await raw`SELECT used_count FROM offers WHERE code = ${code}`)[0].used_count);
  const itemsOf = async id => (await raw`
    SELECT id, product_id, sku, name, price::float8 AS price, qty
      FROM order_items WHERE order_id = ${id} ORDER BY id`)
    .map(r => ({ ...r, id: Number(r.id), qty: Number(r.qty), product_id: Number(r.product_id) }));
  const orderOf = async id => {
    const [o] = await raw`
      SELECT status, coupon, phone, address, city, notes, edit_seq,
             subtotal::float8 AS subtotal, discount::float8 AS discount,
             shipping::float8 AS shipping, total::float8 AS total,
             expected_from::text AS ef, expected_to::text AS et
        FROM orders WHERE id = ${id}`;
    return { ...o, edit_seq: Number(o.edit_seq) };
  };
  const eventsOf = async id => (await raw`
    SELECT kind, actor, note FROM order_events WHERE order_id = ${id} ORDER BY id`);

  /** The money four ways, so a total can never be right by accident. */
  const totalsAgree = async (id, lines, discount = 0) => {
    const o = await orderOf(id);
    const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
    const want = cartTotals(subtotal, discount, site.shipping, site.freeOver);
    return same(
      [o.subtotal, o.discount, o.shipping, o.total],
      [want.subtotal, want.discount, want.shipping, want.total],
    ) ? 'agrees' : `${JSON.stringify(o)} vs ${JSON.stringify(want)}`;
  };

  /* ------------------------------------------------------------------ 1 */

  console.log('  the status policy');
  {
    check('editable is new and confirmed', EDITABLE, ['new', 'confirmed']);
    for (const s of ['new', 'confirmed']) check(`${s} is editable`, canEdit(s), true);
    for (const s of ['shipped', 'delivered', 'cancelled']) {
      const p = await mkProduct(100, 10);
      const id = await mkOrder([{ product: p, qty: 1 }], { status: s });
      const res = await editOrder({ orderId: id, actor: 'admin:1', lines: [{ id: (await itemsOf(id))[0].id, qty: 3 }] });
      check(`${s} is refused`, [res.ok, res.reason, res.from], [false, 'not-editable', s]);
      check(`${s} took no stock`, await stockOf(p.id), 9);
      check(`${s} logged nothing`, (await eventsOf(id)).length, 0);
    }
  }

  /* ------------------------------------------------------------------ 2 */

  console.log('\n  a quantity going up');
  {
    const p = await mkProduct(120, 10);
    const id = await mkOrder([{ product: p, qty: 1 }]);
    check('stock before', await stockOf(p.id), 9);

    const [line] = await itemsOf(id);
    const res = await editOrder({ orderId: id, actor: 'admin:7', lines: [{ id: line.id, qty: 3 }] });

    check('ok and changed', [res.ok, res.changed], [true, true]);
    check('two more units taken', await stockOf(p.id), 7);
    check('the line reads three', (await itemsOf(id)).map(i => i.qty), [3]);
    check('the totals are what lib/pricing.js says',
      await totalsAgree(id, [{ price: 120, qty: 3 }]), 'agrees');
    check('the sequence moved', (await orderOf(id)).edit_seq, 1);

    const ev = await eventsOf(id);
    check('one edit event, by the admin', [ev.length, ev[0]?.kind, ev[0]?.actor], [1, 'edit', 'admin:7']);
    check('and it says what changed', /x1 to x3/.test(ev[0]?.note || ''), true);
    // Both sides of the money, spelled out, because that is the sentence
    // somebody reads six weeks later. Derived rather than typed, so the
    // assertion is about the note and not about the shipping fee of the day.
    const was = cartTotals(120, 0, site.shipping, site.freeOver).total.toFixed(2);
    const now = cartTotals(360, 0, site.shipping, site.freeOver).total.toFixed(2);
    check('and it carries both totals',
      (ev[0]?.note || '').includes(`total ${was} to ${now}`), true);
    check('the status was not touched', (await orderOf(id)).status, 'confirmed');
  }

  /* ------------------------------------------------------------------ 3 */

  console.log('\n  a quantity coming down');
  {
    const p = await mkProduct(120, 10);
    const id = await mkOrder([{ product: p, qty: 4 }]);
    check('stock before', await stockOf(p.id), 6);

    const [line] = await itemsOf(id);
    const res = await editOrder({ orderId: id, actor: 'admin:1', lines: [{ id: line.id, qty: 1 }] });

    check('ok', res.ok, true);
    check('three units back on the shelf', await stockOf(p.id), 9);
    check('the totals follow', await totalsAgree(id, [{ price: 120, qty: 1 }]), 'agrees');
  }

  /* ------------------------------------------------------------------ 4 */

  console.log('\n  an increase there is not enough stock for');
  {
    const p = await mkProduct(120, 3);
    const id = await mkOrder([{ product: p, qty: 2 }]);
    check('one unit left on the shelf', await stockOf(p.id), 1);

    const [line] = await itemsOf(id);
    const before = await orderOf(id);
    const res = await editOrder({ orderId: id, actor: 'admin:1', lines: [{ id: line.id, qty: 5 }] });

    check('refused, and it names the shelf', [res.ok, res.reason, res.sku], [false, 'no-stock', p.sku]);
    check('NOTHING was taken', await stockOf(p.id), 1);
    check('the line is untouched', (await itemsOf(id)).map(i => i.qty), [2]);
    check('the money is untouched', await orderOf(id), before);
    check('and nothing was logged', (await eventsOf(id)).length, 0);
  }

  /* ------------------------------------------------------------------ 5 */

  console.log('\n  removing a line');
  {
    const a = await mkProduct(120, 10);
    const b = await mkProduct(80, 10);
    const id = await mkOrder([{ product: a, qty: 2 }, { product: b, qty: 3 }]);
    check('stock before', [await stockOf(a.id), await stockOf(b.id)], [8, 7]);

    const lines = await itemsOf(id);
    const res = await editOrder({ orderId: id, actor: 'admin:1', lines: [{ id: lines[1].id, qty: 0 }] });

    check('ok', res.ok, true);
    check('all three units came back, and only those', [await stockOf(a.id), await stockOf(b.id)], [8, 10]);
    check('the row is gone', (await itemsOf(id)).length, 1);
    check('the totals follow', await totalsAgree(id, [{ price: 120, qty: 2 }]), 'agrees');
    check('the event names the line that went', /removed/.test((await eventsOf(id))[0].note), true);
  }

  /* ------------------------------------------------------------------ 6 */

  console.log('\n  emptying an order is not an edit');
  {
    const p = await mkProduct(120, 10);
    const id = await mkOrder([{ product: p, qty: 2 }]);
    const [line] = await itemsOf(id);
    const res = await editOrder({ orderId: id, actor: 'admin:1', lines: [{ id: line.id, qty: 0 }] });
    check('refused', [res.ok, res.reason], [false, 'empty']);
    check('the stock stayed taken', await stockOf(p.id), 8);
    check('the line is still there', (await itemsOf(id)).length, 1);
  }

  /* ------------------------------------------------------------------ 7 */

  console.log('\n  adding a line');
  {
    const a = await mkProduct(120, 10);
    const b = await mkProduct(65, 4, 'Gel');
    const id = await mkOrder([{ product: a, qty: 1 }]);

    const res = await editOrder({ orderId: id, actor: 'admin:1', add: [{ sku: b.sku, qty: 2 }] });
    check('ok', res.ok, true);
    check('the new shelf paid for it', await stockOf(b.id), 2);
    check('the old one did not move', await stockOf(a.id), 9);

    const lines = await itemsOf(id);
    check('two lines now', lines.length, 2);
    check('priced from the catalogue, not from the caller', lines[1].price, 65);
    check('the totals follow',
      await totalsAgree(id, [{ price: 120, qty: 1 }, { price: 65, qty: 2 }]), 'agrees');

    // Adding what is already there is a quantity, not a second row: two rows
    // for one SKU would break the customer order page, which keys on it.
    const again = await editOrder({ orderId: id, actor: 'admin:1', add: [{ sku: b.sku, qty: 1 }] });
    check('adding it again merges', again.ok, true);
    check('still two lines', (await itemsOf(id)).length, 2);
    check('the line grew', (await itemsOf(id))[1].qty, 3);
    check('and one more unit was taken', await stockOf(b.id), 1);

    const bad = await editOrder({ orderId: id, actor: 'admin:1', add: [{ sku: 'S7-NOT-A-THING', qty: 1 }] });
    check('an unknown sku is refused', [bad.ok, bad.reason], [false, 'unknown-sku']);

    const [dead] = await raw`
      INSERT INTO products (sku, slug, name_ar, name_en, price, stock, image, active)
      VALUES ('S7-T-FREE', 'slug-free', 'ar', 'Unpriced', 0, 50, 'x.webp', true) RETURNING id`;
    const free = await editOrder({ orderId: id, actor: 'admin:1', add: [{ sku: 'S7-T-FREE', qty: 1 }] });
    check('an unpriced product is refused', [free.ok, free.reason], [false, 'unpriced']);
    check('and it is still on the shelf', await stockOf(Number(dead.id)), 50);
  }

  /* ------------------------------------------------------------------ 8 */

  console.log('\n  swapping the coupon');
  {
    await raw`
      INSERT INTO offers (title_ar, body_ar, code, discount_type, discount_value, used_count)
      VALUES ('a', 'b', 'TEN', 'percent', 10, 3)`;
    await raw`
      INSERT INTO offers (title_ar, body_ar, code, discount_type, discount_value, used_count)
      VALUES ('a', 'b', 'FIFTY', 'fixed', 50, 0)`;

    const p = await mkProduct(200, 10);
    const id = await mkOrder([{ product: p, qty: 2 }], { coupon: 'TEN', discount: 40 });
    check('uses before', [await usesOf('TEN'), await usesOf('FIFTY')], [3, 0]);

    const res = await editOrder({ orderId: id, actor: 'admin:1', coupon: 'fifty' });
    check('ok', res.ok, true);
    check('one returned, one spent', [await usesOf('TEN'), await usesOf('FIFTY')], [2, 1]);
    check('the code is stored upper case', (await orderOf(id)).coupon, 'FIFTY');
    check('the discount is the new code',
      await totalsAgree(id, [{ price: 200, qty: 2 }], 50), 'agrees');

    // Clearing it gives the redemption back and nothing takes its place.
    const off = await editOrder({ orderId: id, actor: 'admin:1', coupon: '' });
    check('clearing it is ok', off.ok, true);
    check('the redemption came back', await usesOf('FIFTY'), 0);
    check('no discount left', await totalsAgree(id, [{ price: 200, qty: 2 }], 0), 'agrees');
  }

  /* ------------------------------------------------------------------ 9 */

  console.log('\n  a coupon at its cap');
  {
    await raw`
      INSERT INTO offers (title_ar, body_ar, code, discount_type, discount_value, max_uses, used_count)
      VALUES ('a', 'b', 'ONCE', 'fixed', 30, 1, 1)`;
    await raw`
      INSERT INTO offers (title_ar, body_ar, code, discount_type, discount_value, used_count)
      VALUES ('a', 'b', 'KEEP', 'fixed', 20, 5)`;

    const p = await mkProduct(200, 10);
    const id = await mkOrder([{ product: p, qty: 1 }], { coupon: 'KEEP', discount: 20 });
    const before = await orderOf(id);

    const res = await editOrder({ orderId: id, actor: 'admin:1', coupon: 'ONCE' });
    check('refused', [res.ok, res.reason], [false, 'coupon-spent']);
    check('the spent code was not spent again', await usesOf('ONCE'), 1);
    check('and the code it already had was NOT returned', await usesOf('KEEP'), 5);
    check('the order is untouched', await orderOf(id), before);
  }

  /* ----------------------------------------------------------------- 10 */

  console.log('\n  a coupon whose minimum the edit would break');
  {
    await raw`
      INSERT INTO offers (title_ar, body_ar, code, discount_type, discount_value, min_total, used_count)
      VALUES ('a', 'b', 'BIG', 'fixed', 40, 300, 2)`;

    const p = await mkProduct(200, 10);
    const id = await mkOrder([{ product: p, qty: 2 }], { coupon: 'BIG', discount: 40 });
    const [line] = await itemsOf(id);
    const before = await orderOf(id);

    const res = await editOrder({ orderId: id, actor: 'admin:1', lines: [{ id: line.id, qty: 1 }] });
    check('refused rather than quietly dropping the discount',
      [res.ok, res.reason, res.min], [false, 'coupon-min', 300]);
    check('the stock did not move', await stockOf(p.id), 8);
    check('the order is untouched', await orderOf(id), before);

    // Clearing the code in the same edit is the way through, and it is one
    // action rather than two — so the order is never in a state where the
    // basket and the discount disagree.
    const both = await editOrder({
      orderId: id, actor: 'admin:1', coupon: '', lines: [{ id: line.id, qty: 1 }],
    });
    check('dropping the code and the jar together works', both.ok, true);
    check('the redemption came back', await usesOf('BIG'), 1);
    check('the totals follow', await totalsAgree(id, [{ price: 200, qty: 1 }], 0), 'agrees');
  }

  /* ----------------------------------------------------------------- 11 */

  console.log('\n  a coupon that has since been switched off');
  {
    await raw`
      INSERT INTO offers (title_ar, body_ar, code, discount_type, discount_value, active, ends_at, used_count)
      VALUES ('a', 'b', 'OVER', 'fixed', 25, false, now() - interval '2 days', 4)`;

    const p = await mkProduct(200, 10);
    const id = await mkOrder([{ product: p, qty: 2 }], { coupon: 'OVER', discount: 25 });
    const [line] = await itemsOf(id);

    // The redemption already happened at checkout. An offer that ended is not a
    // reason to take the discount off an order somebody already agreed to, in a
    // screen opened to correct a house number.
    const res = await editOrder({ orderId: id, actor: 'admin:1', lines: [{ id: line.id, qty: 3 }] });
    check('the edit goes through', res.ok, true);
    check('the discount survives', await totalsAgree(id, [{ price: 200, qty: 3 }], 25), 'agrees');
    check('and the code was not spent again', await usesOf('OVER'), 4);

    // Applying it fresh is a different question, and the answer is no.
    const p2 = await mkProduct(200, 10);
    const id2 = await mkOrder([{ product: p2, qty: 1 }]);
    const fresh = await editOrder({ orderId: id2, actor: 'admin:1', coupon: 'OVER' });
    check('but it cannot be applied to another order', [fresh.ok, fresh.reason], [false, 'coupon-invalid']);
  }

  /* ----------------------------------------------------------------- 12 */

  console.log('\n  free delivery is recomputed, not remembered');
  {
    const p = await mkProduct(site.freeOver, 10);
    const id = await mkOrder([{ product: p, qty: 1 }]);
    check('it shipped free at the threshold', (await orderOf(id)).shipping, 0);

    const [line] = await itemsOf(id);
    // There is only one line and it cannot go to zero, so the way under the
    // threshold is a cheaper basket: swap the line out for a cheap one.
    const cheap = await mkProduct(50, 10);
    const res = await editOrder({
      orderId: id, actor: 'admin:1',
      lines: [{ id: line.id, qty: 0 }],
      add: [{ sku: cheap.sku, qty: 1 }],
    });
    check('ok', res.ok, true);
    check('delivery is charged again', (await orderOf(id)).shipping, site.shipping);
    check('the totals follow', await totalsAgree(id, [{ price: 50, qty: 1 }]), 'agrees');
    check('the expensive one went back on the shelf', await stockOf(p.id), 10);
  }

  /* ----------------------------------------------------------------- 13 */

  console.log('\n  where it is going');
  {
    const p = await mkProduct(120, 10);
    const id = await mkOrder([{ product: p, qty: 1 }], { city: 'القاهرة' });
    await transition({ orderId: id, to: 'confirmed', actor: 'admin:1' });
    const promised = await orderOf(id);
    check('a window was promised', promised.ef !== null, true);

    const res = await editOrder({
      orderId: id,
      actor: 'admin:2',
      contact: { phone: '+20 100 111 2233', address: 'the other flat, 9 some street', city: 'أسوان', notes: 'ring first' },
    });
    check('ok', res.ok, true);

    const now = await orderOf(id);
    check('the phone is normalised', now.phone, '01001112233');
    check('the address is stored', now.address, 'the other flat, 9 some street');
    check('the city changed', now.city, 'أسوان');
    check('the promise did NOT move', [now.ef, now.et], [promised.ef, promised.et]);
    check('and the status did not move', now.status, 'confirmed');
    check('the money did not move', [now.subtotal, now.total], [promised.subtotal, promised.total]);

    const bad = await editOrder({ orderId: id, actor: 'admin:2', contact: { phone: '0100' } });
    check('a bad number is refused', [bad.ok, bad.reason], [false, 'bad-phone']);
    const short = await editOrder({ orderId: id, actor: 'admin:2', contact: { address: 'x' } });
    check('an unusable address is refused', [short.ok, short.reason], [false, 'bad-address']);
    check('and neither of them wrote anything', (await orderOf(id)).phone, '01001112233');
  }

  /* ----------------------------------------------------------------- 14 */

  console.log('\n  correcting an address cannot reprice the order');
  {
    /*
     * The bug this exists to catch: recomputing the discount on EVERY edit
     * re-derives it from the offers row, and that row can be edited. An offer
     * that was 20 off when the order was placed and is 5 off today would
     * quietly raise what the customer owes at the door because somebody fixed
     * a house number. Nothing about the basket moved, so nothing about the
     * money may move either.
     */
    await raw`
      INSERT INTO offers (title_ar, body_ar, code, discount_type, discount_value, used_count)
      VALUES ('a', 'b', 'MOVED', 'fixed', 20, 1)`;

    const p = await mkProduct(200, 10);
    const id = await mkOrder([{ product: p, qty: 1 }], { coupon: 'MOVED', discount: 20 });
    const agreed = await orderOf(id);

    // The shop edits the offer, as the Offers screen lets it.
    await raw`UPDATE offers SET discount_value = 5 WHERE code = 'MOVED'`;

    const res = await editOrder({
      orderId: id, actor: 'admin:1', contact: { address: 'the other flat, 9 some street' },
    });
    check('the address change saves', res.ok, true);
    const now = await orderOf(id);
    check('the address moved', now.address, 'the other flat, 9 some street');
    check('and not one figure did',
      [now.subtotal, now.discount, now.shipping, now.total],
      [agreed.subtotal, agreed.discount, agreed.shipping, agreed.total]);
    check('the audit row says only what changed', /^address:/.test((await eventsOf(id))[0].note), true);

    // And the same when the code has been deleted outright. Refusing to save a
    // wrong address over a bookkeeping problem would be absurd.
    await raw`DELETE FROM offers WHERE code = 'MOVED'`;
    const again = await editOrder({
      orderId: id, actor: 'admin:1', contact: { city: 'الإسكندرية' },
    });
    check('a deleted code does not block an address fix', again.ok, true);
    check('and still nothing about the money moved', (await orderOf(id)).total, agreed.total);

    // But the moment the basket moves, the sum is redone from the database -
    // and a code that cannot be priced has to be dealt with rather than guessed
    // at.
    const [line] = await itemsOf(id);
    const priced = await editOrder({ orderId: id, actor: 'admin:1', lines: [{ id: line.id, qty: 2 }] });
    check('a basket change over a deleted code is refused',
      [priced.ok, priced.reason], [false, 'coupon-gone']);
    check('and it changed nothing', await stockOf(p.id), 9);

    // The way out, which is what the message on that refusal tells the admin to
    // do. Clearing a code whose row is gone must not itself fail.
    const cleared = await editOrder({
      orderId: id, actor: 'admin:1', coupon: '', lines: [{ id: line.id, qty: 2 }],
    });
    check('clearing the dead code lets the edit through', cleared.ok, true);
    check('the discount goes with it',
      await totalsAgree(id, [{ price: 200, qty: 2 }], 0), 'agrees');
  }

  console.log('\n  an order with more lines than an edit may create');
  {
    // The ceiling is about how big a transaction may get, not about how big an
    // order the shop is allowed to have. Checkout puts no limit on distinct
    // products, so refusing to correct the address on a large order forever
    // would be the bound doing harm instead of work.
    const { MAX_LINES } = await import('../lib/order-edit.js');
    const products = [];
    for (let i = 0; i <= MAX_LINES; i++) products.push(await mkProduct(20, 5));
    const id = await mkOrder(products.map(product => ({ product, qty: 1 })));
    check('the order is over the ceiling', (await itemsOf(id)).length, MAX_LINES + 1);

    const res = await editOrder({
      orderId: id, actor: 'admin:1', contact: { address: 'a different address 12' },
    });
    check('its address can still be corrected', res.ok, true);

    const grow = await editOrder({
      orderId: id, actor: 'admin:1', add: [{ sku: (await mkProduct(20, 5)).sku, qty: 1 }],
    });
    check('but it cannot grow any further', [grow.ok, grow.reason], [false, 'too-many']);
  }

  console.log('\n  a save that changes nothing');
  {
    const p = await mkProduct(120, 10);
    const id = await mkOrder([{ product: p, qty: 2 }]);
    const [line] = await itemsOf(id);
    const res = await editOrder({ orderId: id, actor: 'admin:1', lines: [{ id: line.id, qty: 2 }] });
    check('accepted, and reports no change', [res.ok, res.changed], [true, false]);
    check('no audit row for an edit that did not happen', (await eventsOf(id)).length, 0);
    check('the sequence did not move', (await orderOf(id)).edit_seq, 0);
  }

  /* ----------------------------------------------------------------- 15 */

  console.log('\n  a form that was already out of date');
  {
    const p = await mkProduct(120, 10);
    const id = await mkOrder([{ product: p, qty: 1 }]);
    const [line] = await itemsOf(id);

    // Somebody else saved while this form was open.
    await editOrder({ orderId: id, actor: 'admin:1', lines: [{ id: line.id, qty: 2 }] });

    const res = await editOrder({ orderId: id, actor: 'admin:2', expectSeq: 0, lines: [{ id: line.id, qty: 5 }] });
    check('refused', [res.ok, res.reason], [false, 'stale']);
    check('the other edit stands', (await itemsOf(id)).map(i => i.qty), [2]);
    check('and no extra stock was taken', await stockOf(p.id), 8);
  }

  /* ----------------------------------------------------------------- 16 */

  console.log('\n  what the customer is allowed to see of all this');
  {
    const p = await mkProduct(120, 10);
    const id = await mkOrder([{ product: p, qty: 1 }]);
    const [line] = await itemsOf(id);
    await editOrder({
      orderId: id,
      actor: 'admin:9',
      lines: [{ id: line.id, qty: 2 }],
      contact: { address: 'flat 4, a private address' },
    });

    const shop = await eventsOf(id);
    check('the shop sees the edit', shop.some(e => e.kind === 'edit'), true);
    check('with the old address in it', /a private address/.test(shop[0].note), true);

    // lib/order-access.js decides what a token buys. An edit row carries the
    // admin id and both sides of the address, and the customer timeline must
    // not return it - which it does not, because the filter is a whitelist of
    // kinds rather than a list of the ones to hide.
    const theirs = await timelineFor(id);
    check('the customer sees no edit rows', theirs.some(e => e.kind === 'edit'), false);
    check('and nothing carrying an actor or a note', theirs.length, 0);
  }

  /* ------------------------------------------------------- concurrency */

  console.log('\n  two admins saving the same order at once');
  {
    /*
     * The shape this actually takes in the shop: two people have the order open,
     * both forms were rendered against sequence 0, and both press Save. The
     * second one is describing a basket that no longer exists, so applying it
     * would silently undo the first.
     *
     * Deterministic on purpose. The overlap below is the same guarantee tested
     * from the other side, and that one is at the mercy of the network.
     */
    const p = await mkProduct(100, 20);
    const id = await mkOrder([{ product: p, qty: 1 }]);
    const [line] = await itemsOf(id);
    check('stock before', await stockOf(p.id), 19);

    const go = qty => editOrder({
      orderId: id, actor: `race:${qty}`, expectSeq: 0, lines: [{ id: line.id, qty }],
    }).catch(e => ({ ok: false, threw: String(e?.message || e) }));
    const results = await Promise.all([go(3), go(7)]);

    check('exactly one edit applied', results.filter(r => r.ok && r.changed).length, 1);
    check('the loser was told to reload',
      results.filter(r => !r.ok).every(r => r.reason === 'stale' || r.reason === 'conflict'), true);

    const qty = (await itemsOf(id))[0].qty;
    check('the line reads one of the two, not both', [3, 7].includes(qty), true);
    check('the stock matches the line exactly', await stockOf(p.id), 20 - qty);
    check('the totals match the line', await totalsAgree(id, [{ price: 100, qty }]), 'agrees');
    check('one audit row, not two', (await eventsOf(id)).filter(e => e.kind === 'edit').length, 1);
    check('the sequence moved once', (await orderOf(id)).edit_seq, 1);
  }

  console.log('\n  the same thing with nothing to hold on to');
  {
    /*
     * The same two saves, with no sequence carried from a form — so the only
     * thing standing between them is the compare-and-swap in the write.
     *
     * What is asserted here is the invariant and NOT the outcome, and the
     * difference matters. Two saves that genuinely overlap must leave exactly
     * one of them applied. Two that do not overlap - the second read happening
     * after the first committed - are two ordinary sequential edits, and both
     * applying is correct: the second computed its basket from what the first
     * left behind. Whichever happened, the shelf has to match the line, the
     * money has to match the lines, and there has to be exactly one audit row
     * and one sequence step per edit that landed. A lost update fails all four
     * at once, because the stock would have moved twice for a line that only
     * shows the last write.
     *
     * The connections are warmed first. Without that the second request pays
     * for a TLS handshake while the first is already three round trips in, and
     * the two never overlap at all - which is a test that passes because it
     * never ran the case it was written for.
     */
    await Promise.all([raw`SELECT 1`, raw`SELECT 1`, raw`SELECT 1`, raw`SELECT 1`]);

    for (let i = 0; i < 3; i++) {
      const p = await mkProduct(100, 20);
      const id = await mkOrder([{ product: p, qty: 1 }]);
      const [line] = await itemsOf(id);

      const go = qty => editOrder({ orderId: id, actor: `race:${qty}`, lines: [{ id: line.id, qty }] })
        .catch(e => ({ ok: false, threw: String(e?.message || e) }));
      const results = await Promise.all([go(3), go(7)]);
      const applied = results.filter(r => r.ok && r.changed).length;

      const qty = (await itemsOf(id))[0].qty;
      const seq = (await orderOf(id)).edit_seq;
      const events = (await eventsOf(id)).filter(e => e.kind === 'edit').length;

      console.log(`      (run ${i}: ${applied} of 2 applied, line reads ${qty})`);
      check(`run ${i}: the shelf matches the line`, await stockOf(p.id), 20 - qty);
      check(`run ${i}: the money matches the lines`,
        await totalsAgree(id, [{ price: 100, qty }]), 'agrees');
      check(`run ${i}: one audit row per edit that landed`, events, applied);
      check(`run ${i}: one sequence step per edit that landed`, seq, applied);
      check(`run ${i}: a refusal is one this screen can render`,
        results.filter(r => !r.ok).every(r => r.reason === 'stale' || r.reason === 'conflict'), true);
    }
  }

  console.log('\n  two orders reaching for the same last unit');
  {
    // Not the same order, so the compare-and-swap does not come into it: this
    // is the stock guard on its own, which is the one that has to hold when two
    // unrelated customers are on the phone at the same time.
    const p = await mkProduct(100, 12);
    const a = await mkOrder([{ product: p, qty: 5 }]);
    const b = await mkOrder([{ product: p, qty: 5 }]);
    check('two units left', await stockOf(p.id), 2);

    const lineA = (await itemsOf(a))[0];
    const lineB = (await itemsOf(b))[0];
    const go = (id, lineId) => editOrder({ orderId: id, actor: 'race', lines: [{ id: lineId, qty: 7 }] })
      .catch(e => ({ ok: false, threw: String(e?.message || e) }));

    const results = await Promise.all([go(a, lineA.id), go(b, lineB.id)]);
    check('exactly one of them got the units', results.filter(r => r.ok).length, 1);
    check('the other was told there is no stock',
      results.find(r => !r.ok)?.reason, 'no-stock');
    check('the shelf is empty and not negative', await stockOf(p.id), 0);
    check('and the two orders add up to what was taken',
      (await itemsOf(a))[0].qty + (await itemsOf(b))[0].qty, 12);
  }

  console.log('\n  two orders reaching for the same last redemption');
  {
    await raw`
      INSERT INTO offers (title_ar, body_ar, code, discount_type, discount_value, max_uses, used_count)
      VALUES ('a', 'b', 'LAST', 'fixed', 30, 4, 3)`;

    const p = await mkProduct(200, 40);
    const a = await mkOrder([{ product: p, qty: 1 }]);
    const b = await mkOrder([{ product: p, qty: 1 }]);

    const go = id => editOrder({ orderId: id, actor: 'race', coupon: 'LAST' })
      .catch(e => ({ ok: false, threw: String(e?.message || e) }));
    const results = await Promise.all([go(a), go(b)]);

    check('exactly one took it', results.filter(r => r.ok).length, 1);
    check('the other was refused', results.find(r => !r.ok)?.reason, 'coupon-spent');
    check('the cap was not passed', await usesOf('LAST'), 4);
    const codes = [(await orderOf(a)).coupon, (await orderOf(b)).coupon].filter(Boolean);
    check('exactly one order carries the code', codes, ['LAST']);
  }

  console.log('\n  cancelling an order that was edited first');
  {
    /*
     * The sequential half of the race below, and the one that has to be
     * deterministic: lib/order-status.js credits the stock back from the lines
     * as they stand at the moment of the cancel, so an edit that ran first has
     * to leave those lines describing exactly what the shelf has paid out. A
     * line that was removed must not be credited twice - once by the edit and
     * once by the cancel - and a line that grew must be credited in full.
     */
    const a = await mkProduct(100, 30);
    const b = await mkProduct(60, 30);
    const id = await mkOrder([{ product: a, qty: 2 }, { product: b, qty: 3 }]);
    check('stock before', [await stockOf(a.id), await stockOf(b.id)], [28, 27]);

    const lines = await itemsOf(id);
    const res = await editOrder({
      orderId: id,
      actor: 'admin:1',
      lines: [{ id: lines[0].id, qty: 4 }, { id: lines[1].id, qty: 0 }],
    });
    check('the edit lands', res.ok, true);
    check('and the shelves show it', [await stockOf(a.id), await stockOf(b.id)], [26, 30]);

    check('the cancel lands', (await transition({ orderId: id, to: 'cancelled', actor: 'admin:1' })).ok, true);
    check('every unit is back, and none of them twice',
      [await stockOf(a.id), await stockOf(b.id)], [30, 30]);
  }

  console.log('\n  an edit and a cancel landing together');
  {
    /*
     * The nastiest of the four, because the two writers are different modules.
     * Either order is legitimate; what must never happen is the stock being
     * counted twice or lost. If the cancel wins, the edit must vanish whole. If
     * the edit wins, the cancel must credit back the EDITED lines, because they
     * are what the shelf actually paid for.
     */
    for (let i = 0; i < 4; i++) {
      const p = await mkProduct(100, 30);
      const id = await mkOrder([{ product: p, qty: 2 }]);
      const [line] = await itemsOf(id);
      check(`run ${i}: stock before`, await stockOf(p.id), 28);

      const edit = editOrder({ orderId: id, actor: 'race', lines: [{ id: line.id, qty: 5 }] })
        .catch(e => ({ ok: false, threw: String(e?.message || e) }));
      const cancel = transition({ orderId: id, to: 'cancelled', actor: 'race' })
        .catch(e => ({ ok: false, threw: String(e?.message || e) }));
      const [e, c] = await Promise.all([edit, cancel]);

      const status = (await orderOf(id)).status;
      const qty = (await itemsOf(id))[0].qty;
      const stock = await stockOf(p.id);

      if (status === 'cancelled') {
        // Cancelled means the restock ran. Whatever the lines say now, the shelf
        // must be back to 30 - it was 30 before the order existed and the order
        // is gone.
        check(`run ${i}: cancelled, and every unit is back`, stock, 30);
        check(`run ${i}: the edit did not half-apply`, e.ok === false || (e.ok && qty === 5), true);
      } else {
        check(`run ${i}: not cancelled, so the edit won`, [e.ok, c.ok], [true, false]);
        check(`run ${i}: the shelf matches the line`, stock, 30 - qty);
      }
    }
  }

} finally {
  // FORCE terminates anything still attached. The HTTP driver holds no
  // persistent connection, so this is belt and braces.
  await admin(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
  console.log(`\n  dropped ${DB}`);
}

console.log(failures ? `\n  ${failures} FAILURE(S)\n` : '\n  all checks passed\n');
process.exit(failures ? 1 : 0);
