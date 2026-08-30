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
import { applyGrants } from './apply-grants.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const NEWLINE = String.fromCharCode(10);

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

/*
 * A preview build must never migrate the live database.
 *
 * vercel-build runs this script before next build, on EVERY deployment —
 * production, preview and the ones Vercel makes for a pull request. And
 * DATABASE_URL in this project is one value scoped to Production, Preview and
 * Development alike, so all three resolve to the same Neon database. Opening a
 * pull request therefore applied db/schema.sql AND db/seed.sql to the shop that
 * is taking orders, from a branch nobody had reviewed yet.
 *
 * Nothing had gone wrong yet only because the seed is written to be
 * non-destructive. That is a property of the file as it stands today, not a
 * guarantee about the next statement somebody adds to it, and it is the wrong
 * thing to be relying on: a migration is exactly the kind of change a preview
 * exists to test BEFORE it reaches production.
 *
 * So a non-production Vercel build skips the migration and lets next build
 * proceed. The schema it needs is already there, because it is pointed at the
 * same database. This is a stopgap and worth saying so: the real fix is a
 * separate Neon branch with its own DATABASE_URL scoped to Preview, after which
 * this guard becomes belt and braces rather than the only thing standing
 * between a pull request and the live catalogue.
 *
 * VERCEL_ENV is set by the platform and is one of production / preview /
 * development. It is absent locally, where this script is run deliberately by a
 * person, so local use is unaffected. ALLOW_NONPROD_MIGRATE exists for the day
 * a real preview database is wired up and its schema genuinely does need
 * applying.
 */
const vercelEnv = process.env.VERCEL_ENV;
if (vercelEnv && vercelEnv !== 'production' && process.env.ALLOW_NONPROD_MIGRATE !== '1') {
  console.log(`\n  Skipping migration: VERCEL_ENV is "${vercelEnv}", not "production".`);
  console.log('  This deployment shares DATABASE_URL with production, and a preview');
  console.log('  build must not migrate the live database. Set ALLOW_NONPROD_MIGRATE=1');
  console.log('  once a separate preview database exists.\n');
  process.exit(0);
}

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

/*
 * The runtime role's grants, re-applied every time.
 *
 * It has to be every time rather than once, because a table added by a later
 * migration would otherwise be unreachable by the running site until somebody
 * remembered - and "somebody remembers" is what this whole script exists to
 * avoid. Re-applying is cheap and the statements are idempotent.
 *
 * A missing role is not an error. This runs inside the deploy, and the hardening
 * being half-finished must not be able to take a deployment down.
 */
const grants = await applyGrants(exec);
console.log(grants.skipped
  ? `${NEWLINE}  grants — role ${grants.role} does not exist yet, skipped (see docs/DEPLOY.md)`
  : `${NEWLINE}  grants — ${grants.applied} statement(s) applied to ${grants.role}`);

/* -------------------------------------------------------------- summary */

let counts;
let articleList = '';
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
  // The count alone cannot say WHICH rows are there, and a slug migration
  // that silently affects nothing looks identical to one that worked.
  const arts = await exec(`SELECT slug, lang FROM articles ORDER BY slug, lang`);
  articleList = arts.map(a => '   ' + a.slug + '[' + a.lang + ']').join(NEWLINE);
} catch (err) {
  fail('Setup ran, but the summary query failed.', err.message);
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`
  ------------------------------------------------
   products   ${counts.products}   (${counts.products_active} active)
   offers     ${counts.offers}   (${counts.offers_active} active)
   articles   ${counts.articles}   (${counts.articles_published} published)
${articleList}
  ------------------------------------------------
  Done in ${secs}s. Re-running this script is safe.
`);
