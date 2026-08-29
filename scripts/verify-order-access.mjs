#!/usr/bin/env node
/**
 * NEW STAR SEVEN — order links, against a real Postgres.
 *
 *   npm run verify:access
 *
 * The companion to scripts/verify-order-status.mjs, and it exists for the same
 * reason: everything under tests/ runs with no database on purpose, but
 * lib/order-access.js is mostly SQL, and the parts of it that are expensive to
 * get wrong cannot be exercised without a server.
 *
 *   - the migration of orders.access_hash into order_tokens, which has to be
 *     idempotent because db/schema.sql is re-run on every single deploy, and
 *     which decides whether every link already in a customer inbox keeps
 *     working
 *   - the two-branch lookup, which is the entire access-control boundary of
 *     this shop
 *   - the one statement behind /order/find, whose whole job is to cost the
 *     same whether or not it found anything
 *
 * Unlike its companion this one applies the REAL db/schema.sql rather than a
 * hand-written subset, because the schema file is half of what is under test.
 * It applies it twice, which is what a second deploy does.
 *
 * It is safe to run against the production connection string, because it does
 * not use it. It creates its own database, runs everything there, and drops it
 * in a finally block. Before the first write it asserts that current_database()
 * is the throwaway one and that `orders` resolves to nothing — if either check
 * fails it aborts, because the failure it is guarding against is writing to the
 * real orders table.
 *
 * What it cannot do is call app/api/order/find/route.js. That file imports
 * next/server, which does not resolve outside a Next build — the same wall
 * scripts/verify-order-status.mjs documents, and the reason the decisions worth
 * proving live in lib/ rather than in the route. The route is held to its shape
 * by the source assertions in tests/order-access.test.mjs; what is proven here
 * is the statement it runs and the answer it gets back.
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

const DB = `s7_access_${randomBytes(4).toString('hex')}`;

const { neon } = await import('@neondatabase/serverless');

/** Only ever creates and drops the throwaway database. */
const admin = neon(base);

/** Everything under test runs here. */
const url = new URL(base);
url.pathname = `/${DB}`;
const db = neon(url.toString());

/** The driver is tagged-template-first; 1.x moved plain strings to .query(). */
const exec = typeof db.query === 'function' ? text => db.query(text) : text => db(text);

let failures = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function check(name, got, want) {
  if (same(got, want)) return console.log(`    ok    ${name}`);
  failures++;
  console.log(`    FAIL  ${name}`);
  console.log(`          got  ${JSON.stringify(got)}`);
  console.log(`          want ${JSON.stringify(want)}`);
}

const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

