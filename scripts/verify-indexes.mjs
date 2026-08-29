#!/usr/bin/env node
/**
 * NEW STAR SEVEN — the indexes, against a real Postgres with real row counts.
 *
 *   npm run verify:indexes
 *
 * Same shape and the same reasoning as scripts/verify-order-status.mjs, which
 * this is modelled on: it creates its own throwaway database, applies the real
 * db/schema.sql to it, works only in there, and drops it in a finally. It is
 * safe to run with the production connection string in the environment because
 * it never issues a statement against the production database - the only two
 * it sends on that connection are CREATE DATABASE and DROP DATABASE, and it
 * asserts current_database() before the first write.
 *
 * Why it exists at all. An index that is added because it looks sensible is a
 * write cost with no proof of a read benefit, and orders is written on every
 * checkout and again on every status move. So every index in the new section of
 * db/schema.sql is measured here against the exact statement it was written
 * for: the plan without it, the plan with it, on a table seeded with enough
 * rows that the planner stops preferring a sequential scan out of sheer
 * indifference. On a table of thirty orders every plan is fast and every
 * measurement is a lie, which is the trap this script exists to avoid.
 *
 * "Before" means the state of the repository as it was, not merely the new
 * index missing: where an index is being replaced, the old one is put back for
 * the before-run, and where a query is being rewritten, the old query text is
 * the one that gets measured. Comparing a new query against no index would
 * flatter the result.
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

/** How many rows to seed. Overridable so a quick run is possible. */
const ORDERS = Number(process.env.VERIFY_ORDERS || 200000);
const SUBS = Number(process.env.VERIFY_SUBS || 100000);
const QUIZ = Number(process.env.VERIFY_QUIZ || 100000);

const DB = `s7_idx_${randomBytes(4).toString('hex')}`;

const { neon } = await import('@neondatabase/serverless');

/** Only ever creates and drops the throwaway database. */
const admin = neon(base);

const url = new URL(base);
url.pathname = `/${DB}`;
const raw = neon(url.toString());

/** Plain-string execution, feature-detected the way setup-db.mjs does it. */
const db = typeof raw.query === 'function' ? text => raw.query(text) : text => raw(text);

let failures = 0;

/** One EXPLAIN plan, flattened to text. */
async function plan(text) {
  const rows = await db(`EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY ON) ${text}`);
  return rows.map(r => r['QUERY PLAN'] ?? Object.values(r)[0]).join('\n');
}

const firstLine = p => p.split('\n')[0].trim();
const readMs = p => Number(/Execution Time: ([\d.]+) ms/.exec(p)?.[1] ?? NaN);

/**
 * How much better an index has to be before it is worth having.
 *
 * Not 1.0x. A change that lands inside the noise is a write cost with nothing
 * bought, and on this schema the write is the checkout. Five times is the line:
 * far enough above measurement noise on a warm cache to be real, and far enough
 * below the two orders of magnitude the two surviving indexes actually deliver
 * that it is not being drawn around the answer.
 */
const WORTH_IT = 5;

/**
 * Measure one query twice: once in the world as it was, once as it is now.
 *
 * `before` and `after` each say what to put in place and what statement to run,
 * so a case where the query text itself changed is expressed honestly rather
 * than by running the new statement against the old schema.
 *
 * `expect` is the point of the script rather than decoration on it. An index
 * marked 'faster' has to clear WORTH_IT or this exits non-zero, which is what
 * stops one of these quietly becoming dead weight after a Postgres upgrade
 * teaches the planner a new trick. An index marked 'no-change' is one that was
 * written, measured, found to buy nothing and deleted; the case stays here so
 * that the reasoning is reproducible and so that the day it stops being true is
 * a test failure rather than a thing nobody notices.
 */
