/**
 * Not just "is somebody signed in", but "is it THIS somebody's to touch".
 *
 * tests/admin-actions.test.mjs proves every Server Action checks the session and
 * the CSRF token. It accepts requireAdmin() as that proof, which is correct for
 * what it is testing and is not enough on its own. An action written tomorrow as
 *
 *     const admin = await requireAdmin();
 *     await sql`DELETE FROM offers WHERE id = ${formData.get('id')}`;
 *
 * passes that suite completely, and hands every member of staff the power to
 * delete discount codes - which lib/admin-roles.js deliberately reserves to the
 * owner, on the grounds that a discount code is money by another name.
 *
 * Worse is the self-service shape:
 *
 *     const admin = await requireAdmin();
 *     await changePassword(formData.get('adminId'), ...);
 *
 * That is an authenticated request changing a row it does not own, which is the
 * whole of broken access control in two lines. Nothing mechanical stops either
 * one today; both are stopped by whoever writes the next action remembering.
 *
 * So this file holds the three rules that make the role model real rather than
 * customary:
 *
 *   1. Writing a table means naming the permission that governs it.
 *   2. Touching another admin's row means being the owner.
 *   3. Touching your OWN row means taking the id from the session and never
 *      from the request. This is the ownership check proper: there is no
 *      permission that expresses "your own account", only provenance.
 *
 * The permission strings are checked against lib/admin-roles.js, so a typo like
 * 'offer:write' fails here rather than becoming a screen that silently refuses
 * everybody - can() answers false for an unknown permission, by design.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_PERMISSIONS, PERMISSIONS } from '../lib/admin-roles.js';
import { ROOT, walk, serverActions } from './_lib/server-actions.mjs';

const ALL = serverActions();

/* ------------------------------------------------------------------ rule 1 */

/**
 * Writing this table means naming this permission.
 *
 * orders covers its two children as well: an order line and an order event are
 * the order, and an action that could rewrite the items without orders:write
 * would be able to change what a customer owes.
 */
const TABLE_PERMISSION = {
  offers: 'offers:write',
  products: 'products:write',
  subscribers: 'subscribers:write',
  orders: 'orders:write',
  order_items: 'orders:write',
  order_events: 'orders:write',
  admins: 'accounts:manage',
  admin_recovery_codes: 'accounts:manage',
};

/**
 * Most actions do not write SQL themselves, they call something in lib/ that
 * does. The rule has to follow the write, so the helpers carry it too -
 * otherwise moving one statement into a function is a way to shed a permission.
 */
const HELPER_PERMISSION = {
  transitionAndNotify: 'orders:write',
  logEvent: 'orders:write',
  saveOrderEdit: 'orders:write',
  createProduct: 'products:write',
  updateProduct: 'products:write',
  archiveProduct: 'products:write',
  restoreProduct: 'products:write',
  discardProduct: 'products:write',
  toggleActive: 'products:write',
  toggleFeatured: 'products:write',
};

/** Helpers that reach another admin's row. Owner, or nobody. */
const OWNER_ONLY_HELPERS = ['createAdmin', 'setAdminRole', 'setAdminSuspended', 'removeAdmin'];

/**
 * The actions that legitimately write without naming a permission, and why.
 *
 * All five are in the (auth) group, and the reason is the same in each case:
 * they run for somebody who has no session yet, so there is no role to consult.
 * What stands in for the permission is named per entry, because "it is the
 * login page" is not on its own an argument.
 */
const BEFORE_SESSION = {
  'app/admin/(auth)/login/page.js:doLogin':
    'no session yet - bcrypt against the row, then two rate limiters; writes only last_login',
  'app/admin/(auth)/login/verify/page.js:verify':
    'no session yet - the pending cookie is a JWT with its own audience, and the admin id comes out of it, never out of the form',
  'app/admin/(auth)/reset/page.js:setNewPassword':
    'no session yet - the reset token alone selects the admin; no email or id parameter is accepted',
  'app/admin/(auth)/forgot/page.js:requestReset':
    'no session yet - answers identically whether or not the address exists',
  'app/admin/(auth)/setup/page.js:createFirstAdmin':
    'no session yet - key gated AND the INSERT carries WHERE NOT EXISTS (SELECT 1 FROM admins), so it cannot mint a second one',
  'app/admin/_lib/session-actions.js:logout':
    'ending a session cannot require one',
};