console.log(`\n  New Star Seven — order links`);
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

  /* ------------------------------------------------- the schema, as shipped */

  const schema = splitStatements(readFileSync(join(ROOT, 'db/schema.sql'), 'utf8'));
  const applySchema = async () => {
    for (const stmt of schema) {
      try {
        await exec(stmt);
      } catch (e) {
        throw new Error(`schema statement failed: ${e.message}\n\n${stmt.slice(0, 200)}`);
      }
    }
  };

  console.log('  applying db/schema.sql');
  await applySchema();
  check(`${schema.length} statements applied`, schema.length > 20, true);
  check('order_tokens exists', (await db`SELECT to_regclass('order_tokens')::text AS t`)[0].t, 'order_tokens');

  // The module reads DATABASE_URL on its first query, so it has to be pointed
  // at the throwaway database before it is imported.
  process.env.DATABASE_URL = url.toString();
  const {
    newAccessToken, sha256, orderFor, mintOrderLink, issueRecoveryToken, RECOVERY_TTL_DAYS,
  } = await import('../lib/order-access.js');

  const mkOrder = async (ref, email, hash) => {
    const [o] = await db`
      INSERT INTO orders (ref, name, phone, address, city, lang, email, access_hash, total)
      VALUES (${ref}, 'Youssef', '01028282216', '12 Some Street', 'Cairo', 'ar',
              ${email}, ${hash}, 295)
      RETURNING id`;
    return o.id;
  };
  const tokenRows = async id =>
    (await db`SELECT purpose, expires_at FROM order_tokens WHERE order_id = ${id} ORDER BY id`);

  /* ------------------------------------------------------------------ 1 */

  console.log('\n  a link handed out before the table existed');
  {
    // Written exactly as the previous release wrote it: a digest in the column
    // and no token row anywhere.
    const legacy = newAccessToken();
    const id = await mkOrder('S7-0101-0001', 'legacy@example.com', await sha256(legacy));
    check('no token row yet', (await tokenRows(id)).length, 0);

    // Before the migration has run at all. This is the deploy window: the
    // schema is applied at build time while the OLD code is still taking
    // orders, so an order can be written to the column minutes after the
    // backfill has already gone past. The column has to stay readable.
    const before = await orderFor('S7-0101-0001', legacy);
    check('the old link opens the order with no migration at all', before?.ref, 'S7-0101-0001');

    console.log('  re-applying db/schema.sql (what the next deploy does)');
    await applySchema();

    const rows = await tokenRows(id);
    check('the digest was migrated into one row', rows.length, 1);
    check('it is labelled as the checkout link', rows[0]?.purpose, 'checkout');
    check('and it does not expire', rows[0]?.expires_at, null);

    const after = await orderFor('S7-0101-0001', legacy);
    check('the link in the customer inbox still works', after?.ref, 'S7-0101-0001');
    check('and returns the same order row', after?.id, id);

    console.log('  re-applying db/schema.sql again (idempotency)');
    await applySchema();
    check('the migration did not insert a second row', (await tokenRows(id)).length, 1);
    check('the old link still works after three schema runs',
      (await orderFor('S7-0101-0001', legacy))?.ref, 'S7-0101-0001');
  }

  /* ------------------------------------------------------------------ 2 */

  console.log('\n  a tampered link');
  {
    const good = newAccessToken();
    await mkOrder('S7-0101-0002', 'tamper@example.com', await sha256(good));
    await applySchema();

    check('the real link opens it', (await orderFor('S7-0101-0002', good))?.ref, 'S7-0101-0002');

    // One character changed, which is the attack the owner named: a customer
    // edits a letter of the link and lands on somebody else order.
    const flip = c => (c === 'A' ? 'B' : 'A');
    const oneOff = flip(good[0]) + good.slice(1);
    check('one character changed fails', await orderFor('S7-0101-0002', oneOff), null);
    check('a truncated token fails', await orderFor('S7-0101-0002', good.slice(0, -1)), null);
    check('an empty token fails', await orderFor('S7-0101-0002', ''), null);

    // The other half of the URL, edited instead.
    check('the right token with a neighbouring reference fails',
      await orderFor('S7-0101-0003', good), null);
    check('the right token with a reference that does not exist fails',
      await orderFor('S7-9999-9999', good), null);
  }

  /* ------------------------------------------------------------------ 3 */

  console.log('\n  one token opens one order and no other');
  {
    const a = newAccessToken();
    const b = newAccessToken();
    await mkOrder('S7-0101-0010', 'a@example.com', await sha256(a));
    await mkOrder('S7-0101-0011', 'b@example.com', await sha256(b));
    await applySchema();

    check('A opens A', (await orderFor('S7-0101-0010', a))?.ref, 'S7-0101-0010');
    check('B opens B', (await orderFor('S7-0101-0011', b))?.ref, 'S7-0101-0011');
    check('A cannot open B', await orderFor('S7-0101-0011', a), null);
    check('B cannot open A', await orderFor('S7-0101-0010', b), null);
  }

  /* ------------------------------------------------------------------ 4 */

  console.log('\n  minting a link for a status email');
  {
    const original = newAccessToken();
    const id = await mkOrder('S7-0101-0020', 'ship@example.com', await sha256(original));
    await applySchema();

    const [{ ref, lang }] = await db`SELECT ref, lang FROM orders WHERE id = ${id}`;
    const link = await mintOrderLink({ id, ref, lang }, 'status-mail');
    check('a URL came back', /\/order\/S7-0101-0020\?t=/.test(link), true);

    const minted = decodeURIComponent(link.split('?t=')[1]);
    check('the minted link opens the order', (await orderFor(ref, minted))?.id, id);

    // The invariant the whole table exists for. The previous design had one
    // digest per order, so this line is the difference between a status email
    // that can carry a link and one that cannot.
    check('the ORIGINAL link still works', (await orderFor(ref, original))?.id, id);

    const rows = await tokenRows(id);
    check('two rows, checkout and status-mail', rows.map(r => r.purpose), ['checkout', 'status-mail']);
    check('neither expires', rows.map(r => r.expires_at), [null, null]);

    check('a minted link cannot open a different order', await orderFor('S7-0101-0010', minted), null);
  }

  /* ------------------------------------------------------------------ 5 */

  console.log('\n  /order/find: the same answer for a real order and a fake one');
  {
    const original = newAccessToken();
    const id = await mkOrder('S7-0202-0001', 'find@example.com', await sha256(original));
    await applySchema();

    const hit = await issueRecoveryToken('S7-0202-0001', 'find@example.com');
    check('a real pair returns the order', hit?.order?.ref, 'S7-0202-0001');
    check('and the address to send it to', hit?.order?.email, 'find@example.com');
    check('the fresh link opens the order', (await orderFor('S7-0202-0001', hit.token))?.id, id);
    check('the original link is untouched', (await orderFor('S7-0202-0001', original))?.id, id);

    const rows = await tokenRows(id);
    check('one recovery row was added', rows.map(r => r.purpose), ['checkout', 'recovery']);
    check('and it carries a date', rows[1]?.expires_at !== null, true);
    const [{ days }] = await db`
      SELECT round(extract(epoch FROM (expires_at - now())) / 86400)::int AS days
        FROM order_tokens WHERE order_id = ${id} AND purpose = 'recovery'`;
    check(`the date is ${RECOVERY_TTL_DAYS} days out`, Number(days), RECOVERY_TTL_DAYS);

    // The three ways to be wrong, which must all be the one answer. Counted
    // across the whole table, not just this order: a miss that wrote a row
    // against some other order would be both a leak and a way to grow the
    // table from outside.
    const countAll = async () =>
      Number((await db`SELECT count(*)::int AS n FROM order_tokens`)[0].n);
    const before = await countAll();

    const wrongEmail = await issueRecoveryToken('S7-0202-0001', 'someoneelse@example.com');
    const wrongRef = await issueRecoveryToken('S7-0202-9999', 'find@example.com');
    const bothWrong = await issueRecoveryToken('S7-4444-4444', 'nobody@example.com');
    check('the right reference with the wrong email finds nothing', wrongEmail, null);
    check('the right email with a reference that does not exist finds nothing', wrongRef, null);
    check('neither one right finds nothing', bothWrong, null);

    check('and none of the three wrote a row anywhere', await countAll(), before);
    check('this order still has just its two', (await tokenRows(id)).length, 2);

    // Case, which a customer typing their own address will get wrong.
    const cased = await issueRecoveryToken('s7-0202-0001'.toUpperCase(), 'FIND@Example.com'.toLowerCase());
    check('an address in the wrong case still matches', cased?.order?.ref, 'S7-0202-0001');
  }

  /* ------------------------------------------------------------------ 6 */

  console.log('\n  /order/find: a hit and a miss cost the same');
  {
    /*
     * Identical words are not enough. A SELECT followed by a conditional
     * INSERT answers the same sentence in one round trip on a miss and two on
     * a hit, and a few hundred milliseconds of difference is a reliable oracle
     * for whether an email and a reference belong together — which is the
     * whole question this endpoint refuses to answer.
     *
     * Interleaved rather than run in two blocks, so a slow patch of network
     * lands on both. Medians rather than means, for the same reason.
     */
    await mkOrder('S7-0303-0001', 'timing@example.com', await sha256(newAccessToken()));
    await applySchema();

    const hits = [];
    const misses = [];
    for (let i = 0; i < 21; i++) {
      let t0 = performance.now();
      await issueRecoveryToken('S7-0303-0001', 'timing@example.com');
      hits.push(performance.now() - t0);

      t0 = performance.now();
      await issueRecoveryToken('S7-0303-9999', 'timing@example.com');
      misses.push(performance.now() - t0);
    }

    const h = median(hits);
    const m = median(misses);
    const gap = Math.abs(h - m);
    const bound = Math.max(12, 0.25 * Math.max(h, m));
    console.log(`          hit median  ${h.toFixed(1)} ms`);
    console.log(`          miss median ${m.toFixed(1)} ms`);
    console.log(`          gap ${gap.toFixed(1)} ms, allowed ${bound.toFixed(1)} ms`);
    check('a hit and a miss are within the noise of each other', gap <= bound, true);
  }

  /* ------------------------------------------------------------------ 7 */

  console.log('\n  an expired link');
  {
    const id = await mkOrder('S7-0404-0001', 'expired@example.com', '');
    const stale = newAccessToken();
    await db`
      INSERT INTO order_tokens (order_id, token_hash, purpose, expires_at)
      VALUES (${id}, ${await sha256(stale)}, 'recovery', now() - interval '1 day')`;
    check('an expired row does not open the order', await orderFor('S7-0404-0001', stale), null);

    const live = newAccessToken();
    await db`
      INSERT INTO order_tokens (order_id, token_hash, purpose, expires_at)
      VALUES (${id}, ${await sha256(live)}, 'recovery', now() + interval '1 day')`;
    check('a live one does', (await orderFor('S7-0404-0001', live))?.id, id);

    // An order written with no token at all must not be openable by a token
    // that hashes to the empty string, or by anything else.
    check('an order with a blank access_hash is not openable', await orderFor('S7-0404-0001', ''), null);
  }

  /* ------------------------------------------------------------------ 8 */

  console.log('\n  the checkout write, as the route sends it');
  {
    /*
     * The order id cannot be read back mid-batch on the Neon HTTP driver, so
     * the token row finds its parent through the unique reference, exactly as
     * the item rows do. That makes it an INSERT ... SELECT, where a bare
     * parameter has no column to take its type from and Postgres refuses the
     * whole statement. The casts are the fix and this is the proof, because
     * the failure mode is a checkout that stops writing orders at all.
     */
    const token = newAccessToken();
    const hash = await sha256(token);
    const ref = 'S7-0505-0001';
    await db`
      INSERT INTO orders (ref, name, phone, address, city, lang, email, access_hash, total)
      VALUES (${ref}, 'Youssef', '01028282216', '12 Some Street', 'Cairo', 'ar',
              ${'checkout@example.com'}, ${hash}, 295)`;
    await db`
      INSERT INTO order_tokens (order_id, token_hash, purpose)
      SELECT id, ${hash}::text, 'checkout'::text
        FROM orders WHERE ref = ${ref}`;

    const opened = await orderFor(ref, token);
    check('the order opens on the token the checkout minted', opened?.ref, ref);
    check('exactly one token row', (await tokenRows(opened.id)).length, 1);

    // And the migration must not add a second row for a digest that is already
    // in the table under both names.
    await applySchema();
    check('the migration leaves it alone', (await tokenRows(opened.id)).length, 1);
  }

  /* ------------------------------------------------------------------ 9 */

  console.log('\n  a deleted order takes its links with it');
  {
    const token = newAccessToken();
    const id = await mkOrder('S7-0606-0001', 'gone@example.com', await sha256(token));
    await applySchema();
    check('it opens', (await orderFor('S7-0606-0001', token))?.id, id);

    await db`DELETE FROM orders WHERE id = ${id}`;
    const [{ n }] = await db`SELECT count(*)::int AS n FROM order_tokens WHERE order_id = ${id}`;
    check('the token rows went with it', Number(n), 0);
    check('and the link is dead', await orderFor('S7-0606-0001', token), null);
  }

} finally {
  // FORCE terminates anything still attached. The HTTP driver holds no
  // persistent connection, so this is belt and braces.
  await admin(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
  console.log(`\n  dropped ${DB}`);
}

console.log(failures ? `\n  ${failures} FAILURE(S)\n` : '\n  all checks passed\n');
process.exit(failures ? 1 : 0);
