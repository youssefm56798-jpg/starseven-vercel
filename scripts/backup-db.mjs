#!/usr/bin/env node
/**
 * NEW STAR SEVEN — take a backup.
 *
 *   npm run backup                      everything, into backups/
 *   npm run backup -- --out D:/safe     somewhere else
 *   npm run backup -- --tables orders,order_items
 *
 * This exists because until it did, nothing did. `vercel-build` runs
 * scripts/setup-db.mjs on every single deploy, which applies db/schema.sql and
 * db/seed.sql straight to production — so one careless statement in a migration
 * has the whole order history inside its blast radius, and there was no copy of
 * that history anywhere. docs/RECOVERY.md is the other half of this: a dump
 * nobody has ever restored is not a backup, and there is a rehearsal script,
 * `npm run verify:backup`, that proves this file and scripts/restore-db.mjs
 * still agree with each other.
 *
 * ---------------------------------------------------------------------------
 *  It only ever reads
 *
 *  Unlike the verify:* scripts, this one is pointed AT production on purpose —
 *  that is the entire job — so it cannot protect itself by building a throwaway
 *  database and working in there. What it does instead is refuse to send
 *  anything that is not a SELECT: every statement goes through readOnly() below
 *  and a statement that does not begin with SELECT throws before it reaches the
 *  driver. That is a cheap guard against the realistic accident, which is not
 *  somebody writing DROP TABLE in a backup script but a future edit adding a
 *  convenient little UPDATE to stamp a "last backed up" column somewhere.
 *
 * ---------------------------------------------------------------------------
 *  pg_dump is not assumed
 *
 *  The textbook answer is `pg_dump`, and the textbook is right when it is
 *  installed. It is not installed here — see the probe in findPgDump() — and it
 *  is not a dependency this project can add, because the machine that has to be
 *  able to take a backup at 2am is whichever machine somebody happens to be
 *  sitting at.
 *
 *  So the driver dump is the primary and is ALWAYS written, never a fallback
 *  that only runs when something is missing. That is deliberate: a script with
 *  two dump paths where one is used in anger and the other is used in the
 *  rehearsal is a script with an untested primary. There is one path, it is the
 *  one restore-db.mjs reads, and it is the one verify-backup.mjs exercises end
 *  to end.
 *
 *  When pg_dump IS on PATH it is run as well, into a companion .sql file. Not as
 *  a duplicate — as the one artifact the driver dump deliberately cannot be. The
 *  NDJSON dump carries data and trusts db/schema.sql in git for the shape; the
 *  pg_dump companion carries the schema as production ACTUALLY has it, drift and
 *  all. On the day those two disagree, the companion is the only record of which
 *  one was true.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyEnv } from './env-file.mjs';
import { DumpWriter, TABLE_NAMES, TABLES, dumpFileName } from './backup-format.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const NEWLINE = String.fromCharCode(10);

/* ------------------------------------------------------------------ shared */

/**
 * The driver is tagged-template-first. 0.10.x takes a plain string call, 1.x
 * moved that to sql.query(). Feature-detected rather than pinned, the same way
 * scripts/setup-db.mjs does it, so a future `npm update` cannot silently break
 * the one script that has to work on the worst day.
 */
export function makeExec(sql) {
  const call = typeof sql.query === 'function'
    ? (text, params) => sql.query(text, params)
    : (text, params) => sql(text, params);
  return (text, params = []) => call(readOnly(text), params);
}

/** Every statement this file sends. See the note at the top. */
function readOnly(text) {
  if (!/^\s*select\b/i.test(text)) {
    throw new Error(`backup-db.mjs may only run SELECT. Refused: ${text.slice(0, 60)}`);
  }
  return text;
}