/** Any spelling that names a permission: the helper, or can() directly. */
const namesPermission = (body, permission) =>
  new RegExp(`requirePermission\\(\\s*'${permission}'|can\\([^,)]+,\\s*'${permission}'`).test(body)
  || (permission === 'accounts:manage' && /requireOwner\s*\(\)/.test(body));

/** The tables an action writes, read out of its SQL. */
function tablesWritten(body) {
  const out = new Set();
  for (const m of body.matchAll(/INSERT\s+INTO\s+([a-z_]+)|UPDATE\s+([a-z_]+)\s+SET|DELETE\s+FROM\s+([a-z_]+)/gi)) {
    out.add((m[1] || m[2] || m[3]).toLowerCase());
  }
  return out;
}

const key = a => `${a.file}:${a.name}`;

test('the walk finds the actions this file is meant to police', () => {
  assert.ok(ALL.length >= 25, `only found ${ALL.length} server actions`);
  for (const expected of [
    'app/admin/(panel)/offers/page.js:offerAction',
    'app/admin/_lib/offer-actions.js:sendOfferBatch',
    'app/admin/_lib/security-actions.js:changeAdminPassword',
    'app/admin/_lib/account-actions.js:changeAdminRole',
  ]) {
    assert.ok(ALL.map(key).includes(expected), `${expected} was not found by the scan`);
  }
});

test('every permission this file demands is a real one', () => {
  // can() answers false for an unknown permission, so a typo here would not
  // throw - it would produce a screen that refuses everybody, for ever.
  const demanded = [...new Set([...Object.values(TABLE_PERMISSION), ...Object.values(HELPER_PERMISSION)])];
  const unknown = demanded.filter(p => !ALL_PERMISSIONS.includes(p));
  assert.deepEqual(unknown, [], `not permissions in lib/admin-roles.js: ${unknown.join(', ')}`);
});

