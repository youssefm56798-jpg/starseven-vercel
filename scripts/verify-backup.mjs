#!/usr/bin/env node
/**
 * NEW STAR SEVEN — backup and restore, against a real Postgres.
 *
 *   npm run verify:backup                          the full round trip
 *   npm run verify:backup -- --dump backups/x.ndjson   rehearse a REAL dump
 *
 * A backup nobody has restored is not a backup, it is a file. This is the
 * script that turns one into the other, and it is the reason scripts/backup-db.mjs
 * and scripts/restore-db.mjs can be believed: it runs THEM, not a reimplementation
 * of them, so the code proven here is the code that runs at 2am.
 *
 * Default mode builds two throwaway databases. The first gets db/schema.sql and
 * a set of fixtures chosen to be hostile — Arabic prose, apostrophes, embedded
 * newlines, NUMERIC that must keep its scale, a BIGINT past the last integer
 * JavaScript can count to, NULL sitting next to the empty string, DATE columns,
 * and a gap in the identity sequence. It is dumped with the real dump code,
 * restored into the second with the real restore code, and then the second is
 * dumped again. The two dumps have to hash to the same value.
 *
 * That last check is the whole point and it is worth stating plainly: the pass
 * condition is not "the restore did not error", and it is not "the row counts
 * match". It is that every value of every column of every row is byte for byte
 * what it was, as Postgres itself prints it. Anything less passes on a database
 * whose delivery dates have all moved a day.
 *
 * Why a real database and not a test: everything under tests/ runs with no
 * database on purpose, and the failures this is hunting are all failures of the
 * round trip through a server — the driver's type coercion, identity columns
 * that will not accept an explicit id, sequences that stay behind after one is
 * forced in. None of them has any behaviour to assert against in memory.
 *
 * It is safe to run against the production connection string, because it does
 * not use it. It creates its own databases, works only in them, and drops them
 * in a finally block. Before the first write it asserts that current_database()
 * is one of the throwaways and that `orders` resolves to nothing — the same
 * guard scripts/verify-order-status.mjs carries, for the same reason: the
 * failure being guarded against is writing to the real orders table.
 *
 * --dump rehearses an actual backup file instead of fixtures. It restores it
 * into one throwaway database, dumps that, and checks the two agree. Nothing is
 * read from production and nothing at all is written to it. This is the mode
 * docs/RECOVERY.md asks for on a schedule, because the dump that matters is the
 * one on disk, not the one this script can make for itself.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEnv } from './env-file.mjs';
import { splitStatements } from './sql-split.mjs';
import { TABLE_NAMES } from './backup-format.mjs';
import { dumpAll, makeExec as makeReadExec } from './backup-db.mjs';
import { makeExec as makeWriteExec, restoreAll, resyncSequences } from './restore-db.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const NEWLINE = String.fromCharCode(10);

for (const f of ['.env.local', '.env']) {
  const p = join(ROOT, f);
  if (existsSync(p)) applyEnv(readFileSync(p, 'utf8'));
}

/* CREATE DATABASE is refused through a connection pooler, so this wants the
   direct endpoint. Neon supplies both. */