async function compare(name, expect, before, after) {
  for (const stmt of before.setup) await db(stmt);
  await db('ANALYZE');
  const b = await plan(before.query);

  for (const stmt of after.setup) await db(stmt);
  await db('ANALYZE');
  const a = await plan(after.query);

  const bMs = readMs(b);
  const aMs = readMs(a);
  const scanned = /Seq Scan on (orders|subscribers|quiz_results)/.test(b);
  const stillScanning = /Seq Scan on (orders|subscribers|quiz_results)/.test(a);
  const ratio = Number.isFinite(bMs) && Number.isFinite(aMs) && aMs > 0 ? bMs / aMs : NaN;

  console.log(`\n  ${name}`);
  console.log(`    expect  ${expect === 'faster' ? `at least ${WORTH_IT}x` : 'no useful change'}`);
  console.log(`    before  ${firstLine(b)}`);
  console.log(`            ${bMs} ms${scanned ? '   (sequential scan)' : ''}`);
  console.log(`    after   ${firstLine(a)}`);
  console.log(`            ${aMs} ms${stillScanning ? '   (STILL a sequential scan)' : ''}`);
  console.log(`    ratio   ${Number.isFinite(ratio) ? ratio.toFixed(1) + 'x' : '?'}`);

  const ok = expect === 'faster' ? ratio >= WORTH_IT : ratio < WORTH_IT;
  if (!ok) {
    failures++;
    console.log(expect === 'faster'
      ? `    FAIL    below ${WORTH_IT}x - this index is not paying for itself`
      : `    FAIL    ${WORTH_IT}x or better - this index was rejected and should not have been`);
    console.log(b.split('\n').map(l => `      B| ${l}`).join('\n'));
    console.log(a.split('\n').map(l => `      A| ${l}`).join('\n'));
  }
  return { name, before: b, after: a, bMs, aMs };
}

console.log('\n  New Star Seven — index verification');
console.log(`  throwaway database: ${DB}`);
console.log(`  seeding ${ORDERS} orders, ${SUBS} subscribers, ${QUIZ} quiz rows`);

await admin`SELECT 1`;
await admin(`CREATE DATABASE "${DB}"`);

