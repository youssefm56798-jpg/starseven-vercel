#!/usr/bin/env node
/**
 * NEW STAR SEVEN — proof that the runtime role is actually restricted.
 *
 *   npm run verify:grants
 *
 * A grant matrix that has never been connected through is a guess. This builds
 * the real thing in a throwaway database - schema, a role with an ephemeral
 * password, the grants from db/grants.mjs - then connects AS that role and
 * checks two halves that are equally important:
 *
 *   1. Everything the site does still works. A hardening step that breaks
 *      checkout is worse than no hardening, because it will be reverted in a
 *      hurry and by somebody who is annoyed.
 *   2. The things it must not be able to do actually fail. Granting nothing and
 *      granting everything both pass half of this file; only the real matrix
 *      passes both.
 *
 * The database is created here and dropped in a finally block, and every write
 * happens after current_database() has been asserted - the same guard the other
 * verify scripts use, so running this with the production connection string in
 * the environment cannot touch production.
 *
 * The role password is generated for this run and dies with the database. No
 * credential from .env.local is used for anything but creating the throwaway.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { applyEnv } from './env-file.mjs';
import { splitStatements } from './sql-split.mjs';
import { GRANTS, grantStatements } from '../db/grants.mjs';
import { readGrants } from './apply-grants.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
for (const f of ['.env.local', '.env']) {
  const p = join(ROOT, f);
  if (existsSync(p)) applyEnv(readFileSync(p, 'utf8'));
}

const base = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!base) {
  console.error('\n  ERROR  DATABASE_URL is not set. See .env.example.\n');
  process.exit(1);
}

const DB = `s7_grants_${randomBytes(4).toString('hex')}`;
const ROLE = `s7_app_${randomBytes(3).toString('hex')}`;
const PASS = randomBytes(18).toString('base64url');

const { neon } = await import('@neondatabase/serverless');
const admin = neon(base);

const ownerUrl = new URL(base);
ownerUrl.pathname = `/${DB}`;
const owner = neon(ownerUrl.toString());
const ownerExec = t => owner(t);

const appUrl = new URL(base);
appUrl.pathname = `/${DB}`;
appUrl.username = ROLE;
appUrl.password = PASS;
const app = neon(appUrl.toString());

let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) return console.log(`    ok    ${name}`);
  failures++;
  console.log(`    FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
};

/** Runs fn and reports whether it was refused by the database. */
async function refused(name, fn) {
  try {
    await fn();
    check(name, false, 'it was ALLOWED');
  } catch (err) {
    const denied = /permission denied|must be owner|insufficient privilege/i.test(err.message || '');
    check(name, denied, denied ? '' : `failed for another reason: ${err.message}`);
  }
}

async function allowed(name, fn) {
  try {
    await fn();
    check(name, true);
  } catch (err) {
    check(name, false, err.message);
  }
}

console.log(`\n  New Star Seven — runtime role privileges`);
console.log(`  throwaway database: ${DB}`);
console.log(`  throwaway role:     ${ROLE}\n`);

await admin`SELECT 1`;
await admin(`CREATE DATABASE "${DB}"`);

