#!/usr/bin/env node
/**
 * NEW STAR SEVEN — order state machine, against a real Postgres.
 *
 *   npm run verify:orders
 *
 * Why this is a script and not a test: everything under tests/ runs with no
 * database, on purpose, so `npm test` stays fast and works on a fresh clone.
 * But lib/order-status.js is almost entirely SQL, and the parts of it that are
 * expensive to get wrong — the guard that stops a second cancel crediting stock
 * twice, the CTE that reads the old status, the casts that make the audit
 * INSERT legal — cannot be exercised without a server. Unit tests prove the
 * transition table; this proves the statements.
 *
 * It is safe to run against the production connection string, because it does
 * not use it. It creates its own database, runs everything there, and drops it
 * in a finally block. Before the first write it asserts that current_database()
 * is the throwaway one and that `orders` resolves to nothing — if either check
 * fails it aborts rather than continue, because the failure it is guarding
 * against is writing to the real orders table.
 *
 * An earlier version pinned search_path to a throwaway SCHEMA instead. The Neon
 * HTTP proxy drops the `options` parameter that sets it, so the pin silently did
 * not take and every unqualified name would have resolved to production. The
 * guard caught it. A separate database cannot fail that way: production is not
 * out of the search path, it is not reachable from the connection at all.
 */

import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEnv } from './env-file.mjs';

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

const DB = `s7_verify_${randomBytes(4).toString('hex')}`;

const { neon } = await import('@neondatabase/serverless');

/** Only ever creates and drops the throwaway database. */
const admin = neon(base);

/** Everything under test runs here. */
const url = new URL(base);
url.pathname = `/${DB}`;
const db = neon(url.toString());

let failures = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function check(name, got, want) {
  if (same(got, want)) return console.log(`    ok    ${name}`);
  failures++;
  console.log(`    FAIL  ${name}`);
  console.log(`          got  ${JSON.stringify(got)}`);
  console.log(`          want ${JSON.stringify(want)}`);
}

console.log(`\n  New Star Seven — order state machine`);
console.log(`  throwaway database: ${DB}`);

await admin`SELECT 1`;
await admin(`CREATE DATABASE "${DB}"`);

