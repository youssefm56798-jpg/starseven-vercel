#!/usr/bin/env node
/**
 * NEW STAR SEVEN — put a backup back.
 *
 *   npm run restore -- --dump backups/starseven-2026....ndjson --with-schema
 *   npm run restore -- --dump <file> --url "$SCRATCH_URL" --with-schema
 *   npm run restore -- --dump <file> --truncate --confirm starseven
 *
 * The other half of scripts/backup-db.mjs, and the reason the pair can be
 * trusted: scripts/verify-backup.mjs drives THIS file, not a copy of it, so the
 * restore that runs in the rehearsal is the restore that runs at 2am.
 * docs/RECOVERY.md is the runbook that says when to reach for it.
 *
 * ---------------------------------------------------------------------------
 *  Three things that make a restore quietly wrong, and what is done about each
 *
 *  1. The identity columns. Every id in this schema is
 *     `GENERATED ALWAYS AS IDENTITY`, so a plain INSERT is not merely allowed to
 *     renumber the rows, it is REQUIRED to — and renumbering is catastrophic
 *     here, because order_items, order_events and order_tokens all point at
 *     orders.id. A restore that lets Postgres assign fresh ids produces a
 *     database that is internally consistent and completely wrong: every line
 *     item attached to the wrong order. So every insert carries
 *     OVERRIDING SYSTEM VALUE and the original ids go back verbatim.
 *
 *     Which creates the second half of the same problem. Writing explicit ids
 *     does not move the sequence behind the column, so a database restored this
 *     way looks perfect and then throws a duplicate key error on the very next
 *     order the shop takes — at the till, in front of a customer. Every identity
 *     sequence is therefore reset from max(id) at the end, and the rehearsal
 *     asserts it by taking an order in the restored copy and checking the id it
 *     gets.
 *
 *  2. The schema has moved. The scenario this runbook is written around is a
 *     migration that went wrong, which means the database being restored INTO is
 *     running a schema the dump has never seen. Loading blind either silently
 *     drops a column of the backup or fails on every row. checkColumns() in
 *     scripts/backup-format.mjs compares the two and treats the two directions
 *     differently, because they are different: a column the target has gained is
 *     ordinary and takes its default; a column the target has LOST is data with
 *     nowhere to go, and that stops the restore until somebody says out loud
 *     that the column was meant to go.
 *
 *  3. The dump was truncated. Handled before this file gets involved — the
 *     footer and checksum in scripts/backup-format.mjs mean a dump that was cut
 *     off cannot be half-loaded. It matters here because a half-loaded restore
 *     is the worst outcome available: it looks like it worked.
 *
 * ---------------------------------------------------------------------------
 *  On writing to production
 *
 *  Every other database script in this project protects itself by building a
 *  throwaway database and refusing to touch anything else. This one cannot: on
 *  the night it is needed, production is exactly where it has to write. So the
 *  guard is a different shape — it will not load into a database that already
 *  holds rows unless it is told to empty it first, and emptying it requires the
 *  operator to TYPE the database name. Not a y/n prompt, which the muscle
 *  memory of a long night answers without reading. A name, which has to be
 *  looked up, and which this script prints two lines above the refusal.
 */

import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { applyEnv } from './env-file.mjs';
import { splitStatements } from './sql-split.mjs';
import { DumpReader, TABLE_NAMES, checkColumns } from './backup-format.mjs';
import { columnsOf } from './backup-db.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const NEWLINE = String.fromCharCode(10);