const base = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!base) {
  console.error(`${NEWLINE}  ERROR  DATABASE_URL is not set. See .env.example.${NEWLINE}`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const dumpArg = argv.includes('--dump') ? argv[argv.indexOf('--dump') + 1] : null;
if (dumpArg && !existsSync(dumpArg)) {
  console.error(`${NEWLINE}  ERROR  No such file: ${dumpArg}${NEWLINE}`);
  process.exit(1);
}

const tag = randomBytes(4).toString('hex');
const SRC = `s7_bkup_src_${tag}`;
const DST = `s7_bkup_dst_${tag}`;

const { neon } = await import('@neondatabase/serverless');

/** Only ever creates and drops the throwaway databases. */
const admin = neon(base);

const urlFor = name => { const u = new URL(base); u.pathname = `/${name}`; return u.toString(); };

let failures = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function check(name, got, want) {
  if (same(got, want)) return console.log(`    ok    ${name}`);
  failures++;
  console.log(`    FAIL  ${name}`);
  console.log(`          got  ${JSON.stringify(got)?.slice(0, 300)}`);
  console.log(`          want ${JSON.stringify(want)?.slice(0, 300)}`);
}

/** Asserts that a call fails, and that it fails for the reason expected. */
async function throwsWith(name, fn, fragment) {
  try {
    await fn();
  } catch (err) {
    const hit = String(err.message).toLowerCase().includes(fragment.toLowerCase());
    return check(`${name} (refused: ${fragment})`, hit, true);
  }
  check(`${name} (refused: ${fragment})`, 'it was allowed', 'a refusal');
}

/** The guard every script in this directory carries before its first write. */
async function guard(db, name) {
  const [{ d }] = await db`SELECT current_database() AS d`;
  if (d !== name) throw new Error(`connected to "${d}", not "${name}". Aborting.`);
  const [{ t }] = await db`SELECT to_regclass('orders')::text AS t`;
  if (t !== null) throw new Error(`"orders" already resolves to ${t}. Aborting.`);
  console.log(`  guard: current_database() = ${d}, and it is empty`);
}

const SCHEMA = splitStatements(readFileSync(join(ROOT, 'db/schema.sql'), 'utf8'));
async function applySchema(exec) {
  for (const stmt of SCHEMA) {
    try { await exec(stmt); } catch (e) {
      throw new Error(`schema statement failed: ${e.message}${NEWLINE}${NEWLINE}${stmt.slice(0, 200)}`);
    }
  }
}

/**
 * Reduces a dump to one digest per table, over the DATA and not over the file.
 *
 * The difference matters, and finding out why is what this function is for.
 * Comparing two dumps line for line also compares the order the columns come
 * back in — and that order is ordinal_position, which is a property of how a
 * table was built rather than of what is in it. A column added by
 * `ALTER TABLE ... ADD COLUMN` lands at the END, so a database that grew a
 * column through a migration reports it in a different position from a database
 * created fresh from the same db/schema.sql with that column already in the
 * CREATE TABLE. Production is in exactly that state: products.featured sits
 * last there and mid-table on a fresh build.
 *
 * That is drift worth knowing about, and it is reported. It is not a restore
 * failure, because the restore matches columns by NAME. So each row is
 * canonicalised to its (column, value) pairs sorted by column name before it is
 * hashed, and what the comparison then asserts is the thing that actually has to
 * be true: every value of every column of every row came back.
 *
 * Digests rather than the rows themselves, so that rehearsing a large dump costs
 * one hash and not two copies of the database in memory.
 */
async function canonicalDigests(lines) {
  const { DumpReader } = await import('./backup-format.mjs');
  const digests = {};
  const columns = {};
  let current = null;

  const reader = new DumpReader({
    onTable: (table, cols) => {
      current = { table, cols, hash: createHash('sha256') };
      digests[table] = current;
      columns[table] = cols;
    },
    onRow: values => {
      const pairs = current.cols
        .map((c, i) => [c, values[i]])
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      current.hash.update(JSON.stringify(pairs) + NEWLINE);
    },
  });
  for (const line of lines) reader.push(line);
  reader.finish();

  return {
    columns,
    digests: Object.fromEntries(Object.entries(digests).map(([t, d]) => [t, d.hash.digest('hex')])),
  };
}

/** The rows of one table, keyed by column name, for reporting a mismatch. */
async function rowsOf(lines, table) {
  const { DumpReader } = await import('./backup-format.mjs');
  const out = [];
  let on = false;
  let cols = [];
  const reader = new DumpReader({
    onTable: (t, c) => { on = t === table; cols = c; },
    onRow: v => { if (on) out.push(Object.fromEntries(cols.map((c, i) => [c, v[i]]))); },
  });
  for (const line of lines) reader.push(line);
  reader.finish();
  return out;
}

/** Collects a dump into an array of lines, using the real dump code. */
async function dumpToLines(exec, extra = {}) {
  const out = [];
  const { DumpWriter } = await import('./backup-format.mjs');
  const writer = new DumpWriter();
  out.push(writer.manifest({ generatedAt: new Date().toISOString(), ...extra }));
  await dumpAll({ exec, emit: chunk => { out.push(chunk); }, writer });
  return out.join('').split(NEWLINE).filter(l => l !== '');
}

console.log(`${NEWLINE}  New Star Seven — backup and restore`);
console.log(`  throwaway database(s): ${dumpArg ? DST : `${SRC}, ${DST}`}`);

await admin`SELECT 1`;
if (!dumpArg) await admin(`CREATE DATABASE "${SRC}"`);
await admin(`CREATE DATABASE "${DST}"`);

try {
  const dst = neon(urlFor(DST));
  const dstWrite = makeWriteExec(dst);
  const dstRead = makeReadExec(dst);

  /* ==================================================================== */
  /*  Mode B — rehearse a real dump file                                  */
  /* ==================================================================== */

  if (dumpArg) {
    await guard(dst, DST);
    console.log(`${NEWLINE}  applying db/schema.sql to ${DST}`);
    await applySchema(dstWrite);

    console.log(`${NEWLINE}  restoring ${dumpArg}`);
    const { createReadStream } = await import('node:fs');
    const { createInterface } = await import('node:readline');
    const lines = createInterface({ input: createReadStream(dumpArg), crlfDelay: Infinity });
    const res = await restoreAll({ exec: dstWrite, lines, log: s => console.log(s) });
    await resyncSequences(dstWrite, Object.keys(res.applied));

    console.log(`${NEWLINE}  the file said what the database now holds`);
    for (const [table, want] of Object.entries(res.counts)) {
      const [{ n }] = await dstWrite(`SELECT count(*)::int AS n FROM "${table}"`);
      check(`${table}: ${want} row(s)`, n, want);
    }

    console.log(`${NEWLINE}  and dumping it again reproduces every value`);
    const again = await canonicalDigests(await dumpToLines(dstRead));
    const original = await canonicalDigests(
      readFileSync(dumpArg, 'utf8').split(/\r?\n/).filter(l => l !== ''));

    const againLines = await dumpToLines(dstRead);
    const originalLines = readFileSync(dumpArg, 'utf8').split(/\r?\n/).filter(l => l !== '');

    for (const table of Object.keys(original.digests)) {
      if (again.digests[table] === original.digests[table]) {
        console.log(`    ok    ${table}: every value came back`);
        continue;
      }
      const want = await rowsOf(originalLines, table);
      const got = await rowsOf(againLines, table);
      const at = want.findIndex((r, i) => JSON.stringify(r) !== JSON.stringify(got[i]));
      check(`${table}: every value came back (row ${at + 1})`, got[at] ?? null, want[at] ?? null);
    }

    /* Column ORDER is not compared, and the difference is reported rather than
       failed. ordinal_position says how a table was built, not what is in it: a
       column that arrived through ALTER TABLE ADD COLUMN sits at the end, so a
       database that has been migrated reports its columns in a different order
       from one created fresh out of the same db/schema.sql. The restore matches
       on the name, so this costs nothing — but it is real drift between
       production and the file in git, and silence about it would be worse than
       a line of output. */
    for (const [table, cols] of Object.entries(original.columns)) {
      const here = again.columns[table] || [];
      const missing = cols.filter(c => !here.includes(c));
      if (missing.length) {
        check(`${table}: db/schema.sql is missing column(s) the dump has`, missing, []);
      } else if (cols.join() !== here.join()) {
        console.log(`    note  ${table}: same columns, different order in the dump than a`);
        console.log(`          fresh db/schema.sql produces — a column added by ALTER TABLE.`);
        console.log(`          Harmless: the restore matches on the column name.`);
      }
    }

  } else {

  /* ==================================================================== */
  /*  Mode A — the full round trip, on fixtures chosen to be hostile      */
  /* ==================================================================== */

    const src = neon(urlFor(SRC));
    const srcWrite = makeWriteExec(src);
    const srcRead = makeReadExec(src);

    await guard(src, SRC);
    await guard(dst, DST);

    console.log(`${NEWLINE}  applying db/schema.sql to both`);
    await applySchema(srcWrite);
    await applySchema(dstWrite);

    /* ----------------------------------------------------------------- */

    console.log(`${NEWLINE}  loading fixtures into ${SRC}`);

    // Deliberately awkward text. Every one of these has broken a hand-rolled
    // dump somewhere: an apostrophe, an embedded newline and tab, a backslash,
    // a percent sign, a double quote, and right-to-left script.
    const NASTY = `O'Brien & Sons — "الشرقية"${NEWLINE}\tline two \\ 100% done`;

    await src`INSERT INTO settings (key, value, updated_by) VALUES
      ('shipping_fee', '30', 'admin:1'),
      ('free_delivery_over', '300', ''),
      ('support_note', ${NASTY}, 'admin:2')`;

    // totp_last_step is BIGINT. This value is larger than the largest integer
    // JavaScript can represent exactly, so anything that let it become a Number
    // on the way through would round it and the check below would catch it.
    await src`INSERT INTO admins (email, pass_hash, name, session_epoch, totp_secret,
                                  totp_last_step, password_changed_at, totp_enrolled_at)
      VALUES ('owner@example.com', '$2a$10$abcdefghijklmnopqrstuv', 'Owner',
              7, 'enc:v1:zzzz', 9007199254740993,
              '2026-08-27 14:03:22.123456+02', '2026-08-01 09:00:00+02'),
             ('second@example.com', '$2a$10$zyxwvutsrqponmlkjihgfe', ${NASTY},
              0, '', 0, NULL, NULL)`;

    await src`INSERT INTO admin_recovery_codes (admin_id, code_hash, used_at) VALUES
      (1, 'aaaa1111', NULL),
      (1, 'bbbb2222', '2026-08-20 11:00:00+02'),
      (2, 'cccc3333', NULL)`;

    await src`INSERT INTO products (sku, slug, kind, name_ar, name_en, price, compare_at,
                                    image, size_ml, hold_level, hair_types, stock, active,
                                    featured, sort, long_ar, ingredients)
      VALUES ('S7-WAX-RED', 'premium-wax-red', 'wax', 'شمع أحمر', 'Red Wax',
              45.50, 60.00, '/img/red.png', 120, 4, 'straight,wavy', 37, TRUE, TRUE, 1,
              ${NASTY}, 'Aqua, Cera Alba'),
             ('S7-GEL-GRN', 'styling-gel-green', 'gel', 'جل أخضر', 'Green Gel',
              0.05, NULL, '/img/green.png', NULL, 5, '', 0, FALSE, FALSE, 0, '', '')`;

    // body_en is the one nullable TEXT column in this schema that sits beside
    // columns defaulting to the empty string. One row NULL and one row '' is
    // how a dump that confuses the two gets caught.
    await src`INSERT INTO offers (title_ar, title_en, body_ar, body_en, code,
                                  discount_type, discount_value, min_total,
                                  starts_at, ends_at, active, max_uses, used_count)
      VALUES ('خصم', 'Ten off', 'اشترِ الآن', NULL, 'STAR10', 'percent', 10, 0,
              NULL, NULL, TRUE, NULL, 0),
             ('عرض', '', ${NASTY}, '', 'CAP5', 'fixed', 5.25, 100,
              '2026-08-01 00:00:00+02', '2026-09-30 23:59:59+02', TRUE, 5, 3)`;

    await src`INSERT INTO subscribers (email, name, phone, lang, hair_type, status,
                                       token, ip, confirmed_at)
      VALUES ('a@example.com', 'يوسف', '01028282216', 'ar', 'wavy', 'active',
              'tok-a', '41.33.0.7', '2026-08-10 08:00:00+02'),
             ('b@example.com', ${NASTY}, '', 'en', '', 'pending', 'tok-b', '', NULL)`;

    /* expected_from and expected_to are DATE, and they are the single most
       likely thing in this schema to come back wrong. The driver parses a DATE
       into a JavaScript Date at LOCAL midnight; serialise that as an instant and
       Cairo turns 2026-09-03 into 2026-09-02T21:00:00Z, and the restored order
       promises delivery a day early. The dump reads every column ::text, which
       is what makes this fixture pass. */
    await src`INSERT INTO orders (ref, name, phone, address, city, notes, lang,
                                  subtotal, shipping, discount, total, coupon, status,
                                  source, ip, email, access_hash, expected_from,
                                  expected_to, courier, tracking_ref, created_at)
      VALUES ('S7-1001', 'يوسف محمد', '01028282216', ${NASTY}, 'القاهرة', ${NASTY},
              'ar', 265.00, 30.00, 0.00, 295.00, '', 'confirmed', 'web', '41.33.0.7',
              'a@example.com', 'hash-1001', '2026-09-03', '2026-09-05', 'Bosta', 'BST-9',
              '2026-08-27 14:03:22.123456+02'),
             ('S7-1002', ${"O'Brien"}, '01110391048', 'Somewhere', 'Aswan', '', 'en',
              90.00, 30.00, 9.05, 110.95, 'CAP5', 'new', 'web', '', 'b@example.com',
              'hash-1002', NULL, NULL, '', '', '2026-08-28 09:00:00+02'),
             ('S7-1003', 'Deleted', '0100', '', '', '', 'ar', 0, 0, 0, 0, '',
              'new', 'web', '', '', '', NULL, NULL, '', '', now()),
             ('S7-1004', 'Cancelled', '0101', '', 'طنطا', '', 'ar', 50, 30, 0, 80, '',
              'cancelled', 'web', '', 'c@example.com', 'hash-1004', NULL, NULL, '', '',
              '2026-08-20 10:00:00+02')`;

    // A hole in the identity sequence, so the restore has to preserve ids rather
    // than merely produce the same number of rows in the same order.
    await src`DELETE FROM orders WHERE ref = 'S7-1003'`;

    await src`UPDATE orders SET cancelled_at = '2026-08-21 12:30:00+02',
                                refund_requested_at = '2026-08-21 12:00:00+02',
                                refund_reason = ${NASTY}
               WHERE ref = 'S7-1004'`;

    await src`INSERT INTO order_items (order_id, product_id, sku, name, price, qty) VALUES
      (1, 1, 'S7-WAX-RED', 'شمع أحمر', 45.50, 3),
      (1, 2, 'S7-GEL-GRN', ${NASTY}, 0.05, 1),
      (2, NULL, 'S7-GONE', 'A product since deleted', 90.00, 1),
      (4, 1, 'S7-WAX-RED', 'شمع أحمر', 50.00, 1)`;

    await src`INSERT INTO order_events (order_id, kind, from_status, to_status, actor,
                                        note, created_at) VALUES
      (1, 'status', 'new', 'confirmed', 'admin:1', ${NASTY}, '2026-08-27 14:04:00.000001+02'),
      (1, 'call', '', '', 'admin:1', 'reached, confirmed', '2026-08-27 14:05:00+02'),
      (4, 'status', 'new', 'cancelled', 'customer', '', '2026-08-21 12:30:00+02'),
      (4, 'refund-request', '', '', 'customer', ${NASTY}, '2026-08-21 12:00:00+02')`;

    await src`INSERT INTO order_tokens (order_id, token_hash, purpose, expires_at) VALUES
      (1, 'hash-1001', 'checkout', NULL),
      (1, 'tok-status-1', 'status-mail', NULL),
      (2, 'hash-1002', 'checkout', NULL),
      (4, 'tok-recovery-4', 'recovery', '2026-09-04 00:00:00+02')`;

    /* --------------------------------------------------------- the dump */

    console.log(`${NEWLINE}  dumping ${SRC}`);
    const srcLines = await dumpToLines(srcRead, { database: SRC });
    const footer = JSON.parse(srcLines[srcLines.length - 1]);
    check('the footer counts every table', Object.keys(footer.counts).sort(), [...TABLE_NAMES].sort());
    check('orders: the deleted row is not in the dump', footer.counts.orders, 3);
    check('order_items', footer.counts.order_items, 4);

    /* ------------------------------------------------------ the restore */

    console.log(`${NEWLINE}  restoring into ${DST}`);
    const res = await restoreAll({ exec: dstWrite, lines: srcLines, log: s => console.log(s) });
    await resyncSequences(dstWrite, Object.keys(res.applied), s => console.log(s));

    console.log(`${NEWLINE}  row counts`);
    for (const table of TABLE_NAMES) {
      const [{ n }] = await dstWrite(`SELECT count(*)::int AS n FROM "${table}"`);
      check(`${table}: ${footer.counts[table]}`, n, footer.counts[table]);
    }

    /* ------------------------------------------------- the strongest check */

    console.log(`${NEWLINE}  every value, byte for byte`);
    const dstLines = await dumpToLines(dstRead, { database: DST });
    const srcFooter = JSON.parse(srcLines[srcLines.length - 1]);
    const dstFooter = JSON.parse(dstLines[dstLines.length - 1]);
    check('the two dumps hash the same', dstFooter.sha256, srcFooter.sha256);
    // Compared as well as hashed, so a failure says WHICH row rather than only
    // that some row moved.
    for (let i = 1; i < srcLines.length; i++) {
      if (srcLines[i] !== dstLines[i]) {
        check(`line ${i + 1} differs`, dstLines[i], srcLines[i]);
        break;
      }
    }

    /* --------------------------------------------- the values on their own */

    console.log(`${NEWLINE}  the values that are easiest to get wrong`);
    const one = async text => (await dstWrite(text))[0];

    check('a DATE did not shift a day',
      Object.values(await one(`SELECT expected_from::text AS f, expected_to::text AS t
                                 FROM orders WHERE ref = 'S7-1001'`)),
      ['2026-09-03', '2026-09-05']);

    check('a BIGINT past 2^53 is exact',
      (await one(`SELECT totp_last_step::text AS v FROM admins WHERE email = 'owner@example.com'`)).v,
      '9007199254740993');

    check('NUMERIC keeps its scale',
      Object.values(await one(`SELECT price::text AS a, compare_at::text AS b
                                 FROM products WHERE sku = 'S7-WAX-RED'`)),
      ['45.50', '60.00']);

    check('a small NUMERIC is not rounded',
      (await one(`SELECT price::text AS v FROM products WHERE sku = 'S7-GEL-GRN'`)).v, '0.05');

    check('NULL and the empty string stay different',
      Object.values(await one(`SELECT (SELECT body_en FROM offers WHERE code = 'STAR10') AS a,
                                      (SELECT body_en FROM offers WHERE code = 'CAP5')   AS b`)),
      [null, '']);

    check('a NULL timestamp is still NULL',
      (await one(`SELECT (cancelled_at IS NULL) AS v FROM orders WHERE ref = 'S7-1002'`)).v, true);

    check('timestamp microseconds survive',
      (await one(`SELECT created_at::text AS v FROM orders WHERE ref = 'S7-1001'`)).v.includes('.123456'),
      true);

    check('Arabic, apostrophes and newlines are intact',
      (await one(`SELECT value FROM settings WHERE key = 'support_note'`)).value, NASTY);

    check('a used coupon keeps its used_count',
      (await one(`SELECT used_count, max_uses FROM offers WHERE code = 'CAP5'`)),
      { used_count: 3, max_uses: 5 });

    /* ------------------------------------------------ ids and their sequences */

    console.log(`${NEWLINE}  ids, and the sequences behind them`);

    check('the ids are the original ids, hole and all',
      (await dstWrite(`SELECT id FROM orders ORDER BY id`)).map(r => r.id), [1, 2, 4]);

    check('line items still point at the right orders',
      (await dstWrite(`SELECT order_id, sku FROM order_items ORDER BY id`))
        .map(r => `${r.order_id}:${r.sku}`),
      ['1:S7-WAX-RED', '1:S7-GEL-GRN', '2:S7-GONE', '4:S7-WAX-RED']);

    check('no line item was orphaned',
      (await one(`SELECT count(*)::int AS n FROM order_items i
                   LEFT JOIN orders o ON o.id = i.order_id WHERE o.id IS NULL`)).n, 0);

    // The check the whole restore hinges on. Writing explicit ids does not move
    // the sequence behind an identity column, so a restore that forgets to reset
    // it looks perfect until the shop takes its next order and gets a duplicate
    // key error at the till. The next id must be 5, not 1.
    const [fresh] = await dstWrite(
      `INSERT INTO orders (ref, name, phone) VALUES ('S7-NEXT', 'After restore', '0102')
       RETURNING id`);
    check('the next order gets id 5, not a collision', fresh.id, 5);
    await dstWrite(`DELETE FROM orders WHERE ref = 'S7-NEXT'`);

    const [nextAdmin] = await dstWrite(
      `INSERT INTO admins (email, pass_hash) VALUES ('third@example.com', 'x') RETURNING id`);
    check('and so does the next admin', nextAdmin.id, 3);
    await dstWrite(`DELETE FROM admins WHERE email = 'third@example.com'`);

    /* ------------------------------------------------- refusing a bad dump */

    console.log(`${NEWLINE}  dumps that must be refused`);

    /* Each of these has to be refused for being a bad dump, so each one starts
       from an empty database. Run back to back on a database the previous
       attempt had already half filled, every one of them would abort on a
       duplicate primary key long before the footer was reached — a refusal, and
       a green check, and no evidence whatsoever about the guard under test. The
       partial load the last of them leaves behind is what the section after
       this one needs anyway. */
    const emptyDst = () =>
      dstWrite(`TRUNCATE ${TABLE_NAMES.map(t => `"${t}"`).join(', ')} RESTART IDENTITY`);

    const refuses = async (name, lines, fragment) => {
      await emptyDst();
      await throwsWith(name, () => restoreAll({ exec: dstWrite, lines }), fragment);
    };

    await refuses('a dump cut off before its footer', srcLines.slice(0, -1), 'footer');
    await refuses('a dump cut off mid-table', srcLines.slice(0, srcLines.length - 5), 'footer');

    const tampered = srcLines.slice();
    const rowAt = tampered.findIndex(l => l.startsWith('["1","S7-1001"'));
    check('the first order is in the dump as id 1', rowAt > 0, true);
    tampered[rowAt] = tampered[rowAt].replace('"295.00"', '"29.50"');
    await refuses('a dump whose rows were edited', tampered, 'checksum');

    await refuses('a file that is not a dump at all', ['hello', 'world'], 'valid json');
    await refuses('a JSON file that is not one of ours', ['{"hello":true}'], 'manifest');

    // Leave something behind, so the CLI guard below has live rows to refuse.
    await restoreAll({ exec: dstWrite, lines: srcLines });

    /* --------------------------------------------------- the schema moved */

    console.log(`${NEWLINE}  restoring into a database whose schema has moved`);

    // A column the target has GAINED. Ordinary: it takes its default, and the
    // restore says so rather than failing.
    await dstWrite(`TRUNCATE settings RESTART IDENTITY`);
    await dstWrite(`ALTER TABLE settings ADD COLUMN note TEXT NOT NULL DEFAULT ''`);
    const gained = await restoreAll({ exec: dstWrite, lines: srcLines, only: ['settings'] });
    check('a column added since the dump is filled from its default', gained.applied.settings, 3);
    check('and it is reported', gained.warnings.some(w => w.includes('note')), true);
    check('the rows still landed',
      (await one(`SELECT value FROM settings WHERE key = 'support_note'`)).value, NASTY);

    // A column the target has LOST. Data with nowhere to go, so it stops.
    await dstWrite(`TRUNCATE settings RESTART IDENTITY`);
    await dstWrite(`ALTER TABLE settings DROP COLUMN updated_by`);
    await throwsWith('a column the dump has and this database does not',
      () => restoreAll({ exec: dstWrite, lines: srcLines, only: ['settings'] }), 'updated_by');

    const forced = await restoreAll({
      exec: dstWrite, lines: srcLines, only: ['settings'], dropUnknownColumns: true,
    });
    check('unless it is dropped on purpose', forced.applied.settings, 3);

    // Put the shape back, so the section below is testing the CLI's guard and
    // not the drift this section deliberately introduced.
    await dstWrite(`ALTER TABLE settings DROP COLUMN note`);
    await dstWrite(`ALTER TABLE settings ADD COLUMN updated_by TEXT NOT NULL DEFAULT ''`);

    /* ------------------------------------------- refusing to land on live rows */

    console.log(`${NEWLINE}  refusing to load on top of live rows`);

    // Run through the CLI rather than the library, because the guard being
    // tested is the CLI's. The connection string goes through the child's
    // environment and never through argv, where a process listing would show it.
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const tmp = join(mkdtempSync(join(tmpdir(), 's7-verify-')), 'dump.ndjson');
    writeFileSync(tmp, srcLines.join(NEWLINE) + NEWLINE, 'utf8');

    const run = extra => spawnSync(process.execPath, [
      join(ROOT, 'scripts/restore-db.mjs'), '--dump', tmp, ...extra,
    ], { env: { ...process.env, DATABASE_URL: urlFor(DST) }, encoding: 'utf8' });

    const refused = run([]);
    check('exits non-zero', refused.status !== 0, true);
    check('and says why', /is not empty/.test(refused.stderr), true);
    check('and never prints the password',
      refused.stdout.includes('@') && !/:\/\/[^:]+:[^@*]+@/.test(refused.stdout), true);

    const wrongName = run(['--truncate', '--confirm', 'production']);
    check('a wrong --confirm is refused', wrongName.status !== 0, true);
    check('and names the database it wanted', wrongName.stderr.includes(DST), true);

    const done = run(['--truncate', '--confirm', DST]);
    check('the right --confirm goes through', done.status, 0);
    check('and the rows are back',
      (await one(`SELECT count(*)::int AS n FROM orders`)).n, 3);
  }

} finally {
  // FORCE terminates anything still attached. The HTTP driver holds no
  // persistent connection, so this is belt and braces.
  if (!dumpArg) await admin(`DROP DATABASE IF EXISTS "${SRC}" WITH (FORCE)`);
  await admin(`DROP DATABASE IF EXISTS "${DST}" WITH (FORCE)`);
  console.log(`${NEWLINE}  dropped ${dumpArg ? DST : `${SRC} and ${DST}`}`);
}

console.log(failures ? `${NEWLINE}  ${failures} FAILURE(S)${NEWLINE}` : `${NEWLINE}  all checks passed${NEWLINE}`);
process.exit(failures ? 1 : 0);