try {
  const [{ d }] = await owner`SELECT current_database() AS d`;
  if (d !== DB) throw new Error(`guard failed: connected to ${d}, not ${DB}`);
  console.log(`  guard: current_database() = ${d}\n`);

  console.log('  building the database');
  for (const stmt of splitStatements(readFileSync(join(ROOT, 'db/schema.sql'), 'utf8'))) {
    await ownerExec(stmt);
  }
  for (const stmt of splitStatements(readFileSync(join(ROOT, 'db/seed.sql'), 'utf8'))) {
    await ownerExec(stmt);
  }
  await ownerExec(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${PASS}'`);
  for (const stmt of grantStatements(ROLE)) await ownerExec(stmt);
  console.log('    ok    schema, seed, role and grants applied\n');

  /* ------------------------------------------- the catalogue agrees with us */

  console.log('  the database agrees with db/grants.mjs');
  const have = await readGrants(ownerExec, ROLE);
  for (const [table, want] of Object.entries(GRANTS)) {
    const got = (have[table] || []).slice().sort();
    check(`${table}: ${want.join('/')}`, JSON.stringify(got) === JSON.stringify(want.slice().sort()),
      `have ${got.join('/') || '(none)'}`);
  }
  const extra = Object.keys(have).filter(t => !GRANTS[t]);
  check('no table carries a grant the matrix does not list', extra.length === 0, extra.join(', '));

  /* ------------------------------------------------ the site still functions */

  console.log('\n  what the running site does, as the restricted role');
  await allowed('read the catalogue', () => app`SELECT id, sku, price FROM products LIMIT 3`);
  await allowed('read an article', () => app`SELECT slug FROM articles LIMIT 1`);
  await allowed('the rate-limit upsert (INSERT ... ON CONFLICT DO UPDATE)', async () => {
    await app`INSERT INTO rate_limits (bucket, ip, hits, window_start)
              VALUES ('verify', '1.2.3.0/24', 1, now())
              ON CONFLICT (bucket, ip) DO UPDATE SET hits = rate_limits.hits + 1`;
    await app`INSERT INTO rate_limits (bucket, ip, hits, window_start)
              VALUES ('verify', '1.2.3.0/24', 1, now())
              ON CONFLICT (bucket, ip) DO UPDATE SET hits = rate_limits.hits + 1`;
  });
  await allowed('clear a rate-limit bucket (the lockout fix needs DELETE)',
    () => app`DELETE FROM rate_limits WHERE bucket = 'verify'`);
  await allowed('place an order', async () => {
    const [o] = await app`INSERT INTO orders (ref, name, phone, email, address, city, subtotal, shipping, total, status)
                          VALUES ('V0001', 'V', '01000000000', 'v@example.invalid', 'a', 'Cairo', 100, 0, 100, 'new')
                          RETURNING id`;
    await app`INSERT INTO order_items (order_id, sku, name, price, qty)
              VALUES (${o.id}, 'X', 'X', 100, 1)`;
    await app`INSERT INTO order_events (order_id, kind, actor, note) VALUES (${o.id}, 'note', 'v', 'n')`;
    await app`UPDATE orders SET status = 'confirmed' WHERE id = ${o.id}`;
  });
  await allowed('sign an admin in (read the admins table)', () => app`SELECT id FROM admins LIMIT 1`);
  await allowed('edit a product', () => app`UPDATE products SET stock = stock WHERE id = (SELECT id FROM products LIMIT 1)`);

  /* --------------------------------------------------- and what it cannot do */

  console.log('\n  what it must not be able to do');
  await refused('DROP a table', () => app`DROP TABLE order_events`);
  await refused('TRUNCATE the orders table', () => app`TRUNCATE orders`);
  await refused('ALTER a table', () => app`ALTER TABLE orders ADD COLUMN x int`);
  await refused('CREATE a table', () => app`CREATE TABLE evil (id int)`);
  await refused('DELETE an order (history is not the app to erase)', () => app`DELETE FROM orders`);
  await refused('DELETE from the audit trail', () => app`DELETE FROM order_events`);
  await refused('DELETE a used access token', () => app`DELETE FROM order_tokens`);
  await refused('DELETE from the mail log', () => app`DELETE FROM email_log`);
  await refused('rewrite an article', () => app`UPDATE articles SET title = 'x'`);
  await refused('write a setting nothing writes yet', () => app`UPDATE settings SET value = 'x'`);
  // A raw string, not a tagged template: a role name is an identifier and
  // cannot be a bound parameter, which is exactly why the tagged form is safe
  // everywhere else in this codebase.
  const appExec = typeof app.query === 'function' ? t => app.query(t) : t => app(t);
  /*
   * Self-escalation, checked by RESULT rather than by whether it threw.
   *
   * Postgres answers a GRANT you have no right to make with a WARNING and no
   * error - the statement "succeeds" and grants nothing. Asserting that it
   * raised would have quietly passed for the wrong reason, so this reads the
   * privileges back afterwards and requires them to be unchanged.
   */
  try { await appExec(`GRANT ALL ON orders TO ${ROLE}`); } catch { /* warning or refusal, both fine */ }
  const afterSelfGrant = await readGrants(ownerExec, ROLE);
  check(
    'granting itself more changes nothing (orders stays SELECT/INSERT/UPDATE)',
    JSON.stringify((afterSelfGrant.orders || []).slice().sort()) ===
      JSON.stringify(GRANTS.orders.slice().sort()),
    `orders now: ${(afterSelfGrant.orders || []).join('/') || '(none)'}`,
  );
  await refused('read password hashes out of the catalogue',
    () => appExec(`SELECT rolpassword FROM pg_authid LIMIT 1`));

  console.log('');
} catch (err) {
  failures++;
  console.error(`\n  ERROR  ${err.message}\n`);
} finally {
  try {
    await admin(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    await admin(`DROP ROLE IF EXISTS ${ROLE}`);
    console.log(`  dropped ${DB} and ${ROLE}\n`);
  } catch (err) {
    console.error(`  WARNING  could not clean up: ${err.message}`);
  }
}

console.log(failures ? `  ${failures} check(s) failed\n` : '  all checks passed\n');
process.exit(failures ? 1 : 0);
