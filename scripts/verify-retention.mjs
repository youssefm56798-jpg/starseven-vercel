#!/usr/bin/env node
/**
 * NEW STAR SEVEN — proof that the retention sweep does what the policy says.
 *
 *   npm run verify:retention
 *
 * The privacy policy publishes a number of days for each thing the shop keeps.
 * lib/retention.js is what makes those numbers true, and it is unattended: it
 * runs at five in the morning, its steps swallow their own errors so one bad
 * statement cannot stop the rest, and a step that never worked would therefore
 * look exactly like a step with nothing to do. Silence is the failure mode.
 *
 * So the SQL is exercised for real, against a throwaway database, through the
 * RESTRICTED ROLE rather than the owner — which checks the second half of the
 * design at the same time. The sweep is built to redact rather than delete
 * precisely so that it does not need DELETE on the audit tables; running it as
 * a role that HAS no DELETE there is what proves that claim rather than
 * asserting it.
 *
 * Three things are checked for every step:
 *
 *   1. What is past its window is redacted.
 *   2. What is inside its window is untouched — a sweep that emptied the whole
 *      table would pass a test that only looked at the old rows.
 *   3. The row is still there. Nothing here may delete history.
 *
 * The database is created here and dropped in a finally block, and every write
 * happens after current_database() has been asserted — the same guard the other
 * verify scripts use, so running this with the production connection string in
 * the environment cannot touch production.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { applyEnv } from './env-file.mjs';
import { splitStatements } from './sql-split.mjs';
import { grantStatements } from '../db/grants.mjs';
import { prune, DAYS } from '../lib/retention.js';

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

const DB = `s7_retention_${randomBytes(4).toString('hex')}`;
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

/** A timestamp n days ago, as a Postgres literal. */
const daysAgo = n => `now() - interval '${n} days'`;

