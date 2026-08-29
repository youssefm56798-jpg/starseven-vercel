/**
 * Staff accounts, roles and the admin password reset.
 *
 * No database, like the rest of tests/ — the statements themselves are proved
 * against a real Postgres by scripts/verify-admin-accounts.mjs. What lives here
 * is the half that a database cannot answer:
 *
 *   the permission table, which is pure and therefore fully testable
 *   the schema keeping up with the columns the code reads
 *   and the rule that every Server Action in the admin is guarded
 *
 * That last one is the important one. A Server Action is a POST endpoint; the
 * fact that only one page renders a button for it is not a control, and the
 * check that gets left off is never the one in the module doing the writing —
 * it is the one at the top of the next action somebody adds. So the actions are
 * enumerated out of the source and each one is required to prove it checks a
 * session and a CSRF token, rather than anyone having to remember.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ALL_PERMISSIONS, can, cleanRole, DEFAULT_ROLE, isOwner, PERMISSIONS, ROLES,
} from '../lib/admin-roles.js';

// URL pathnames arrive as /C:/... on win32; the leading slash has to come off.
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');

const schema = read('db/schema.sql');

/* ------------------------------------------------------ the permission table */

test('there are exactly the two roles the shop has, and staff is the default', () => {
  assert.deepEqual(ROLES, ['owner', 'staff']);
  assert.equal(DEFAULT_ROLE, 'staff',
    'a row written by code that has not been taught about roles must get the smaller set of powers');
  assert.deepEqual(Object.keys(PERMISSIONS).sort(), [...ROLES].sort(),
    'every role needs a permission list, or can() silently denies everything for it');
});

test('the owner has every permission there is', () => {
  assert.deepEqual([...PERMISSIONS.owner].sort(), ALL_PERMISSIONS);
});

test('staff powers are a subset of owner powers', () => {
  // Not a tautology: the lists are written out separately on purpose, so this
  // catches a permission granted to staff and never to the owner.
  for (const p of PERMISSIONS.staff) {
    assert.ok(PERMISSIONS.owner.includes(p), `staff has ${p} and the owner does not`);
  }
});

test('staff cannot manage accounts, and that is the one that is not negotiable', () => {
  assert.equal(can('staff', 'accounts:manage'), false);
  assert.equal(can('owner', 'accounts:manage'), true);
  assert.equal(isOwner('staff'), false);
  assert.equal(isOwner('owner'), true);
});

test('the rest of the split is what the comment says it is', () => {
  // Staff run the order desk. Everything they have writes an order_events row
  // stamped with their id; everything they do not have would leave no trail, or
  // is money, or cannot be undone.
  for (const allowed of ['orders:read', 'orders:write', 'products:read', 'subscribers:read']) {
    assert.equal(can('staff', allowed), true, `staff should have ${allowed}`);
  }
  for (const denied of [
    'products:write', 'offers:read', 'offers:write',
    'subscribers:write', 'subscribers:export', 'accounts:read', 'accounts:manage',
  ]) {
    assert.equal(can('staff', denied), false, `staff must not have ${denied}`);
  }
});

test('can() fails closed on anything it does not recognise', () => {
  // An authorisation helper that answers "I do not know" with anything other
  // than no is a hole, and this one is called from server actions where the
  // alternative to a clear false is a screen somebody should not be looking at.
  for (const role of [undefined, null, '', 'admin', 'OWNER', 'root', 0, {}]) {
    assert.equal(can(role, 'orders:read'), false, `role ${JSON.stringify(role)} was allowed in`);
  }
  for (const perm of [undefined, null, '', 'accounts', 'orders:*', '__proto__', 'toString']) {
    assert.equal(can('owner', perm), false, `permission ${JSON.stringify(perm)} was granted`);
  }
});

test('cleanRole only ever returns a role that exists', () => {
  assert.equal(cleanRole('owner'), 'owner');
  assert.equal(cleanRole(' Staff '), 'staff');
  for (const bad of ['root', '', null, undefined, 'owner staff', '__proto__']) {
    assert.equal(cleanRole(bad), null, `${JSON.stringify(bad)} was accepted as a role`);
  }
});

/* ------------------------------------------------------------------ the schema */

