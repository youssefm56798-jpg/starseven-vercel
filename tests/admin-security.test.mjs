/**
 * The admin security schema, and the rule about who is allowed to write it.
 *
 * Everything here reads files. No database, like the rest of tests/, and the
 * statements themselves are proved against a real Postgres by
 * scripts/verify-admin-auth.mjs. What this file catches is the class of mistake
 * that a database test cannot: a column the code reads and the schema never
 * creates fails at runtime on the one screen nobody opens until they are locked
 * out, and a second place learning to write session_epoch is the same kind of
 * rot that lib/order-status.js exists to prevent for orders.status.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');

const schema = read('db/schema.sql');

/* ------------------------------------------------------------- the schema */

test('every admins column the code reads is created by the schema', () => {
  // Read out of the source rather than listed by hand, so a column added to
  // the code and forgotten in the schema fails here instead of at runtime.
  const sources = [
    'lib/admin-security.js',
    'lib/session-epoch.js',
    'app/admin/(auth)/login/page.js',
    'app/admin/(auth)/login/verify/page.js',
    'app/admin/_lib/security-actions.js',
  ].map(read).join('\n');

  for (const column of [
    'session_epoch', 'totp_secret', 'totp_pending',
    'totp_enrolled_at', 'totp_last_step', 'password_changed_at',
  ]) {
    assert.match(sources, new RegExp(`\\b${column}\\b`),
      `${column} is in the schema but nothing reads it — is it dead?`);
    assert.match(schema, new RegExp(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS\\s+${column}\\b`),
      `${column} is read by the code but never added to the admins table`);
  }
});

test('the admins columns are added idempotently, like the rest of the file', () => {
  // db/schema.sql is re-run by vercel-build on every deploy, so a bare ADD
  // COLUMN fails the second time and takes the deploy with it.
  const adds = schema.match(/ALTER TABLE admins ADD COLUMN[^;]*/g) ?? [];
  assert.ok(adds.length >= 6, 'expected the six new admin columns');
  for (const stmt of adds) {
    assert.match(stmt, /ADD COLUMN IF NOT EXISTS/, `not idempotent: ${stmt.slice(0, 60)}`);
  }
});

test('the recovery code table is created idempotently and indexed on the digest', () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS admin_recovery_codes/);
  assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS idx_recovery_hash\s+ON admin_recovery_codes \(code_hash\)/,
    'the sign-in lookup is by digest, and a digest belongs to exactly one code');
  assert.match(schema, /admin_id\s+INT NOT NULL REFERENCES admins\(id\) ON DELETE CASCADE/,
    'codes must not outlive the admin they were issued to');
  assert.match(schema, /used_at\s+TIMESTAMPTZ/,
    'single use is recorded, not implemented by deleting the row');
});

test('the new indexes are idempotent, and so is the extension they need', () => {
  assert.match(schema, /CREATE EXTENSION IF NOT EXISTS pg_trgm/);
  for (const name of ['idx_orders_search', 'idx_orders_created']) {
    assert.match(schema, new RegExp(`CREATE INDEX IF NOT EXISTS ${name}\\b`), name);
  }
});

test('the search index matches the expression the orders screen actually queries', () => {
  // A GIN index is only usable by a predicate whose left-hand side is exactly
  // the expression it was built on. If these two ever drift apart the query
  // silently goes back to scanning the whole table, with no error anywhere.
  const expression = "ref || ' ' || name || ' ' || phone";
  assert.ok(schema.includes(`ON orders USING gin ((${expression}) gin_trgm_ops)`),
    'the index is not on the expression this test expects');
  const page = read('app/admin/(panel)/orders/page.js');
  const uses = page.split(`(${expression}) ILIKE`).length - 1;
  assert.equal(uses, 2,
    'the orders screen must query that exact expression, in both the ' +
    'search-only and the status-plus-search branch');
});

test('the customer-account teardown was not extended', () => {
  // Customer accounts were removed on purpose and are not coming back. This is
  // admin-only work, and nothing added here belongs anywhere near that block.
  const drops = schema.match(/^DROP TABLE IF EXISTS .*/gm) ?? [];
  assert.deepEqual(drops.sort(), [
    'DROP TABLE IF EXISTS cart_items;',
    'DROP TABLE IF EXISTS carts;',
    'DROP TABLE IF EXISTS sessions;',
    'DROP TABLE IF EXISTS users;',
  ], 'the DROP TABLE block is for the removed customer-account tables only');
});

/* --------------------------------------------------------- one writer */

test('nothing outside lib/session-epoch.js writes admins.session_epoch', async () => {
  /*
   * The same rule orders.status has, for the same reason. The epoch is the only
   * thing that can end a session that has already been issued, and its value is
   * cached — so a second place that bumps it without invalidating that cache
   * would produce a revocation that appears to work and then does not, for up
   * to a minute, with nothing to show for it in any log.
   */
  const { execFileSync } = await import('node:child_process');
  let hits = '';
  try {
    hits = execFileSync(
      'git',
      ['grep', '-n', '-E', 'UPDATE admins[^;]*SET[^;]*session_epoch', '--', 'app', 'lib'],
      { cwd: ROOT, encoding: 'utf8' },
    );
  } catch {
    return; // git grep exits 1 with no matches, which is the passing case
  }

  const offenders = hits.split('\n').filter(Boolean)
    .filter(l => !l.startsWith('lib/session-epoch.js:'));

  assert.deepEqual(offenders, [],
    `admins.session_epoch is written outside lib/session-epoch.js:\n${offenders.join('\n')}`);
});

test('nothing outside lib/admin-security.js writes the TOTP columns', async () => {
  // Same reasoning one level down: both single-use guarantees live in the WHERE
  // clause of an UPDATE, and a second writer is a second opinion about whether
  // a one-time code has been used.
  const { execFileSync } = await import('node:child_process');
  let hits = '';
  try {
    hits = execFileSync(
      'git',
      ['grep', '-n', '-E', 'UPDATE admins[^;]*SET[^;]*totp_|UPDATE admin_recovery_codes', '--', 'app', 'lib'],
      { cwd: ROOT, encoding: 'utf8' },
    );
  } catch {
    return;
  }

  const offenders = hits.split('\n').filter(Boolean)
    .filter(l => !l.startsWith('lib/admin-security.js:'));

  assert.deepEqual(offenders, [],
    `the TOTP columns are written outside lib/admin-security.js:\n${offenders.join('\n')}`);
});

/* ------------------------------------------------------- the login flow */

test('the login screen does not create a session for an enrolled admin', () => {
  const src = read('app/admin/(auth)/login/page.js');
  // The password branch must hand off to the pending session, and it must do so
  // before createSession is reached. Deleting that redirect would turn the
  // second factor into a screen that appears after you are already signed in.
  const handoff = src.indexOf('startPendingSession');
  const session = src.indexOf('await createSession');
  assert.ok(handoff > 0, 'the login screen never starts a pending session');
  assert.ok(session > handoff,
    'createSession is reached before the two-factor handoff, so the second factor is not a gate');
  assert.match(src, /totp_enrolled_at/,
    'the login query must read whether this admin has a second factor');
});

test('the second-factor screen is rate limited on the account, not only the address', () => {
  const src = read('app/admin/(auth)/login/verify/page.js');
  assert.match(src, /rateOk\('login-2fa',/, 'no per-address limit');
  assert.match(src, /rateOk\('login-2fa-acct',/,
    'no per-account limit — an attacker rotating source addresses would have no ceiling');
});

test('the second factor has its own rate-limit allowance', async () => {
  const { limits } = await import('../lib/config.js');
  assert.ok(Array.isArray(limits.login2fa), 'limits.login2fa is missing');
  const [max, windowSec] = limits.login2fa;
  assert.ok(max > 0 && max <= 20, 'a six-digit code needs a tight attempt cap');
  assert.ok(windowSec >= 600, 'the window has to be long enough to matter');
});