console.log(`\n  New Star Seven — retention sweep`);
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
  await ownerExec(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${PASS}'`);
  for (const stmt of grantStatements(ROLE)) await ownerExec(stmt);
  console.log('    ok    schema, role and grants applied\n');

  /* ------------------------------------------------------------ the fixtures */

  /*
   * One row per step on each side of its window: `old` is a day past it, `new`
   * is a day inside it. Every value is distinctive so that a redaction can be
   * told apart from a row that was never written.
   */
  console.log('  planting rows either side of each window');

  const order = (ref, days) => ownerExec(`
    INSERT INTO orders (ref, name, phone, address, notes, email, access_hash, ip, total, created_at)
    VALUES ('${ref}', 'Youssef', '01028282216', '5 Nile St', 'ring the bell',
            'y@example.com', 'deadbeef', '198.51.100.7', 295, ${daysAgo(days)})`);

  await order('S7-OLD-IP', DAYS.orderIp + 1);
  await order('S7-NEW-IP', DAYS.orderIp - 1);
  await order('S7-ANCIENT', DAYS.orderIdentity + 1);

  const sub = (email, days) => ownerExec(`
    INSERT INTO subscribers (email, token, ip, created_at)
    VALUES ('${email}', '${'a'.repeat(40)}${email.length}', '198.51.100.8', ${daysAgo(days)})`);
  await sub('old@example.com', DAYS.subscriberIp + 1);
  await sub('new@example.com', DAYS.subscriberIp - 1);

  const quiz = (sku, days) => ownerExec(`
    INSERT INTO quiz_results (hair_type, sku, ip, created_at)
    VALUES ('wavy', '${sku}', '198.51.100.9', ${daysAgo(days)})`);
  await quiz('OLD', DAYS.quizIp + 1);
  await quiz('NEW', DAYS.quizIp - 1);

  const attempt = (key, days) => ownerExec(`
    INSERT INTO order_attempts (idem_key, ref, response, created_at)
    VALUES ('${key}', 'S7-1', '{"ref":"S7-1","phone":"01028282216"}'::json, ${daysAgo(days)})`);
  await attempt('old-key', DAYS.idempotency + 1);
  await attempt('new-key', DAYS.idempotency - 1);

  const logged = (subject, days) => ownerExec(`
    INSERT INTO email_log (to_email, subject, kind, created_at)
    VALUES ('customer@example.com', '${subject}', 'order', ${daysAgo(days)})`);
  await logged('old', DAYS.emailRecipient + 1);
  await logged('new', DAYS.emailRecipient - 1);

  await ownerExec(`INSERT INTO admins (email, pass_hash) VALUES ('a@shop.test', 'x')`);
  const reset = (hash, days) => ownerExec(`
    INSERT INTO admin_password_resets (admin_id, token_hash, expires_at, requested_ip, created_at)
    VALUES ((SELECT id FROM admins LIMIT 1), '${hash}', now(), '198.51.100.10', ${daysAgo(days)})`);
  await reset('old-hash', DAYS.adminResetIp + 1);
  await reset('new-hash', DAYS.adminResetIp - 1);

  const bucket = (name, days) => ownerExec(`
    INSERT INTO rate_limits (bucket, ip, hits, window_start)
    VALUES ('${name}', '198.51.100.11', 1, ${daysAgo(days)})`);
  await bucket('old-bucket', DAYS.rateLimit + 1);
  await bucket('new-bucket', DAYS.rateLimit - 1);

  console.log('    ok    fixtures planted\n');

  /* ----------------------------------------------------------------- the run */

  console.log('  running the sweep as the restricted role');
  const { done, failed } = await prune(app);
  check('every step ran without a permission error', failed.length === 0, failed.join(', '));
  console.log(`    counts: ${JSON.stringify(done)}\n`);

  /* ------------------------------------------------------------ what it did */

  const one = async (q) => (await owner(q))[0];

  console.log('  what is past its window is redacted');
  check('an old order loses its IP',
    (await one(`SELECT ip FROM orders WHERE ref = 'S7-OLD-IP'`)).ip === '');
  check('an old subscriber loses its IP',
    (await one(`SELECT ip FROM subscribers WHERE email = 'old@example.com'`)).ip === '');
  check('an old quiz answer loses its IP',
    (await one(`SELECT ip FROM quiz_results WHERE sku = 'OLD'`)).ip === '');
  check('an old checkout attempt loses its stored reply',
    JSON.stringify((await one(`SELECT response FROM order_attempts WHERE idem_key = 'old-key'`)).response) === '{}');
  check('an old send-log line loses its recipient',
    (await one(`SELECT to_email FROM email_log WHERE subject = 'old'`)).to_email === '');
  check('an old reset row loses its IP',
    (await one(`SELECT requested_ip FROM admin_password_resets WHERE token_hash = 'old-hash'`)).requested_ip === '');
  check('a five-year-old order loses the customer',
    Object.values(await one(`
      SELECT name, phone, address, notes, email, access_hash FROM orders WHERE ref = 'S7-ANCIENT'`))
      .every(v => v === ''));
  check('a closed rate-limit window is gone',
    (await owner(`SELECT 1 FROM rate_limits WHERE bucket = 'old-bucket'`)).length === 0);

  console.log('\n  what is inside its window is untouched');
  check('a recent order keeps its IP',
    (await one(`SELECT ip FROM orders WHERE ref = 'S7-NEW-IP'`)).ip === '198.51.100.7');
  check('a recent subscriber keeps its IP',
    (await one(`SELECT ip FROM subscribers WHERE email = 'new@example.com'`)).ip === '198.51.100.8');
  check('a recent quiz answer keeps its IP',
    (await one(`SELECT ip FROM quiz_results WHERE sku = 'NEW'`)).ip === '198.51.100.9');
  check('a recent checkout attempt keeps its reply',
    JSON.stringify((await one(`SELECT response FROM order_attempts WHERE idem_key = 'new-key'`)).response)
      .includes('01028282216'));
  check('a recent send-log line keeps its recipient',
    (await one(`SELECT to_email FROM email_log WHERE subject = 'new'`)).to_email === 'customer@example.com');
  check('a recent reset row keeps its IP',
    (await one(`SELECT requested_ip FROM admin_password_resets WHERE token_hash = 'new-hash'`)).requested_ip === '198.51.100.10');
  check('an open rate-limit window is still there',
    (await owner(`SELECT 1 FROM rate_limits WHERE bucket = 'new-bucket'`)).length === 1);
  check('an order inside the accounting window keeps the customer',
    (await one(`SELECT name FROM orders WHERE ref = 'S7-OLD-IP'`)).name === 'Youssef');

  console.log('\n  nothing was deleted');
  for (const [table, want] of [['orders', 3], ['quiz_results', 2], ['email_log', 2], ['order_attempts', 2]]) {
    const [{ n }] = await owner(`SELECT count(*)::int AS n FROM ${table}`);
    check(`${table} still holds every row (${want})`, n === want, `found ${n}`);
  }

  /*
   * And the money survived the five-year redaction. The point of redacting
   * rather than deleting is that the books stay complete; an implementation
   * that blanked the total as well would pass every check above.
   */
  const ancient = await one(`SELECT ref, total::float8 AS total FROM orders WHERE ref = 'S7-ANCIENT'`);
  check('the anonymised order keeps its reference and its money',
    ancient.ref === 'S7-ANCIENT' && ancient.total === 295, JSON.stringify(ancient));

  console.log('\n  the sweep is idempotent');
  const second = await prune(app);
  check('a second run changes nothing', Object.values(second.done).every(n => n === 0),
    JSON.stringify(second.done));

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