test('every new admins column the code reads is created by the schema', () => {
  const sources = [
    'lib/admin-accounts.js',
    'lib/admin-reset.js',
    'lib/auth.js',
    'app/admin/(auth)/login/page.js',
    'app/admin/(auth)/login/verify/page.js',
    'app/admin/(auth)/setup/page.js',
  ].map(read).join('\n');

  for (const column of ['role', 'suspended_at', 'created_by']) {
    assert.match(sources, new RegExp(`\\b${column}\\b`),
      `${column} is in the schema but nothing reads it — is it dead?`);
    assert.match(schema, new RegExp(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS\\s+${column}\\b`),
      `${column} is read by the code but never added to the admins table`);
  }
});

test('the role column is constrained to the roles the code knows about', () => {
  // db/schema.sql is re-run on every deploy, so the constraint has to be
  // dropped before it is added or the second build fails on a duplicate name.
  assert.match(schema, /ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check/);
  const m = schema.match(/ADD CONSTRAINT admins_role_check\s+CHECK \(role IN \(([^)]*)\)\)/);
  assert.ok(m, 'there is no CHECK on admins.role');
  const inSql = m[1].split(',').map(s => s.trim().replace(/'/g, '')).sort();
  assert.deepEqual(inSql, [...ROLES].sort(),
    'the CHECK and lib/admin-roles.js disagree about what a role is');
});

test('the existing admin is promoted once, and only when there is no owner', () => {
  const stmt = schema.match(/UPDATE admins SET role = 'owner'[^;]*/)?.[0] ?? '';
  assert.ok(stmt, 'nothing promotes the admin that already exists');
  assert.match(stmt, /NOT EXISTS \(SELECT 1 FROM admins WHERE role = 'owner'\)/,
    'the promotion is not guarded, so a redeploy could promote a staff account');
  assert.match(stmt, /id = \(SELECT id FROM admins ORDER BY id LIMIT 1\)/,
    'the promotion must name one row — otherwise it promotes every admin at once');
});

test('the reset table is created idempotently and indexed on the digest', () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS admin_password_resets/);
  assert.match(schema, /admin_id\s+INT NOT NULL REFERENCES admins\(id\) ON DELETE CASCADE/,
    'a live reset link must not outlive the admin it opens');
  assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_reset_hash\s+ON admin_password_resets \(token_hash\)/,
    'the claim is a lookup by digest, and a digest belongs to exactly one token');
  assert.match(schema, /used_at\s+TIMESTAMPTZ/,
    'single use is recorded, not implemented by deleting the row');
  assert.match(schema, /expires_at\s+TIMESTAMPTZ NOT NULL/,
    'a reset link with no expiry is a permanent key to the panel');
});

test('the new admins columns are added idempotently, like the rest of the file', () => {
  const adds = schema.match(/ALTER TABLE admins ADD COLUMN[^;]*/g) ?? [];
  assert.ok(adds.length >= 9, 'expected the earlier six columns plus role, suspended_at and created_by');
  for (const stmt of adds) {
    assert.match(stmt, /ADD COLUMN IF NOT EXISTS/, `not idempotent: ${stmt.slice(0, 60)}`);
  }
});

test('no SQL comment in the schema leaves a quote hanging', () => {
  /*
   * tests/sql-split.test.mjs counts single quotes per statement and requires an
   * even number, and a comment is part of the statement that follows it - so
   * one apostrophe in English prose makes a statement look like it has an
   * unterminated literal and can split the file in the wrong place.
   *
   * Quoting a SQL value inside a comment is fine and the file does it often
   * (a '-ar' slug, the 'owner' role): that is a pair. What is banned is the odd
   * one, which is always an apostrophe somebody typed without thinking.
   */
  const lines = schema.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const at = lines[i].indexOf('--');
    if (at === -1) continue;
    // Only lines that are entirely a comment; a trailing -- after code would
    // need the quotes before it counted, which is not what this is checking.
    if (lines[i].slice(0, at).trim() !== '') continue;
    const quotes = (lines[i].match(/'/g) ?? []).length;
    assert.equal(quotes % 2, 0,
      `a comment on line ${i + 1} has an odd quote in it: ${lines[i].trim()}`);
  }
});

/* --------------------------------------------- every admin action is guarded */

/** Every file under app/admin, walked rather than listed. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (entry.name.endsWith('.js')) out.push(rel);
  }
  return out.sort();
}

/**
 * The Server Actions in one file, as { name, body }.
 *
 * Two shapes exist in this codebase: a file whose first statement is
 * 'use server', where every export is an action, and a page with 'use server'
 * as the first line of a function body. Both are found here. A function body is
 * taken to run to the start of the next function declaration, which is true for
 * every action in this panel because they are all declared at the top of their
 * file, above the component.
 */
function actionsIn(src) {
  const fileLevel = /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*['"]use server['"];/.test(src);
  const re = /(export\s+)?async function (\w+)\s*\(/g;
  const found = [];
  let m;
  while ((m = re.exec(src))) {
    found.push({ exported: Boolean(m[1]), name: m[2], start: m.index, from: re.lastIndex });
  }

  const out = [];
  for (let i = 0; i < found.length; i++) {
    const end = i + 1 < found.length ? found[i + 1].start : src.length;
    const body = src.slice(found[i].from, end);
    const inline = /^[^\n]*\)\s*\{\s*\n\s*['"]use server['"];/.test(src.slice(found[i].from - 1, found[i].from + 200));
    if (fileLevel ? found[i].exported : inline) out.push({ name: found[i].name, body });
  }
  return out;
}

/**
 * Actions that legitimately do not check a session.
 *
 * Kept as a list with reasons rather than as a loosened rule, so adding to it
 * is a decision somebody has to write down.
 */
const NO_SESSION_NEEDED = new Set([
  // Signing out cannot require being signed in: the whole point is to work
  // from a session that may already be dead. It still checks CSRF, because a
  // cross-site logout is a real if minor nuisance.
  'logout',
]);

const SESSION_CHECK = /requireAdmin\(|requirePermission\(|requireOwner\(|currentAdmin\(/;

const adminFiles = walk('app/admin').filter(f => !f.endsWith('.css'));

test('the sweep finds the actions it is supposed to be checking', () => {
  // A guard on the guard. If actionsIn ever stops matching - a syntax change, a
  // rename - every test below would pass by finding nothing at all.
  const names = adminFiles.flatMap(f => actionsIn(read(f)).map(a => a.name)).sort();
  for (const expected of [
    'changeAdminRole', 'createStaffAccount', 'deleteAdmin', 'mailResetLink', 'suspendAdmin',
    'changeAdminPassword', 'signOutEverywhere', 'turnOffTwoFactor', 'sendOfferBatch',
    'doLogin', 'verify', 'createFirstAdmin', 'requestReset', 'setNewPassword',
    'saveProduct', 'subAction', 'createOffer', 'offerAction', 'logout',
  ]) {
    assert.ok(names.includes(expected), `the action sweep did not find ${expected}`);
  }
});

for (const file of adminFiles) {
  const actions = actionsIn(read(file));
  if (!actions.length) continue;

  test(`every Server Action in ${file} checks CSRF`, () => {
    for (const { name, body } of actions) {
      assert.match(body, /csrfOk\(/,
        `${name} is a POST endpoint that anybody can call and it checks no CSRF token`);
    }
  });

  // The pre-auth screens - login, the second factor, setup, forgot, reset - are
  // reachable without a session by definition, so the session rule is applied
  // to the panel and to the shared action modules.
  if (file.includes('(panel)') || file.includes('_lib/')) {
    test(`every Server Action in ${file} checks the session`, () => {
      for (const { name, body } of actions) {
        if (NO_SESSION_NEEDED.has(name)) continue;
        assert.match(body, SESSION_CHECK,
          `${name} writes from a session it never verified`);
      }
    });
  }
}

test('every account action is owner-only, checked in the action itself', () => {
  const src = read('app/admin/_lib/account-actions.js');
  for (const { name, body } of actionsIn(src)) {
    assert.match(body, /requireOwner\(\)/,
      `${name} manages accounts without requiring an owner`);
  }
});

test('the owner-only screens are owner-only, and the read-only ones are not', () => {
  const perm = (rel, want) => {
    const src = read(rel);
    assert.ok(src.includes(want), `${rel} does not gate on ${want}`);
  };
  perm('app/admin/(panel)/accounts/page.js', 'requireOwner()');
  perm('app/admin/(panel)/offers/page.js', "requirePermission('offers:write')");
  perm('app/admin/(panel)/products/page.js', "requirePermission('products:write')");
  perm('app/admin/(panel)/products/page.js', "requirePermission('products:read')");
  perm('app/admin/(panel)/subscribers/page.js', "requirePermission('subscribers:write')");
  perm('app/admin/(panel)/subscribers/page.js', "requirePermission('subscribers:read')");

  // The CSV export is a route handler: no form, no button, and the tab strip
  // hiding the link protects nothing. It has to check for itself.
  const exportRoute = read('app/admin/(panel)/subscribers/export/route.js');
  assert.match(exportRoute, /can\(admin\.role, 'subscribers:export'\)/,
    'the subscriber export is reachable by typing the URL');

  // And the broadcast, which is called from a client component.
  assert.match(read('app/admin/_lib/offer-actions.js'), /can\(admin\.role, 'offers:write'\)/,
    'the offer broadcast checks a session but not a role');
});

/* ------------------------------------------------------- the reset discipline */

test('only the digest of a reset token ever reaches the database', () => {
  const src = read('lib/admin-reset.js');
  const statements = src.match(/sql`[\s\S]*?`/g) ?? [];
  assert.ok(statements.length >= 3, 'expected the issue, the read and the claim');
  for (const stmt of statements) {
    assert.ok(!/\$\{token\}/.test(stmt),
      `a raw token is being sent to Postgres:\n${stmt.slice(0, 200)}`);
  }
  assert.match(src, /token_hash = \$\{await sha256\(token\)\}/,
    'the lookup must be by digest, written out so that reading the query is enough to see it');
});

test('a reset token is claimed by the WHERE clause, not by a read then a write', () => {
  const src = read('lib/admin-reset.js');
  const claim = src.slice(src.indexOf('export async function claimReset'));
  assert.match(claim, /UPDATE admin_password_resets[\s\S]*?SET used_at = now\(\)/);
  assert.match(claim, /used_at IS NULL/,
    'without this two requests racing on one link would both be let in');
  assert.match(claim, /expires_at > now\(\)/,
    'an expiry that is not in the WHERE clause is a comment, not an expiry');
});

test('issuing a reset link is one statement, so a hit and a miss cost the same', () => {
  // The trap app/api/subscribe/route.js documents at length: identical wording
  // is not enough when a hit costs an extra round trip, because the latency is
  // then an oracle for which addresses can get into the shop admin.
  const src = read('lib/admin-reset.js');
  const fn = src.slice(
    src.indexOf('export async function issueResetToken'),
    src.indexOf('export async function resetTarget'),
  );
  assert.equal((fn.match(/sql`/g) ?? []).length, 1,
    'issueResetToken sends more than one query, so a hit and a miss are distinguishable by time');
  assert.match(fn, /WITH hit AS/, 'the lookup and the mint must be one statement');
  assert.match(fn, /INSERT INTO admin_password_resets[\s\S]*?FROM hit/,
    'the mint must be a data-modifying CTE fed by the lookup');
});