try {
  const [{ d }] = await raw`SELECT current_database() AS d`;
  if (d !== DB) throw new Error(`connected to "${d}", not "${DB}". Aborting.`);
  const [{ t }] = await raw`SELECT to_regclass('orders')::text AS t`;
  if (t !== null) throw new Error(`"orders" already resolves to ${t}. Aborting.`);
  console.log(`  guard: current_database() = ${d}, and it is empty`);

  /* ------------------------------------------------------------ the schema */

  const statements = splitStatements(readFileSync(join(ROOT, 'db/schema.sql'), 'utf8'));
  for (const stmt of statements) await db(stmt);
  console.log(`  applied db/schema.sql (${statements.length} statements)`);

  /* -------------------------------------------------------------- the rows */

  // Server-side generation, in chunks, because the HTTP driver charges a round
  // trip per statement and inserting a row at a time would take all afternoon.
  const CHUNK = 50000;
  for (let from = 1; from <= ORDERS; from += CHUNK) {
    const to = Math.min(from + CHUNK - 1, ORDERS);
    await db(`
      INSERT INTO orders (ref, name, phone, address, city, lang,
                          subtotal, shipping, discount, total, coupon,
                          status, source, ip, email, access_hash, created_at)
      SELECT
        'S7-' || to_char(g, 'FM00000000'),
        (ARRAY['Ahmed','Mohamed','Mahmoud','Youssef','Omar','Khaled','Hassan','Mostafa'])[1 + (g % 8)]
          || ' ' ||
        (ARRAY['Ali','Sayed','Ibrahim','Fathy','Nasr','Zaki','Kamal'])[1 + (g % 7)],
        '01' || to_char(100000000 + (g * 7919) % 899999999, 'FM000000000'),
        'Street ' || (g % 400) || ', block ' || (g % 90),
        (ARRAY['Cairo','Giza','Alexandria','Mansoura','Tanta','Asyut'])[1 + (g % 6)],
        CASE WHEN g % 5 = 0 THEN 'en' ELSE 'ar' END,
        100, 30, 0, 130,
        CASE WHEN g % 11 = 0 THEN 'STAR10' ELSE '' END,
        /*
         * Status correlates with age, because in a real table it does: an order
         * starts new and ends delivered, so the live statuses sit at the top of
         * the id range and the terminal ones fill everything below.
         *
         * A first attempt spread the five statuses evenly with g % 100, and
         * that quietly made every measurement worthless: with a status on one
         * row in five, reading the primary key backwards and discarding the
         * misses finds two hundred matches inside three hundred rows, so no
         * index on status can beat it and none was ever chosen. Real data does
         * not do that. The filter that hurts is a status that is both a small
         * share of the table and absent from the newest rows - cancelled, here,
         * which is what the backward scan has to walk past thousands of rows
         * to reach.
         */
        CASE WHEN ${ORDERS} - g < 400  THEN (ARRAY['new','new','confirmed','shipped'])[1 + (g % 4)]
             WHEN ${ORDERS} - g < 2000 THEN (ARRAY['shipped','delivered','delivered'])[1 + (g % 3)]
             WHEN g % 100 < 93 THEN 'delivered'
             ELSE 'cancelled' END,
        'web', '10.0.0.1',
        'customer' || g || '@example.com',
        md5('token' || g),
        -- Monotonic with id, for the same reason. Two years of history spread
        -- evenly, newest last.
        now() - (${ORDERS} - g) * (730.0 * 86400 / ${ORDERS}) * interval '1 second'
      FROM generate_series(${from}, ${to}) g`);
  }

  await db(`
    INSERT INTO order_items (order_id, product_id, sku, name, price, qty)
    SELECT o.id, 1 + (o.id % 30), 'S7-SKU-' || (o.id % 30),
           'Product ' || (o.id % 30), 100, 1 + (o.id % 3)
      FROM orders o`);

  for (let from = 1; from <= SUBS; from += CHUNK) {
    const to = Math.min(from + CHUNK - 1, SUBS);
    await db(`
      INSERT INTO subscribers (email, name, phone, lang, source, status, token, ip, created_at)
      SELECT 'sub' || g || '@example.com', 'Subscriber ' || g, '010' || g,
             CASE WHEN g % 5 = 0 THEN 'en' ELSE 'ar' END, 'site',
             -- Same reasoning as the orders above: a pending subscriber is one
             -- who signed up recently and has not clicked the link yet, so
             -- pending clusters at the top and the two settled statuses fill
             -- the rest. Spreading them evenly would hide the case that hurts.
             CASE WHEN ${SUBS} - g < 300 THEN 'pending'
                  WHEN g % 10 < 9 THEN 'active' ELSE 'unsubscribed' END,
             md5('sub' || g), '10.0.0.1',
             now() - (${SUBS} - g) * interval '20 minutes'
        FROM generate_series(${from}, ${to}) g`);
  }

  await db(`
    INSERT INTO quiz_results (hair_type, concern, sku, lang, ip, created_at)
    SELECT (ARRAY['straight','wavy','curly','coily','fine','thick'])[1 + (g % 6)],
           'hold', 'S7-WAX-RED', 'ar', '10.0.0.1',
           -- Three years of history, so the ninety-day window is the small
           -- slice of the table it is in a shop that has been running a while.
           now() - (g % 1095) * interval '1 day'
      FROM generate_series(1, ${QUIZ}) g`);

  await db('ANALYZE');

  const [{ n }] = await raw`SELECT count(*)::int AS n FROM orders`;
  console.log(`  seeded: ${n} orders`);

  /* ------------------------------------------------------------- the plans */

  const results = [];

  // What an admin actually types: one customer, off the phone. The first
  // version of this check searched a name that the generator repeats thousands
  // of times, which let the backward primary-key scan fill its two hundred rows
  // almost at once and made the index look pointless. A search that matches one
  // order is the real case, and it is the case every single time somebody rings
  // up about an order.
  const [{ needle }] = await raw`SELECT phone AS needle FROM orders ORDER BY id ASC LIMIT 1`;
  console.log(`\n  search term: ${needle} (one matching order)`);

  /* ------------------------------------------------- the two that were kept */

  results.push(await compare(
    'admin orders, search box  (idx_orders_search, pg_trgm)',
    'faster',
    {
      setup: ['DROP INDEX IF EXISTS idx_orders_search'],
      // The statement as the page wrote it before this change: three ORs.
      query: `SELECT * FROM orders
               WHERE ref ILIKE '%${needle}%' OR name ILIKE '%${needle}%'
                  OR phone ILIKE '%${needle}%'
               ORDER BY id DESC LIMIT 200`,
    },
    {
      setup: [
        `CREATE INDEX IF NOT EXISTS idx_orders_search
           ON orders USING gin ((ref || ' ' || name || ' ' || phone) gin_trgm_ops)`,
      ],
      query: `SELECT * FROM orders
               WHERE (ref || ' ' || name || ' ' || phone) ILIKE '%${needle}%'
               ORDER BY id DESC LIMIT 200`,
    },
  ));

  results.push(await compare(
    'admin orders, status and search together  (idx_orders_search)',
    'faster',
    {
      setup: ['DROP INDEX IF EXISTS idx_orders_search'],
      query: `SELECT * FROM orders
               WHERE status = 'delivered'
                 AND (ref ILIKE '%${needle}%' OR name ILIKE '%${needle}%'
                   OR phone ILIKE '%${needle}%')
               ORDER BY id DESC LIMIT 200`,
    },
    {
      setup: [
        `CREATE INDEX IF NOT EXISTS idx_orders_search
           ON orders USING gin ((ref || ' ' || name || ' ' || phone) gin_trgm_ops)`,
      ],
      query: `SELECT * FROM orders
               WHERE status = 'delivered'
                 AND (ref || ' ' || name || ' ' || phone) ILIKE '%${needle}%'
               ORDER BY id DESC LIMIT 200`,
    },
  ));

  results.push(await compare(
    'dashboard, orders today  (idx_orders_created + a sargable predicate)',
    'faster',
    {
      setup: ['DROP INDEX IF EXISTS idx_orders_created'],
      query: `SELECT COUNT(*) FROM orders
               WHERE (created_at AT TIME ZONE 'Africa/Cairo')::date
                   = (now() AT TIME ZONE 'Africa/Cairo')::date`,
    },
    {
      setup: ['CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at DESC)'],
      query: `WITH bounds AS (
                SELECT date_trunc('day', now() AT TIME ZONE 'Africa/Cairo')
                         AT TIME ZONE 'Africa/Cairo' AS day0)
              SELECT COUNT(*) FROM orders, bounds WHERE orders.created_at >= bounds.day0`,
    },
  ));

  results.push(await compare(
    'dashboard, revenue this month  (idx_orders_created + a sargable predicate)',
    'faster',
    {
      setup: ['DROP INDEX IF EXISTS idx_orders_created'],
      query: `SELECT COALESCE(SUM(total), 0) FROM orders
               WHERE status <> 'cancelled'
                 AND date_trunc('month', created_at AT TIME ZONE 'Africa/Cairo')
                   = date_trunc('month', now() AT TIME ZONE 'Africa/Cairo')`,
    },
    {
      setup: ['CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at DESC)'],
      query: `WITH bounds AS (
                SELECT date_trunc('month', now() AT TIME ZONE 'Africa/Cairo')
                         AT TIME ZONE 'Africa/Cairo' AS mon0)
              SELECT COALESCE(SUM(total), 0) FROM orders, bounds
               WHERE orders.created_at >= bounds.mon0 AND orders.status <> 'cancelled'`,
    },
  ));

  /* ---------------------------------------------- the three that were not */

  /*
   * Everything below was written, measured and then deleted from the schema.
   * The cases stay because a deleted index leaves no trace of the reasoning
   * that deleted it, and the next person to look at these screens will have
   * exactly the same idea. If a Postgres upgrade ever changes one of these
   * answers, this script says so instead of nobody noticing.
   *
   * Each case leaves the database as it found it, so the order they run in does
   * not matter.
   */

  // orders (status, id DESC). The screen asks for 200 rows and the primary key
  // is already in id order, so Postgres reads it backwards and throws away the
  // rows whose status does not match. Two hundred matches turn up long before
  // that walk gets expensive - even for cancelled, which is a small share of the
  // table and absent from the newest rows, which is the shape that should have
  // hurt most.
  for (const s of ['cancelled', 'delivered', 'new']) {
    results.push(await compare(
      `REJECTED  orders (status, id DESC), filtering status = ${s}`,
      'no-change',
      {
        setup: [
          'DROP INDEX IF EXISTS idx_orders_status_id',
          'CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status, created_at DESC)',
        ],
        query: `SELECT * FROM orders WHERE status = '${s}' ORDER BY id DESC LIMIT 200`,
      },
      {
        setup: [
          'DROP INDEX IF EXISTS idx_orders_status',
          'CREATE INDEX IF NOT EXISTS idx_orders_status_id ON orders (status, id DESC)',
        ],
        query: `SELECT * FROM orders WHERE status = '${s}' ORDER BY id DESC LIMIT 200`,
      },
    ));
  }
  await db('CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status, created_at DESC)');
  await db('DROP INDEX IF EXISTS idx_orders_status_id');

  // subscribers (status, id), for the broadcast cursor. Nine subscribers in ten
  // are active, so walking the primary key from the cursor finds a batch
  // immediately and the status has nothing to contribute.
  results.push(await compare(
    'REJECTED  subscribers (status, id), broadcast cursor',
    'no-change',
    {
      setup: [
        'DROP INDEX IF EXISTS idx_subs_status_id',
        'CREATE INDEX IF NOT EXISTS idx_subs_status ON subscribers (status)',
      ],
      query: `SELECT id, email, lang, token FROM subscribers
               WHERE status = 'active' AND id > ${Math.floor(SUBS / 2)}
               ORDER BY id ASC LIMIT 200`,
    },
    {
      setup: [
        'DROP INDEX IF EXISTS idx_subs_status',
        'CREATE INDEX IF NOT EXISTS idx_subs_status_id ON subscribers (status, id)',
      ],
      query: `SELECT id, email, lang, token FROM subscribers
               WHERE status = 'active' AND id > ${Math.floor(SUBS / 2)}
               ORDER BY id ASC LIMIT 200`,
    },
  ));

  // The same index against the other statement it would have served: the
  // subscriber list filtered to a status that is neither the majority nor the
  // newest rows. Still nothing.
  results.push(await compare(
    'REJECTED  subscribers (status, id), filtered list',
    'no-change',
    {
      setup: [
        'DROP INDEX IF EXISTS idx_subs_status_id',
        'CREATE INDEX IF NOT EXISTS idx_subs_status ON subscribers (status)',
      ],
      query: `SELECT * FROM subscribers WHERE status = 'unsubscribed' ORDER BY id DESC LIMIT 500`,
    },
    {
      setup: [
        'DROP INDEX IF EXISTS idx_subs_status',
        'CREATE INDEX IF NOT EXISTS idx_subs_status_id ON subscribers (status, id)',
      ],
      query: `SELECT * FROM subscribers WHERE status = 'unsubscribed' ORDER BY id DESC LIMIT 500`,
    },
  ));
  await db('CREATE INDEX IF NOT EXISTS idx_subs_status ON subscribers (status)');
  await db('DROP INDEX IF EXISTS idx_subs_status_id');

  // quiz_results (created_at, hair_type), replacing (hair_type, created_at
  // DESC). The dashboard filters on created_at and groups by hair_type, so the
  // existing index looks like the wrong way round. Postgres reaches the range
  // through it anyway with a skip scan, and what the query costs is the heap
  // fetch for the count, which neither index avoids.
  results.push(await compare(
    'REJECTED  quiz_results (created_at, hair_type)',
    'no-change',
    {
      setup: [
        'DROP INDEX IF EXISTS idx_quiz_recent',
        'CREATE INDEX IF NOT EXISTS idx_quiz_hair ON quiz_results (hair_type, created_at DESC)',
      ],
      query: `SELECT hair_type, COUNT(*) AS c FROM quiz_results
               WHERE created_at > now() - interval '90 days'
               GROUP BY hair_type ORDER BY c DESC`,
    },
    {
      setup: [
        'DROP INDEX IF EXISTS idx_quiz_hair',
        'CREATE INDEX IF NOT EXISTS idx_quiz_recent ON quiz_results (created_at, hair_type)',
      ],
      query: `SELECT hair_type, COUNT(*) AS c FROM quiz_results
               WHERE created_at > now() - interval '90 days'
               GROUP BY hair_type ORDER BY c DESC`,
    },
  ));
  await db('CREATE INDEX IF NOT EXISTS idx_quiz_hair ON quiz_results (hair_type, created_at DESC)');
  await db('DROP INDEX IF EXISTS idx_quiz_recent');

  /* --------------------------------------------------- the untouched cases */

  // Not every read here needed an index, and the two below are the ones most
  // likely to be added on a hunch. Printed so the report can say what the plan
  // actually is rather than guessing.
  console.log('\n  reads that were left alone');
  for (const [what, q] of [
    ['order timeline (idx_order_events_order already covers it)',
      'SELECT id, kind, from_status, to_status, actor, note, created_at FROM order_events WHERE order_id = 1 ORDER BY id'],
    ['order lookup by access token (idx_orders_access already covers it)',
      `SELECT id, ref FROM orders WHERE access_hash = ${"'" + 'x'.repeat(32) + "'"} LIMIT 1`],
    ['admin orders, unfiltered (the primary key, read backwards)',
      'SELECT * FROM orders ORDER BY id DESC LIMIT 200'],
    ['dashboard quiz breakdown (idx_quiz_hair, kept - see db/schema.sql)',
      `SELECT hair_type, COUNT(*) AS c FROM quiz_results
        WHERE created_at > now() - interval '90 days'
        GROUP BY hair_type ORDER BY c DESC`],
  ]) {
    const p = await plan(q);
    console.log(`    ${what}`);
    console.log(`      ${firstLine(p)}`);
    console.log(`      ${readMs(p)} ms`);
  }

  /* ------------------------------------------------------------- full plans */

  if (process.env.VERIFY_FULL_PLANS) {
    for (const r of results) {
      console.log(`\n  ===== ${r.name} =====`);
      console.log('  --- before ---');
      console.log(r.before.split('\n').map(l => `    ${l}`).join('\n'));
      console.log('  --- after ---');
      console.log(r.after.split('\n').map(l => `    ${l}`).join('\n'));
    }
  }

} finally {
  await admin(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
  console.log(`\n  dropped ${DB}`);
}

console.log(failures ? `\n  ${failures} FAILURE(S)\n` : '\n  every index earned its place\n');
process.exit(failures ? 1 : 0);