test('every permission named anywhere in app/ is a real one', () => {
  const bad = [];
  for (const full of walk(join(ROOT, 'app'))) {
    const src = readFileSync(full, 'utf8');
    for (const m of src.matchAll(/requirePermission\(\s*'([^']+)'|can\([^,)]+,\s*'([^']+)'/g)) {
      const p = m[1] || m[2];
      if (!ALL_PERMISSIONS.includes(p)) bad.push(`${full}: '${p}'`);
    }
  }
  assert.deepEqual(bad, [], `permissions that no role can ever hold:\n${bad.join('\n')}`);
});

test('an action that writes a governed table names the permission for it', () => {
  const problems = [];
  for (const a of ALL) {
    if (BEFORE_SESSION[key(a)]) continue;
    for (const table of tablesWritten(a.body)) {
      const need = TABLE_PERMISSION[table];
      if (!need) continue;
      if (!namesPermission(a.body, need)) {
        problems.push(`${key(a)} writes ${table} without naming ${need}`);
      }
    }
  }
  assert.deepEqual(problems, [], `a session is not a permission:\n${problems.join('\n')}`);
});

test('an action that writes through a helper names the same permission', () => {
  // Otherwise moving a statement into lib/ is a way to shed the check.
  const problems = [];
  for (const a of ALL) {
    if (BEFORE_SESSION[key(a)]) continue;
    for (const [helper, need] of Object.entries(HELPER_PERMISSION)) {
      if (!new RegExp(`\\b${helper}\\s*\\(`).test(a.body)) continue;
      if (!namesPermission(a.body, need)) {
        problems.push(`${key(a)} calls ${helper}() without naming ${need}`);
      }
    }
  }
  assert.deepEqual(problems, [], `a session is not a permission:\n${problems.join('\n')}`);
});

test('reaching another admin row requires the owner', () => {
  const problems = [];
  for (const a of ALL) {
    for (const helper of OWNER_ONLY_HELPERS) {
      if (!new RegExp(`\\b${helper}\\s*\\(`).test(a.body)) continue;
      if (!/requireOwner\s*\(\)/.test(a.body)) {
        problems.push(`${key(a)} calls ${helper}() without requireOwner()`);
      }
    }
  }
  assert.deepEqual(problems, [], `an account system where any account can mint another is not an account system:\n${problems.join('\n')}`);
});

/* ------------------------------------------------------------------ rule 3 */

test('a self-service action never takes an identity from the request', () => {
  /*
   * The real ownership check, and the one with no permission behind it.
   *
   * Changing your own password, enrolling your own second factor, signing your
   * own sessions out and reissuing your own recovery codes are open to every
   * role, because each one may only ever reach the row the caller already holds
   * a session for. Nothing in lib/admin-roles.js can express that. The only
   * thing that makes it true is where the id comes from: admin.id, out of the
   * verified session cookie.
   *
   * An id arriving in the form would turn all seven of these into a way for any
   * signed-in staff member to take the owner's account - reset the password,
   * disable the second factor, mint new recovery codes. So the id must not be
   * readable from the request at all in this module, and every one of them has
   * to be seen passing admin.id.
   */
  const file = 'app/admin/_lib/security-actions.js';
  const mine = ALL.filter(a => a.file === file);
  assert.ok(mine.length >= 7, `only ${mine.length} actions found in ${file}`);

  const fromRequest = mine
    .filter(a => /formData\.get\(\s*'[a-zA-Z_]*[iI]d'\s*\)/.test(a.body))
    .map(key);
  assert.deepEqual(fromRequest, [], `these read an account id from the request instead of the session:\n${fromRequest.join('\n')}`);

  const notFromSession = mine
    .filter(a => a.name !== 'logout')
    .filter(a => !/\badmin\.id\b/.test(a.body))
    .map(key);
  assert.deepEqual(notFromSession, [], `these never pass admin.id, so it is unclear whose row they touch:\n${notFromSession.join('\n')}`);
});

test('account management passes the caller from the session, not from the form', () => {
  // setAdminRole(owner.id, targetId, role): the FIRST argument decides whether
  // the call is allowed, and it has to be the session's admin. The target may
  // come from the form - that is the feature - but the actor may not.
  const file = 'app/admin/_lib/account-actions.js';
  const mine = ALL.filter(a => a.file === file);
  assert.ok(mine.length >= 4, `only ${mine.length} actions found in ${file}`);

  for (const a of mine) {
    for (const helper of OWNER_ONLY_HELPERS) {
      const call = new RegExp(`\\b${helper}\\s*\\(\\s*([A-Za-z0-9_.]+)`).exec(a.body);
      if (!call) continue;
      assert.equal(call[1], 'owner.id',
        `${key(a)} passes ${call[1]} to ${helper}() as the actor; it must be owner.id from requireOwner()`);
    }
  }
});

test('the exemption list names only actions that exist, with a reason', () => {
  // A stale exemption is permission left lying around for whatever takes the
  // name next.
  const names = new Set(ALL.map(key));
  const stale = Object.keys(BEFORE_SESSION).filter(k => !names.has(k));
  assert.deepEqual(stale, [], `BEFORE_SESSION names actions that are gone: ${stale.join(', ')}`);

  const unreasoned = Object.entries(BEFORE_SESSION)
    .filter(([, why]) => String(why).trim().length < 20)
    .map(([k]) => k);
  assert.deepEqual(unreasoned, [], `exempted without a real reason: ${unreasoned.join(', ')}`);
});

test('staff hold no permission that governs money or accounts', () => {
  /*
   * The rules above are only worth having if the table underneath them still
   * says what it said when they were written. This pins the four that the whole
   * arrangement depends on, so widening a role is a deliberate edit here rather
   * than a quiet one in lib/admin-roles.js.
   */
  for (const p of ['offers:write', 'products:write', 'accounts:manage', 'subscribers:export']) {
    assert.ok(!PERMISSIONS.staff.includes(p), `staff have gained ${p}`);
    assert.ok(PERMISSIONS.owner.includes(p), `the owner has lost ${p}`);
  }
  // And the one they must keep, because it is the job.
  assert.ok(PERMISSIONS.staff.includes('orders:write'), 'staff can no longer work the order desk');
});