/** Postgres identifier quoting. */
const q = name => '"' + String(name).replace(/"/g, '""') + '"';
/** Postgres string-literal quoting, for the table names handed to setval. */
const lit = s => "'" + String(s).replace(/'/g, "''") + "'";

/** Same feature detection as everywhere else; no read-only guard, this writes. */
export function makeExec(sql) {
  return typeof sql.query === 'function'
    ? (text, params = []) => sql.query(text, params)
    : (text, params = []) => sql(text, params);
}

/**
 * How many rows go into one INSERT.
 *
 * Two ceilings, and the lower one wins. Postgres refuses a statement with more
 * than 65535 bind parameters, so a wide table takes fewer rows per batch than a
 * narrow one — hard-coding a row count would work on orders and fail on
 * products. And the request itself has to stay a sane size, because products
 * carries several columns of long-form prose and a thousand of those in one
 * body is a request large enough for the endpoint to reject outright, which
 * would look like a restore failure rather than a batching mistake.
 */
export function batchLimit(columnCount) {
  return Math.max(1, Math.min(200, Math.floor(60000 / Math.max(1, columnCount))));
}
const MAX_BATCH_BYTES = 1_000_000;

/**
 * Loads one dump into one already-connected database.
 *
 * Streams: the file is read line by line and each batch is sent as it fills, so
 * the memory this holds is one batch and not one backup.
 */
export async function restoreAll({
  exec, lines, only = null, dropUnknownColumns = false, log = () => {},
}) {
  const applied = {};
  let block = null;      // { table, load, indexes, sql, limit }
  let batch = [];
  let batchBytes = 0;
  let skipping = false;
  const warnings = [];

  const flush = async () => {
    if (!block || batch.length === 0) return;
    const params = [];
    const tuples = batch.map(values => {
      const slots = values.map(v => { params.push(v); return '$' + params.length; });
      return '(' + slots.join(',') + ')';
    });
    await exec(block.sql + tuples.join(','), params);
    applied[block.table] = (applied[block.table] ?? 0) + batch.length;
    batch = [];
    batchBytes = 0;
  };

  const reader = new DumpReader({
    onTable: async (table, dumpColumns) => {
      await flush();

      if (only && !only.includes(table)) {
        skipping = true;
        block = null;
        log(`    skip     ${table}`);
        return;
      }
      skipping = false;

      const targetColumns = await columnsOf(exec, table);
      if (targetColumns.length === 0) {
        throw new Error(
          `table "${table}" does not exist here. Apply the schema first ` +
          `(--with-schema, or npm run db:setup).`
        );
      }

      const verdict = checkColumns({ table, dumpColumns, targetColumns });
      if (!verdict.ok && !dropUnknownColumns) throw new Error(verdict.errors.join(NEWLINE));
      if (!verdict.ok) warnings.push(...verdict.errors.map(e => 'ignored by --drop-unknown-columns: ' + e));
      if (verdict.missingInTarget.length) {
        warnings.push(`${table}: dropped column(s) not in this database — ${verdict.missingInTarget.join(', ')}`);
      }
      if (verdict.addedInTarget.length) {
        warnings.push(`${table}: column(s) newer than the dump, left at their default — ${verdict.addedInTarget.join(', ')}`);
      }

      const load = verdict.load;
      const byName = new Map(targetColumns.map(c => [c.name, c]));
      /* OVERRIDING SYSTEM VALUE is rejected outright by a table that has no
         identity column — settings, whose key is its own primary key — so it is
         added where it is needed and nowhere else. */
      const overriding = load.some(c => byName.get(c)?.isIdentity) ? ' OVERRIDING SYSTEM VALUE' : '';

      block = {
        table,
        load,
        indexes: load.map(c => dumpColumns.indexOf(c)),
        sql: `INSERT INTO ${q(table)} (${load.map(q).join(',')})${overriding} VALUES `,
        limit: batchLimit(load.length),
      };
      applied[table] = applied[table] ?? 0;
    },

    onRow: async values => {
      if (skipping || !block) return;
      const row = block.indexes.map(i => values[i]);
      batch.push(row);
      for (const v of row) batchBytes += v === null ? 4 : v.length;
      if (batch.length >= block.limit || batchBytes >= MAX_BATCH_BYTES) await flush();
    },
  });

  for await (const line of lines) await reader.push(line);
  await flush();
  const { manifest, counts } = reader.finish();

  for (const [table, n] of Object.entries(applied)) log(`    ${String(n).padStart(7)}  ${table}`);
  return { manifest, counts, applied, warnings };
}

/**
 * Puts every identity sequence back above the highest id that was just loaded.
 *
 * `false` as the third argument to setval means "this value has not been used
 * yet", so the next row takes max(id)+1 exactly. COALESCE covers a table the
 * restore left empty, where max() is NULL and the sequence has to go back to 1.
 */
export async function resyncSequences(exec, tables, log = () => {}) {
  for (const table of tables) {
    for (const col of await columnsOf(exec, table)) {
      if (!col.isIdentity) continue;
      const [row] = await exec(
        `SELECT setval(pg_get_serial_sequence(${lit(table)}, ${lit(col.name)}),
                       (SELECT COALESCE(max(${q(col.name)}), 0) + 1 FROM ${q(table)}),
                       false) AS next`
      );
      log(`    ${table}.${col.name} -> next id ${row.next}`);
    }
  }
}

/* --------------------------------------------------------------------- cli */

function fail(message, detail) {
  console.error(`${NEWLINE}  ERROR  ${message}`);
  if (detail) console.error(`         ${String(detail).split(NEWLINE).join(NEWLINE + '         ')}`);
  console.error('');
  process.exit(1);
}

const redact = url => String(url).replace(/:[^:@/]+@/, ':****@');

function parseArgs(argv) {
  const out = {
    dump: null, url: null, only: null,
    withSchema: false, truncate: false, confirm: null, dropUnknownColumns: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return { help: true };
    else if (a === '--dump') out.dump = argv[++i];
    else if (a === '--url') out.url = argv[++i];
    else if (a === '--only') out.only = String(argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--with-schema') out.withSchema = true;
    else if (a === '--truncate') out.truncate = true;
    else if (a === '--confirm') out.confirm = argv[++i];
    else if (a === '--drop-unknown-columns') out.dropUnknownColumns = true;
    else return { bad: a };
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`
  Usage: node scripts/restore-db.mjs --dump FILE [options]

    --dump FILE              the .ndjson written by npm run backup. Required.
    --url URL                where to restore. Default: DATABASE_URL.
    --with-schema            apply db/schema.sql first. Use on an empty database.
    --only a,b               restore just these tables.
    --truncate               empty the tables first. Needs --confirm.
    --confirm NAME           the target database name, typed out. Proves intent.
    --drop-unknown-columns   load even though the dump carries columns this
                             database no longer has. They are discarded.

  Tables, in restore order: ${TABLE_NAMES.join(', ')}
`.trim());
    process.exit(0);
  }
  if (args.bad) fail(`Unknown option: ${args.bad}. Try --help.`);
  if (!args.dump) fail('--dump is required.', 'Point it at a file from npm run backup.');
  if (!existsSync(args.dump)) fail(`No such file: ${args.dump}`);

  for (const f of ['.env.local', '.env']) {
    const p = join(ROOT, f);
    if (existsSync(p)) applyEnv(readFileSync(p, 'utf8'));
  }

  const url = args.url || process.env.DATABASE_URL;
  if (!url) fail('No target. Pass --url, or set DATABASE_URL.');

  const { neon } = await import('@neondatabase/serverless');
  const exec = makeExec(neon(url));

  console.log(`${NEWLINE}  New Star Seven — restore`);
  console.log(`  dump:   ${args.dump}`);
  console.log(`  target: ${redact(url)}`);

  let db;
  try {
    [{ db }] = await exec('SELECT current_database() AS db');
  } catch (err) {
    fail('Could not reach the target database.', err.message);
  }
  console.log(`  database: ${db}${NEWLINE}`);

  /* --------------------------------------------------------------- schema */

  if (args.withSchema) {
    console.log('  applying db/schema.sql');
    const statements = splitStatements(readFileSync(join(ROOT, 'db/schema.sql'), 'utf8'));
    for (const stmt of statements) {
      try {
        await exec(stmt);
      } catch (err) {
        fail('A schema statement failed.', `${err.message}${NEWLINE}${NEWLINE}${stmt.slice(0, 200)}`);
      }
    }
    console.log(`    ${statements.length} statement(s) applied${NEWLINE}`);
  }

  /* ---------------------------------------------------- what is in the way */

  const wanted = args.only ?? TABLE_NAMES;
  const present = [];
  for (const t of wanted) {
    if ((await columnsOf(exec, t)).length === 0) continue;
    const [{ n }] = await exec(`SELECT count(*)::int AS n FROM ${q(t)}`);
    if (n > 0) present.push({ table: t, n });
  }

  if (present.length && !args.truncate) {
    fail(
      `"${db}" is not empty. Refusing to load a backup on top of live rows.`,
      present.map(p => `${p.n} row(s) in ${p.table}`).join(NEWLINE) + NEWLINE + NEWLINE +
      `Either restore into an empty database, or empty this one first:` + NEWLINE +
      `  npm run restore -- --dump "${args.dump}" --truncate --confirm ${db}`
    );
  }

  if (args.truncate) {
    if (args.confirm !== db) {
      fail(
        `--truncate needs --confirm ${db}.`,
        `This will delete every row in ${wanted.length} table(s) of "${db}" and replace` + NEWLINE +
        `them with the dump. Type the database name to say you mean this one:` + NEWLINE +
        `  --truncate --confirm ${db}`
      );
    }
    /* No CASCADE, on purpose. CASCADE would silently empty tables that were not
       asked for — a --only orders would take order_items with it — and the point
       of this step is that nothing is emptied by surprise. Without it Postgres
       refuses and names the referencing table it is protecting, which is a
       better error than any this script could write. */
    const list = wanted.filter(t => TABLE_NAMES.includes(t)).map(q).join(', ');
    try {
      await exec(`TRUNCATE ${list} RESTART IDENTITY`);
    } catch (err) {
      fail(
        'TRUNCATE was refused, because a table outside this restore points at one inside it.',
        `${err.message}${NEWLINE}${NEWLINE}Add the table it names to --only, or drop --only to restore everything.`
      );
    }
    console.log(`  emptied ${wanted.length} table(s) in ${db}${NEWLINE}`);
  }

  /* -------------------------------------------------------------- the load */

  const schemaSha = createHash('sha256')
    .update(readFileSync(join(ROOT, 'db/schema.sql')))
    .digest('hex');

  const lines = createInterface({ input: createReadStream(args.dump), crlfDelay: Infinity });

  console.log('  loading');
  let result;
  try {
    result = await restoreAll({
      exec, lines, only: args.only,
      dropUnknownColumns: args.dropUnknownColumns,
      log: s => console.log(s),
    });
  } catch (err) {
    fail('The restore stopped.', err.message);
  }

  if (result.manifest.schemaSha256 && result.manifest.schemaSha256 !== schemaSha) {
    result.warnings.unshift(
      'the dump was taken against a different db/schema.sql than the one in this ' +
      'checkout. That is normal after a bad migration; the column report above is ' +
      'what actually matters.'
    );
  }

  console.log(`${NEWLINE}  resetting identity sequences`);
  await resyncSequences(exec, Object.keys(result.applied), s => console.log(s));

  /* ---------------------------------------------------------- did it land */

  console.log(`${NEWLINE}  counting what is actually there`);
  let mismatched = 0;
  for (const [table, want] of Object.entries(result.applied)) {
    const [{ n }] = await exec(`SELECT count(*)::int AS n FROM ${q(table)}`);
    const ok = n === want;
    if (!ok) mismatched++;
    console.log(`    ${ok ? 'ok  ' : 'FAIL'}  ${table}: ${n} row(s), loaded ${want}`);
  }

  if (result.warnings.length) {
    console.log(`${NEWLINE}  notes`);
    for (const w of result.warnings) console.log(`    - ${w}`);
  }

  console.log(`
  ------------------------------------------------
  ${mismatched ? `${mismatched} TABLE(S) DO NOT MATCH` : 'Restored. Row counts match what was loaded.'}
  Taken ${result.manifest.generatedAt} from database "${result.manifest.database}".
  ------------------------------------------------
`);
  process.exit(mismatched ? 1 : 0);
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) await main();
