#!/usr/bin/env node
/**
 * NEW STAR SEVEN — database setup.
 *
 *   npm run db:setup                 schema then seed
 *   npm run db:setup -- --schema-only
 *   npm run db:setup -- --seed-only
 *
 * Safe to run as many times as you like: schema.sql is all
 * CREATE ... IF NOT EXISTS and every seed statement upserts on its natural key.
 *
 * DATABASE_URL comes from the environment, or from .env.local / .env in the
 * project root. The .env parser is hand-rolled on purpose — dotenv is not a
 * dependency of this project and adding one for a single script is not worth it.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitStatements } from './sql-split.mjs';
import { applyEnv } from './env-file.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Reads one .env file if it is there. Values already in process.env win. */
function loadEnvFile(path) {
  return existsSync(path) ? applyEnv(readFileSync(path, 'utf8')) : 0;
}

/* ---------------------------------------------------------------- cli */

const argv = process.argv.slice(2);
const wants = {
  schemaOnly: argv.includes('--schema-only'),
  seedOnly: argv.includes('--seed-only'),
  help: argv.includes('--help') || argv.includes('-h'),
};

if (wants.help) {
  console.log(`
  Usage: node scripts/setup-db.mjs [--schema-only | --seed-only]

    --schema-only   create tables and indexes, do not touch data
    --seed-only     upsert products, the STAR10 offer and the articles
    (no flag)       both, schema first
`.trim());
  process.exit(0);
}

if (wants.schemaOnly && wants.seedOnly) {
  fail('--schema-only and --seed-only are mutually exclusive. Pass neither to run both.');
}

const unknown = argv.filter(a => !['--schema-only', '--seed-only', '--help', '-h'].includes(a));
if (unknown.length) fail(`Unknown option(s): ${unknown.join(', ')}. Try --help.`);

/* ------------------------------------------------------------- helpers */

function fail(message, detail) {
  console.error(`\n  ERROR  ${message}`);
  if (detail) console.error(`         ${String(detail).split('\n').join('\n         ')}`);
  console.error('');
  process.exit(1);
}

/** First line of a statement, squashed, for progress output. */
function label(stmt) {
  const meat = stmt
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter(l => !l.trim().startsWith('--'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return meat.length > 68 ? meat.slice(0, 65) + '...' : meat;
}

/**
 * Runs one already-complete statement.
 *
 * The Neon HTTP driver is tagged-template-first. 0.10.x still accepts a plain
 * string call; 1.x replaced that with sql.query(). Feature-detect rather than
 * pin, so a future `npm update` does not silently break setup.
 */
function makeExec(sql) {
  if (typeof sql.query === 'function') return text => sql.query(text);
  return text => sql(text);
}

async function runFile(exec, relPath) {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) fail(`${relPath} is missing.`, `Looked in ${abs}`);

  const statements = splitStatements(readFileSync(abs, 'utf8'));
  console.log(`\n  ${relPath} — ${statements.length} statement(s)`);

  let i = 0;
  for (const stmt of statements) {
    i++;
    try {
      await exec(stmt);
      console.log(`    ok  [${i}/${statements.length}] ${label(stmt)}`);
    } catch (err) {
      fail(`${relPath} statement ${i} failed.`, `${err.message}\n\n${label(stmt)}`);
    }
  }
  return statements.length;
}

/* ---------------------------------------------------------------- main */

const envLoaded =
  loadEnvFile(join(ROOT, '.env.local')) + loadEnvFile(join(ROOT, '.env'));

const url = process.env.DATABASE_URL;
if (!url) {
  fail(
    'DATABASE_URL is not set.',
    'Put it in .env.local (see .env.example), or export it before running.\n' +
    'Vercel fills it in automatically once the Neon integration is connected.'
  );
}

let neon;
try {
  ({ neon } = await import('@neondatabase/serverless'));
} catch (err) {
  fail('Could not load @neondatabase/serverless. Run `npm install` first.', err.message);
}

console.log('\n  New Star Seven — database setup');
console.log(`  target: ${url.replace(/:[^:@/]+@/, ':****@')}`);
if (envLoaded) console.log(`  (${envLoaded} value(s) read from .env.local / .env)`);

const sql = neon(url);
const exec = makeExec(sql);
const started = Date.now();

try {
  await exec('SELECT 1');
} catch (err) {
  fail('Could not reach the database.', err.message);
}

if (!wants.seedOnly) await runFile(exec, 'db/schema.sql');
if (!wants.schemaOnly) await runFile(exec, 'db/seed.sql');

/* -------------------------------------------------------------- summary */

let counts;
try {
  const [row] = await exec(`
    SELECT (SELECT count(*) FROM products) AS products,
           (SELECT count(*) FROM products WHERE active)   AS products_active,
           (SELECT count(*) FROM offers)                  AS offers,
           (SELECT count(*) FROM offers WHERE active)     AS offers_active,
           (SELECT count(*) FROM articles)                AS articles,
           (SELECT count(*) FROM articles
              WHERE status = 'published')                 AS articles_published`);
  counts = row;
} catch (err) {
  fail('Setup ran, but the summary query failed.', err.message);
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`
  ------------------------------------------------
   products   ${counts.products}   (${counts.products_active} active)
   offers     ${counts.offers}   (${counts.offers_active} active)
   articles   ${counts.articles}   (${counts.articles_published} published)
  ------------------------------------------------
  Done in ${secs}s. Re-running this script is safe.
`);