try {
  /* --------------------------------------------------------------- guards */

  const [{ d }] = await db`SELECT current_database() AS d`;
  if (d !== DB) throw new Error(`connected to "${d}", not "${DB}". Aborting.`);

  const [{ t }] = await db`SELECT to_regclass('orders')::text AS t`;
  if (t !== null) throw new Error(`"orders" already resolves to ${t}. Aborting.`);

  console.log(`  guard: current_database() = ${d}, and it is empty\n`);

  /* ------------------------------------------- the columns the module reads */

  await db(`CREATE TABLE products (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    stock INT NOT NULL DEFAULT 0)`);
  await db(`CREATE TABLE offers (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code TEXT NOT NULL DEFAULT '',
    used_count INT NOT NULL DEFAULT 0)`);
  await db(`CREATE TABLE orders (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'new'
           CHECK (status IN ('new','confirmed','shipped','delivered','cancelled')),
    coupon TEXT NOT NULL DEFAULT '',
    cancelled_at TIMESTAMPTZ)`);
  await db(`CREATE TABLE order_items (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INT,
    qty SMALLINT NOT NULL DEFAULT 1)`);
  await db(`CREATE TABLE order_events (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'status'
         CHECK (kind IN ('status','note','refund-request','mail')),
    from_status TEXT NOT NULL DEFAULT '',
    to_status   TEXT NOT NULL DEFAULT '',
    actor TEXT NOT NULL DEFAULT 'system',
    note  TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);

  // The module reads DATABASE_URL on its first query, so it has to be pointed
  // at the throwaway database before it is imported.
  process.env.DATABASE_URL = url.toString();
  const { transition, logEvent, eventsFor } = await import('../lib/order-status.js');

  const mkOrder = async (status, coupon, qty) => {
    const [p] = await db`INSERT INTO products (stock) VALUES (10) RETURNING id`;
    const [o] = await db`INSERT INTO orders (status, coupon)
                         VALUES (${status}, ${coupon}) RETURNING id`;
    await db`INSERT INTO order_items (order_id, product_id, qty)
             VALUES (${o.id}, ${p.id}, ${qty})`;
    return { orderId: o.id, productId: p.id };
  };
  const statusOf = async id => (await db`SELECT status FROM orders WHERE id = ${id}`)[0]?.status;
  const stockOf = async id => Number((await db`SELECT stock FROM products WHERE id = ${id}`)[0]?.stock);
  const usesOf = async c => Number((await db`SELECT used_count FROM offers WHERE code = ${c}`)[0]?.used_count);

  await db`INSERT INTO offers (code, used_count) VALUES ('SAVE10', 5)`;

  /* ------------------------------------------------------------------ 1 */

  console.log('  a forward move');
  {
    const { orderId } = await mkOrder('new', '', 2);
    const res = await transition({ orderId, to: 'confirmed', actor: 'admin:1', note: 'called them' });
    check('ok, from new, changed', res, { ok: true, from: 'new', to: 'confirmed', changed: true });
    check('status is confirmed', await statusOf(orderId), 'confirmed');
    const ev = await eventsFor(orderId);
    check('one event logged', ev.length, 1);
    check('records the real from-status', [ev[0]?.from_status, ev[0]?.to_status], ['new', 'confirmed']);
    check('records actor and note', [ev[0]?.actor, ev[0]?.note], ['admin:1', 'called them']);
  }

  /* ------------------------------------------------------------------ 2 */

  console.log('\n  saving a status that is already set');
  {
    const { orderId } = await mkOrder('shipped', '', 1);
    const res = await transition({ orderId, to: 'shipped', actor: 'admin:1' });
    check('accepted, reports no change', res, { ok: true, from: 'shipped', to: 'shipped', changed: false });
    check('no audit row for a move that did not happen', (await eventsFor(orderId)).length, 0);
  }

  /* ------------------------------------------------------------------ 3 */

  console.log('\n  cancelling');
  {
    const { orderId, productId } = await mkOrder('confirmed', 'SAVE10', 3);
    check('stock before', await stockOf(productId), 10);
    check('coupon uses before', await usesOf('SAVE10'), 5);

    const res = await transition({ orderId, to: 'cancelled', actor: 'customer' });
    check('ok', res, { ok: true, from: 'confirmed', to: 'cancelled', changed: true });
    check('status is cancelled', await statusOf(orderId), 'cancelled');
    check('stock returned', await stockOf(productId), 13);
    check('coupon use returned', await usesOf('SAVE10'), 4);
    const [row] = await db`SELECT cancelled_at FROM orders WHERE id = ${orderId}`;
    check('cancelled_at stamped', row.cancelled_at !== null, true);

    // The invariant the whole module exists for.
    const again = await transition({ orderId, to: 'cancelled', actor: 'customer' });
    check('second cancel refused', again, { ok: false, reason: 'illegal-transition', from: 'cancelled' });
    check('stock NOT credited twice', await stockOf(productId), 13);
    check('coupon NOT credited twice', await usesOf('SAVE10'), 4);
    check('no second audit row', (await eventsFor(orderId)).length, 1);
  }

  /* ------------------------------------------------------------------ 4 */

  console.log('\n  cancelling an order that used no coupon');
  {
    const { orderId, productId } = await mkOrder('new', '', 4);
    check('ok', (await transition({ orderId, to: 'cancelled' })).ok, true);
    check('stock returned', await stockOf(productId), 14);
    check('an unrelated coupon was left alone', await usesOf('SAVE10'), 4);
  }

  /* ------------------------------------------------------------------ 5 */

  console.log('\n  terminal states');
  {
    const { orderId, productId } = await mkOrder('delivered', 'SAVE10', 2);
    const res = await transition({ orderId, to: 'cancelled', actor: 'admin:1' });
    check('delivered cannot be cancelled', res, { ok: false, reason: 'illegal-transition', from: 'delivered' });
    check('status untouched', await statusOf(orderId), 'delivered');
    check('stock untouched', await stockOf(productId), 10);
    check('coupon untouched', await usesOf('SAVE10'), 4);
    check('nothing logged', (await eventsFor(orderId)).length, 0);
    // The two-hop hole: delivered -> shipped -> cancelled would restock a
    // delivered order, so the first hop has to be refused as well.
    check('delivered cannot walk back to shipped',
      (await transition({ orderId, to: 'shipped' })).reason, 'illegal-transition');
  }

  /* ------------------------------------------------------------------ 6 */

  console.log('\n  an order that is not there');
  check('not-found', await transition({ orderId: 999999, to: 'confirmed' }), { ok: false, reason: 'not-found' });

  /* ------------------------------------------------------------------ 7 */

  console.log('\n  a cancelled order whose product row was deleted');
  {
    const { orderId, productId } = await mkOrder('new', '', 2);
    await db`DELETE FROM products WHERE id = ${productId}`;
    check('still cancels', (await transition({ orderId, to: 'cancelled' })).ok, true);
    check('status is cancelled', await statusOf(orderId), 'cancelled');
  }

  /* ------------------------------------------------------------------ 8 */

  console.log('\n  a non-status event');
  {
    const { orderId } = await mkOrder('new', '', 1);
    check('written', await logEvent({ orderId, kind: 'refund-request', actor: 'customer', note: 'too slow' }), true);
    const ev = await eventsFor(orderId);
    check('same timeline', [ev.length, ev[0]?.kind, ev[0]?.note], [1, 'refund-request', 'too slow']);
  }

  /* ------------------------------------------------------------------ 9 */

  console.log('\n  the timeline reads in order');
  {
    const { orderId } = await mkOrder('new', '', 1);
    await transition({ orderId, to: 'confirmed' });
    await logEvent({ orderId, kind: 'note', note: 'customer rang back' });
    await transition({ orderId, to: 'shipped' });
    check('three events, oldest first',
      (await eventsFor(orderId)).map(e => `${e.kind}:${e.to_status || e.note}`),
      ['status:confirmed', 'note:customer rang back', 'status:shipped']);
  }
} finally {
  // FORCE terminates anything still attached. The HTTP driver holds no
  // persistent connection, so this is belt and braces.
  await admin(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
  console.log(`\n  dropped ${DB}`);
}

console.log(failures ? `\n  ${failures} FAILURE(S)\n` : '\n  all checks passed\n');
process.exit(failures ? 1 : 0);