test('the forgot screen answers the same way whether or not the address is an admin', () => {
  const src = read('app/admin/(auth)/forgot/page.js');
  const fn = src.slice(src.indexOf('async function requestReset'), src.indexOf('export default'));
  const successes = fn.match(/redirect\('\/admin\/forgot\?m=reset_sent'\)/g) ?? [];
  assert.equal(successes.length, 1,
    'there must be exactly one success redirect, reached from both branches - two copies drift');
  assert.match(fn, /after\(/,
    'the send must be deferred, or the Resend round trip puts the hit branch hundreds of ms behind');
  assert.match(fn, /rateOk\('admin-forgot',/, 'no per-address limit on the enumeration surface');
  assert.match(fn, /rateOk\('admin-forgot-acct',/,
    'no per-email limit, so the shop can be used to mail somebody on demand');
});

test('a reset does not sign anybody in, and does not touch the second factor', () => {
  const src = read('app/admin/(auth)/reset/page.js');
  assert.ok(!/createSession/.test(src),
    'setting a password must not mint a session - an account with a second factor would be past it');
  assert.match(src, /redirect\('\/admin\/login\?m=pw_reset'\)/);

  const lib = read('lib/admin-reset.js');
  assert.ok(!/totp_/.test(lib),
    'a reset that cleared the second factor would let a mailbox past both locks at once');
  assert.match(lib, /bumpSessionEpoch\(/,
    'a password reset that leaves existing sessions alive protects nothing');
});

test('the reset goes through lib/session-epoch.js rather than writing the column', () => {
  // The same one-writer rule tests/admin-security.test.mjs holds for the
  // existing code. Restated here because a reset is the newest thing that has a
  // reason to want to revoke, and it is the likeliest place for a second writer
  // to appear.
  for (const rel of ['lib/admin-reset.js', 'lib/admin-accounts.js']) {
    const src = read(rel);
    assert.match(src, /bumpSessionEpoch\(/, `${rel} never revokes anything`);
    // The prose in both files talks about the epoch, which is the point of the
    // comment; what must not appear is the column inside a statement.
    for (const stmt of src.match(/sql`[\s\S]*?`/g) ?? []) {
      assert.ok(!/session_epoch/.test(stmt),
        `${rel} writes session_epoch itself instead of going through lib/session-epoch.js:\n${stmt.slice(0, 160)}`);
    }
  }
});

/* ---------------------------------------------------- the last-owner guard */

test('the last-owner guard is a locking CTE, in every statement that needs one', () => {
  const src = read('lib/admin-accounts.js');
  for (const fn of ['setAdminRole', 'setAdminSuspended', 'removeAdmin']) {
    const body = src.slice(src.indexOf(`export async function ${fn}`));
    const upTo = body.slice(0, body.indexOf('export async function', 10) + 1 || undefined);
    assert.match(upTo, /WITH owners AS \(/, `${fn} has no owner guard at all`);
    assert.match(upTo, /FOR UPDATE/,
      `${fn} counts owners from a snapshot - two demotions racing would both succeed and leave none`);
    assert.match(upTo, /ORDER BY id\s*\n?\s*FOR UPDATE/,
      `${fn} locks owner rows in no fixed order, which is a deadlock between two requests`);
  }
});

test('every account mutation re-reads the caller role from the database', () => {
  const src = read('lib/admin-accounts.js');
  for (const fn of ['createAdmin', 'setAdminRole', 'setAdminSuspended', 'removeAdmin']) {
    const body = src.slice(src.indexOf(`export async function ${fn}`));
    const upTo = body.slice(0, body.indexOf('export async function', 10) + 1 || undefined);
    assert.match(upTo, /await mayManage\(actorId\)/,
      `${fn} trusts whatever the caller said about itself`);
  }
  assert.match(src, /SELECT role FROM admins WHERE id = \$\{id\} AND suspended_at IS NULL/,
    'the role must come from the row, not from the session token, or a demotion takes eight hours');
});

test('an admin cannot demote, suspend or delete themselves', () => {
  const src = read('lib/admin-accounts.js');
  for (const fn of ['setAdminRole', 'setAdminSuspended', 'removeAdmin']) {
    const body = src.slice(src.indexOf(`export async function ${fn}`));
    const upTo = body.slice(0, body.indexOf('export async function', 10) + 1 || undefined);
    assert.match(upTo, /id === Number\(actorId\)/, `${fn} lets an owner lock themselves out`);
  }
});

/* --------------------------------------------------------------- the session */

test('the session refuses a suspended admin as well as a stale epoch', () => {
  const src = read('lib/auth.js');
  assert.match(src, /SELECT session_epoch, role FROM admins\s*\n?\s*WHERE id = \$\{id\} AND suspended_at IS NULL/,
    'a suspended admin is only stopped by the epoch bump, with no second lock');
  assert.match(src, /role: row\.role/,
    'the role must come from the row - a role inside the token is whatever was true eight hours ago');
});

test('the login screen refuses a suspended account, after the password', () => {
  const src = read('app/admin/(auth)/login/page.js');
  const compare = src.indexOf('bcrypt.compare');
  const suspended = src.indexOf('admin.suspended_at !== null');
  assert.ok(suspended > compare,
    'the suspension message is shown before the password is checked, which makes it an oracle');
  assert.match(read('app/admin/(auth)/login/verify/page.js'), /suspended_at/,
    'an account suspended between the password and the code can still finish signing in');
});

test('setup still works, and still creates an owner', () => {
  const src = read('app/admin/(auth)/setup/page.js');
  assert.match(src, /WHERE NOT EXISTS \(SELECT 1 FROM admins\)/,
    'the one-shot guard on first-time setup is gone');
  assert.match(src, /INSERT INTO admins \(email, pass_hash, name, role\)[\s\S]*?'owner'/,
    'the first admin must be an owner, or the shop is locked out of its own accounts screen');
  assert.match(src, /ADMIN_SETUP_KEY/, 'the bootstrap key is no longer read');
});