/** Postgres identifier quoting, for names that came back from the catalogue. */
const q = name => '"' + String(name).replace(/"/g, '""') + '"';

/**
 * The columns a table actually has, in ordinal order.
 *
 * Read from the catalogue rather than parsed out of db/schema.sql, because the
 * question this answers is what production IS, not what the repository believes
 * it should be — and the gap between those two is the reason a backup is being
 * taken in the first place.
 */
export async function columnsOf(exec, table) {
  const rows = await exec(
    `SELECT column_name AS name,
            (is_nullable = 'NO')       AS not_null,
            (column_default IS NOT NULL) AS has_default,
            (is_identity = 'YES')      AS is_identity
       FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1
      ORDER BY ordinal_position`,
    [table]
  );
  return rows.map(r => ({
    name: r.name,
    notNull: r.not_null === true || r.not_null === 't',
    hasDefault: r.has_default === true || r.has_default === 't',
    isIdentity: r.is_identity === true || r.is_identity === 't',
  }));
}

/* -------------------------------------------------------------------- dump */

/**
 * Reads every requested table and hands the caller one line of NDJSON at a
 * time. Knows nothing about files, so verify-backup.mjs can run the real dump
 * code into an array.
 *
 * Paging is keyset, not OFFSET: `WHERE pk > $1 ORDER BY pk LIMIT n`. With OFFSET
 * the server re-walks and discards every row already emitted, so reading page N
 * costs N pages, and a backup of a large orders table spends most of its time
 * re-reading the beginning of it. Keyset paging costs the same for every page.
 *
 * Every column is selected as ::text. The reason is long and lives in
 * scripts/backup-format.mjs; the short version is that the driver turns a DATE
 * into a JavaScript Date at local midnight, and a delivery window that has been
 * through that round trip comes back a day early in Cairo.
 */
export async function dumpAll({
  exec, emit, writer = new DumpWriter(), tables = TABLES, batchSize = 500, log = () => {},
}) {
  const perTable = {};

  for (const { name, pk } of tables) {
    const columns = await columnsOf(exec, name);
    if (columns.length === 0) {
      throw new Error(
        `table "${name}" does not exist in this database. Run npm run db:setup first, ` +
        `or pass --tables to dump only what is there.`
      );
    }

    const names = columns.map(c => c.name);
    await emit(writer.begin(name, names));

    const projection = names.map(c => `${q(c)}::text AS ${q(c)}`).join(', ');
    const first = `SELECT ${projection} FROM ${q(name)} ORDER BY ${q(pk)} LIMIT ${batchSize}`;
    const next = `SELECT ${projection} FROM ${q(name)} WHERE ${q(pk)} > $1 ` +
                 `ORDER BY ${q(pk)} LIMIT ${batchSize}`;

    let cursor = null;
    let count = 0;
    for (;;) {
      const rows = cursor === null ? await exec(first) : await exec(next, [cursor]);
      if (rows.length === 0) break;
      for (const row of rows) {
        await emit(writer.row(names.map(c => (row[c] === undefined ? null : row[c]))));
      }
      count += rows.length;
      cursor = rows[rows.length - 1][pk];
      // A NULL primary key is impossible, but a cursor that went NULL would page
      // forever, so stop rather than loop.
      if (cursor === null || cursor === undefined) break;
      if (rows.length < batchSize) break;
    }

    perTable[name] = count;
    log(`    ${String(count).padStart(7)}  ${name}`);
  }

  await emit(writer.finish());
  return perTable;
}

/* ---------------------------------------------------------------- pg_dump */

/** Is pg_dump on PATH? Probed, never assumed. */
export function findPgDump() {
  const probe = spawnSync('pg_dump', ['--version'], { encoding: 'utf8', shell: false });
  if (probe.error || probe.status !== 0) return null;
  return String(probe.stdout || '').trim();
}

/**
 * The companion .sql, when pg_dump exists.
 *
 * The connection details go through the child's ENVIRONMENT and never through
 * argv. On a shared machine argv is world-readable — `ps` shows it, and so does
 * every process listing a monitoring agent takes — so passing the connection
 * string as an argument would publish the database password to anyone with a
 * shell. PG* variables are how libpq expects to be told anyway.
 */
function runPgDump(connectionString, outPath) {
  const u = new URL(connectionString);
  const env = {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: u.pathname.replace(/^\//, ''),
    PGSSLMODE: u.searchParams.get('sslmode') || 'require',
  };
  const res = spawnSync('pg_dump', ['--no-owner', '--no-privileges', '--file', outPath], {
    env, encoding: 'utf8', shell: false,
  });
  if (res.error) return { ok: false, why: res.error.message };
  if (res.status !== 0) return { ok: false, why: String(res.stderr || '').trim().split(NEWLINE)[0] };
  return { ok: true };
}

/* --------------------------------------------------------------------- cli */

function fail(message, detail) {
  console.error(`${NEWLINE}  ERROR  ${message}`);
  if (detail) console.error(`         ${String(detail).split(NEWLINE).join(NEWLINE + '         ')}`);
  console.error('');
  process.exit(1);
}

/** Hides the password in anything about to be printed. */
const redact = url => String(url).replace(/:[^:@/]+@/, ':****@');

function parseArgs(argv) {
  const out = { out: null, tables: null, batch: 500 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return { help: true };
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--tables') out.tables = String(argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--batch') out.batch = Number(argv[++i]);
    else return { bad: a };
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`
  Usage: node scripts/backup-db.mjs [--out DIR] [--tables a,b] [--batch N]

    --out DIR      where to write. Default backups/ in the project root, which
                   is gitignored. Anywhere off this machine is better.
    --tables a,b   dump only these. Default is all ten:
                   ${TABLE_NAMES.join(', ')}
    --batch N      rows per read. Default 500.

  Reads DATABASE_URL from the environment or .env.local. Only ever SELECTs.
`.trim());
    process.exit(0);
  }
  if (args.bad) fail(`Unknown option: ${args.bad}. Try --help.`);
  if (!Number.isFinite(args.batch) || args.batch < 1) fail('--batch must be a positive number.');

  for (const f of ['.env.local', '.env']) {
    const p = join(ROOT, f);
    if (existsSync(p)) applyEnv(readFileSync(p, 'utf8'));
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    fail('DATABASE_URL is not set.', 'Put it in .env.local (see .env.example), or export it.');
  }

  let tables = TABLES;
  if (args.tables) {
    const unknown = args.tables.filter(t => !TABLE_NAMES.includes(t));
    if (unknown.length) fail(`Not in the backup set: ${unknown.join(', ')}.`, `Known: ${TABLE_NAMES.join(', ')}`);
    tables = TABLES.filter(t => args.tables.includes(t.name));
  }

  /* The default lives inside the repository and is gitignored twice over — by
     the `backups/` line in .gitignore and by backups/.gitignore, which ignores
     everything but itself. Two rules rather than one because a dump of this
     database is customer names, addresses, phone numbers and admin password
     hashes, and a single line somebody edits by accident is all that would
     stand between that and a public commit. */
  const outDir = args.out ? (isAbsolute(args.out) ? args.out : resolve(process.cwd(), args.out))
                          : join(ROOT, 'backups');
  mkdirSync(outDir, { recursive: true });

  const outPath = join(outDir, dumpFileName());

  const { neon } = await import('@neondatabase/serverless');
  const exec = makeExec(neon(url));

  console.log(`${NEWLINE}  New Star Seven — backup`);
  console.log(`  source: ${redact(url)}`);
  console.log(`  target: ${outPath}`);

  let where;
  try {
    [where] = await exec('SELECT current_database() AS db, version() AS v');
  } catch (err) {
    fail('Could not reach the database.', err.message);
  }
  console.log(`  database: ${where.db}`);

  const pg = findPgDump();
  console.log(pg ? `  pg_dump: ${pg} — a companion .sql will be written too`
                 : `  pg_dump: not on PATH. The NDJSON dump below is the backup; it always is.`);
  console.log('');

  const schemaSha = createHash('sha256')
    .update(readFileSync(join(ROOT, 'db/schema.sql')))
    .digest('hex');

  const stream = createWriteStream(outPath, { encoding: 'utf8' });
  /* Backpressure is honoured rather than ignored. write() returning false and
     being ignored is how a large dump turns into a process holding the whole
     file in memory, which is exactly the run — the biggest table, the worst day
     — that must not fall over. */
  const emit = chunk => (stream.write(chunk) ? undefined : new Promise(r => stream.once('drain', r)));

  const writer = new DumpWriter();
  await emit(writer.manifest({
    generatedAt: new Date().toISOString(),
    database: where.db,
    server: String(where.v).split(' ').slice(0, 2).join(' '),
    schemaSha256: schemaSha,
    tables: tables.map(t => t.name),
  }));

  let counts;
  try {
    counts = await dumpAll({ exec, emit, writer, tables, batchSize: args.batch, log: s => console.log(s) });
  } catch (err) {
    stream.destroy();
    fail('The dump failed part way through. The file left behind is incomplete — delete it.', err.message);
  }

  await new Promise((res, rej) => stream.end(err => (err ? rej(err) : res())));

  const bytes = statSync(outPath).size;
  const rows = Object.values(counts).reduce((a, b) => a + b, 0);

  let companion = null;
  if (pg) {
    companion = outPath.replace(/\.ndjson$/, '.pg_dump.sql');
    /* pg_dump wants a real Postgres connection rather than the HTTP endpoint the
       driver uses, and the pooled host refuses some of what it asks for, so it
       gets the direct endpoint when there is one. */
    const res = runPgDump(process.env.DATABASE_URL_UNPOOLED || url, companion);
    if (!res.ok) {
      console.log(`  note: pg_dump companion failed (${res.why}).`);
      console.log('        The NDJSON dump above is unaffected and is the backup.');
      companion = null;
    }
  }

  console.log(`
  ------------------------------------------------
   ${rows} row(s) across ${Object.keys(counts).length} table(s)
   ${(bytes / 1024).toFixed(1)} KiB   ${outPath}${companion ? NEWLINE + '   plus  ' + companion : ''}
  ------------------------------------------------
  This file is customer data. It is gitignored, and it should not stay on this
  machine — copy it somewhere durable and off this laptop.

  Verify it before trusting it:  npm run verify:backup -- --dump "${outPath}"
`);
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) await main();
