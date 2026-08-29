#!/usr/bin/env node
/**
 * NEW STAR SEVEN — staff accounts, roles and the admin password reset, against
 * a real Postgres.
 *
 *   npm run verify:accounts
 *
 * The same arrangement as scripts/verify-admin-auth.mjs, for the same reason.
 * Everything under tests/ runs with no database on purpose, so tests/admin-
 * accounts.test.mjs can prove the permission table, the schema and the rule
 * that every Server Action is guarded — and nothing more. What it cannot prove
 * is the half of lib/admin-accounts.js and lib/admin-reset.js that is SQL, and
 * that half is where every property that matters lives:
 *
 *   an owner can create staff, and staff cannot create anybody
 *   the last owner cannot be demoted, suspended or removed - including by two
 *     requests arriving together, which is the case a snapshot read gets wrong
 *   a reset token works once, expires, and revokes every session on use
 *   two requests racing on one reset link cannot both win
 *   asking for a reset costs the same whether or not the address is an admin
 *
 * Every one of those is a guarded statement whose guard is the whole point, and
 * a guard that does not guard looks exactly like a guard that does until the
 * day it matters.
 *
 * ---------------------------------------------------------------------------
 * What "staff cannot manage accounts even by posting the action directly" means
 * here
 *
 * app/admin/_lib/account-actions.js imports next/navigation and cannot be
 * loaded outside a Next build, so this script cannot POST to it. That is
 * exactly why the authorisation is not only in the action: every function in
 * lib/admin-accounts.js re-reads the caller role FROM THE DATABASE and refuses
 * on its own. So the check that a hand-built POST would have to get past is the
 * one exercised below, with a real staff row, against real statements — and
 * tests/admin-accounts.test.mjs separately pins that every action in that file
 * calls requireOwner() before it reaches any of this.
 *
 * It creates its own database, works only in there, and drops it in a finally.
 * Before the first write it asserts that current_database() is the throwaway one
 * and that `admins` resolves to nothing — if either check fails it aborts,
 * because the failure it is guarding against is writing to the real admins
 * table.
 */

import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEnv } from './env-file.mjs';
import { splitStatements } from './sql-split.mjs';

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

// Nothing here should ever be openable by the live environment.
process.env.SESSION_SECRET = `verify-${randomBytes(16).toString('hex')}`;
// The reset URLs this script builds should not look like production ones.
process.env.NEXT_PUBLIC_SITE_URL = 'https://verify.invalid';

const DB = `s7_acct_${randomBytes(4).toString('hex')}`;

const { neon } = await import('@neondatabase/serverless');
const admin = neon(base);

const url = new URL(base);
url.pathname = `/${DB}`;
const raw = neon(url.toString());
const db = typeof raw.query === 'function' ? text => raw.query(text) : text => raw(text);

let failures = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function check(name, got, want) {
  if (same(got, want)) return console.log(`    ok    ${name}`);
  failures++;
  console.log(`    FAIL  ${name}`);
  console.log(`          got  ${JSON.stringify(got)}`);
  console.log(`          want ${JSON.stringify(want)}`);
}

function note(text) {
  console.log(`          ${text}`);
}

console.log('\n  New Star Seven — staff accounts, roles and password reset');
console.log(`  throwaway database: ${DB}`);

await admin`SELECT 1`;
await admin(`CREATE DATABASE "${DB}"`);

try {
  const [{ d }] = await raw`SELECT current_database() AS d`;
  if (d !== DB) throw new Error(`connected to "${d}", not "${DB}". Aborting.`);
  const [{ t }] = await raw`SELECT to_regclass('admins')::text AS t`;
  if (t !== null) throw new Error(`"admins" already resolves to ${t}. Aborting.`);
  console.log(`  guard: current_database() = ${d}, and it is empty\n`);

  const statements = splitStatements(readFileSync(join(ROOT, 'db/schema.sql'), 'utf8'));
  for (const stmt of statements) await db(stmt);

  // The modules read DATABASE_URL on their first query, so it has to point at
  // the throwaway database before anything imports them.
  process.env.DATABASE_URL = url.toString();

  const bcrypt = (await import('bcryptjs')).default;
  const {
    adminById, createAdmin, listAdmins, removeAdmin, setAdminRole, setAdminSuspended,
  } = await import('../lib/admin-accounts.js');
  const {
    claimReset, issueResetToken, resetTarget, resetUrl, RESET_TTL_MINUTES,
  } = await import('../lib/admin-reset.js');
  const { sha256 } = await import('../lib/order-access.js');

  const epochOf = async id =>
    Number((await raw`SELECT session_epoch FROM admins WHERE id = ${id}`)[0].session_epoch);
  const roleOf = async id =>
    (await raw`SELECT role FROM admins WHERE id = ${id}`)[0]?.role ?? null;
  const countAdmins = async () =>
    Number((await raw`SELECT COUNT(*)::int AS c FROM admins`)[0].c);
  const activeOwners = async () =>
    Number((await raw`SELECT COUNT(*)::int AS c FROM admins
                       WHERE role = 'owner' AND suspended_at IS NULL`)[0].c);

  /* ------------------------------------------------------------------ 1 */

  console.log('  the first admin, exactly as /admin/setup writes it');
  let OWNER;
  {
    // Character for character the INSERT in app/admin/(auth)/setup/page.js, so
    // that a change there which stops producing an owner fails here.
    const [row] = await raw`
      INSERT INTO admins (email, pass_hash, name, role)
      SELECT 'owner@example.com', ${await bcrypt.hash('the-first-owner-pw', 4)}, 'Owner', 'owner'
      WHERE NOT EXISTS (SELECT 1 FROM admins)
      RETURNING id, role`;
    OWNER = Number(row.id);
    check('the bootstrap admin is an owner', row.role, 'owner');
    check('and the one-shot guard still refuses a second', (await raw`
      INSERT INTO admins (email, pass_hash, name, role)
      SELECT 'second@example.com', 'x', 'Second', 'owner'
      WHERE NOT EXISTS (SELECT 1 FROM admins)
      RETURNING id`).length, 0);

    // The column default is the smaller of the two sets of powers, so a row
    // written by code that knows nothing about roles cannot manage accounts.
    const [plain] = await raw`
      INSERT INTO admins (email, pass_hash) VALUES ('default@example.com', 'x') RETURNING role`;
    check('a row written without a role defaults to staff', plain.role, 'staff');
    await raw`DELETE FROM admins WHERE email = 'default@example.com'`;

    let refused = false;
    try {
      await raw`INSERT INTO admins (email, pass_hash, role) VALUES ('x@example.com', 'x', 'root')`;
    } catch { refused = true; }
    check('a role the code does not know about is refused by the CHECK', refused, true);
  }

  /* ------------------------------------------------------------------ 2 */

  console.log('\n  an owner creates staff');
  let STAFF;
  {
    const res = await createAdmin(OWNER, {
      email: '  Desk@Example.COM ',
      password: 'a-perfectly-fine-password',
      name: '  Order   Desk  ',
      role: 'staff',
    });
    check('created', [res.ok, res.role], [true, 'staff']);
    STAFF = res.id;

    const [row] = await raw`SELECT * FROM admins WHERE id = ${STAFF}`;
    check('the address is stored lowercased and trimmed', row.email, 'desk@example.com');
    check('the name is collapsed, not stored as typed', row.name, 'Order Desk');
    check('the password is a bcrypt hash, not the password',
      [row.pass_hash.startsWith('$2'), row.pass_hash.includes('a-perfectly-fine-password')],
      [true, false]);
    check('and it verifies', await bcrypt.compare('a-perfectly-fine-password', row.pass_hash), true);
    check('the row records which owner opened it', Number(row.created_by), OWNER);
    check('it starts unsuspended and unenrolled',
      [row.suspended_at, row.totp_enrolled_at, Number(row.session_epoch)], [null, null, 0]);

    check('the same address twice is refused',
      await createAdmin(OWNER, { email: 'desk@example.com', password: 'another-good-password' }),
      { ok: false, reason: 'duplicate' });
    check('and refused however it is capitalised',
      (await createAdmin(OWNER, { email: 'DESK@EXAMPLE.COM', password: 'another-good-password' })).reason,
      'duplicate');

    check('a weak password is refused', (await createAdmin(OWNER, {
      email: 'weak@example.com', password: 'password123',
    })).reason, 'common');
    check('a short one is refused', (await createAdmin(OWNER, {
      email: 'weak@example.com', password: 'short',
    })).reason, 'too-short');
    check('one containing the address is refused', (await createAdmin(OWNER, {
      email: 'gabriella@example.com', password: 'gabriella-2026',
    })).reason, 'contains-email');
    check('a malformed address is refused', (await createAdmin(OWNER, {
      email: 'not-an-address', password: 'a-perfectly-fine-password',
    })).reason, 'bad-email');
    check('a role that does not exist is refused', (await createAdmin(OWNER, {
      email: 'root@example.com', password: 'a-perfectly-fine-password', role: 'root',
    })).reason, 'bad-role');
    check('and none of those wrote a row', await countAdmins(), 2);
  }

  /* ------------------------------------------------------------------ 3 */

  console.log('\n  staff cannot manage accounts, whatever they post');
  {
    // This is the check a hand-built POST straight at the Server Action would
    // have to get past: the action calls requireOwner() first, and then every
    // one of these refuses on its own after re-reading the caller role.
    const before = await countAdmins();

    check('staff cannot create an account', await createAdmin(STAFF, {
      email: 'mine@example.com', password: 'a-perfectly-fine-password', role: 'owner',
    }), { ok: false, reason: 'forbidden' });
    check('staff cannot promote themselves',
      await setAdminRole(STAFF, STAFF, 'owner'), { ok: false, reason: 'forbidden' });
    check('staff cannot demote the owner',
      await setAdminRole(STAFF, OWNER, 'staff'), { ok: false, reason: 'forbidden' });
    check('staff cannot suspend the owner',
      await setAdminSuspended(STAFF, OWNER, true), { ok: false, reason: 'forbidden' });
    check('staff cannot delete the owner',
      await removeAdmin(STAFF, OWNER), { ok: false, reason: 'forbidden' });

    check('and not one of those changed anything',
      [await countAdmins(), await roleOf(STAFF), await roleOf(OWNER),
        (await adminById(OWNER)).suspended],
      [before, 'staff', 'owner', false]);

    // An id that is not an admin at all, and one that is suspended, are the two
    // other ways the caller can fail to be an owner.
    check('an unknown actor is refused', (await createAdmin(999999, {
      email: 'ghost@example.com', password: 'a-perfectly-fine-password',
    })).reason, 'forbidden');
    check('so is an actor of 0, NaN or a string', [
      (await createAdmin(0, { email: 'a@example.com', password: 'a-perfectly-fine-password' })).reason,
      (await createAdmin(NaN, { email: 'b@example.com', password: 'a-perfectly-fine-password' })).reason,
      (await createAdmin('owner', { email: 'c@example.com', password: 'a-perfectly-fine-password' })).reason,
    ], ['forbidden', 'forbidden', 'forbidden']);
  }

  /* ------------------------------------------------------------------ 4 */

  console.log('\n  the last owner cannot be demoted, suspended or removed');
  {
    check('the shop starts with exactly one owner', await activeOwners(), 1);

    /*
     * The self guard first, because it is the one an owner actually meets.
     *
     * With one owner, every request that would leave the shop with none is a
     * request that owner makes about themselves - so this is the refusal that
     * fires in the panel, and the statement guard below is the backstop under
     * it. Both are needed and neither is the other: the self guard gives a
     * message somebody can act on, the statement guard is what holds when two
     * requests arrive at once.
     */
    check('the sole owner cannot demote itself',
      await setAdminRole(OWNER, OWNER, 'staff'), { ok: false, reason: 'self' });
    check('the sole owner cannot suspend itself',
      await setAdminSuspended(OWNER, OWNER, true), { ok: false, reason: 'self' });
    check('the sole owner cannot delete itself',
      await removeAdmin(OWNER, OWNER), { ok: false, reason: 'self' });
    check('and nothing about them moved',
      [await roleOf(OWNER), (await adminById(OWNER)).suspended, await activeOwners()],
      ['owner', false, 1]);

    /*
     * The statement guard, run as the statement.
     *
     * These send exactly the SQL lib/admin-accounts.js sends, with the
     * permission check and the self check stepped over - which is the only way
     * to aim it deliberately, because through the module a request that would
     * remove the last owner can only be a self-request or one half of a race,
     * and those are covered above and in the next section. If any of these
     * WHERE clauses were wrong the statement would succeed here, and the shop
     * would be one click away from being locked out of its own admin for good.
     */
    const lastOwnerDelete = await raw`
      WITH owners AS (
        SELECT id FROM admins WHERE role = 'owner' AND suspended_at IS NULL ORDER BY id FOR UPDATE
      )
      DELETE FROM admins a
       WHERE a.id = ${OWNER}
         AND (a.role <> 'owner' OR EXISTS (SELECT 1 FROM owners o WHERE o.id <> ${OWNER}))
      RETURNING a.id`;
    check('the statement alone refuses to delete the last owner', lastOwnerDelete.length, 0);

    const lastOwnerDemote = await raw`
      WITH owners AS (
        SELECT id FROM admins WHERE role = 'owner' AND suspended_at IS NULL ORDER BY id FOR UPDATE
      )
      UPDATE admins a SET role = 'staff'
       WHERE a.id = ${OWNER}
         AND ('staff'::text = 'owner' OR a.role <> 'owner'
              OR EXISTS (SELECT 1 FROM owners o WHERE o.id <> ${OWNER}))
      RETURNING a.id`;
    check('the statement alone refuses to demote the last owner', lastOwnerDemote.length, 0);

    const lastOwnerSuspend = await raw`
      WITH owners AS (
        SELECT id FROM admins WHERE role = 'owner' AND suspended_at IS NULL ORDER BY id FOR UPDATE
      )
      UPDATE admins a SET suspended_at = COALESCE(a.suspended_at, now())
       WHERE a.id = ${OWNER}
         AND (a.role <> 'owner' OR EXISTS (SELECT 1 FROM owners o WHERE o.id <> ${OWNER}))
      RETURNING a.id`;
    check('the statement alone refuses to suspend the last owner', lastOwnerSuspend.length, 0);

    check('after all of that the shop still has its owner',
      [await activeOwners(), await roleOf(OWNER), (await adminById(OWNER)).suspended],
      [1, 'owner', false]);

    /* ------------------------- and the same three, once there are two owners */

    const co = await createAdmin(OWNER, {
      email: 'co-owner@example.com', password: 'a-perfectly-fine-password', role: 'owner',
    });
    check('a second owner can be created', [co.ok, co.role], [true, 'owner']);
    const CO = co.id;
    check('two owners now', await activeOwners(), 2);

    // The guard is about the LAST owner and not about owners in general, so all
    // three now go through. Anything else would make a second owner impossible
    // to ever take back.
    check('with two owners, one can be suspended', (await setAdminSuspended(OWNER, CO, true)).ok, true);
    check('which leaves one ACTIVE owner', await activeOwners(), 1);

    // And a suspended owner does not count towards the guard, which is the
    // point of `suspended_at IS NULL` being in the CTE: otherwise suspending
    // one owner and demoting the other would empty the shop in two clicks.
    const withSuspendedAround = await raw`
      WITH owners AS (
        SELECT id FROM admins WHERE role = 'owner' AND suspended_at IS NULL ORDER BY id FOR UPDATE
      )
      UPDATE admins a SET role = 'staff'
       WHERE a.id = ${OWNER}
         AND ('staff'::text = 'owner' OR a.role <> 'owner'
              OR EXISTS (SELECT 1 FROM owners o WHERE o.id <> ${OWNER}))
      RETURNING a.id`;
    check('a suspended owner does not make the last active one demotable',
      withSuspendedAround.length, 0);

    check('restoring brings them back', (await setAdminSuspended(OWNER, CO, false)).ok, true);
    check('two owners again', await activeOwners(), 2);

    const epochBefore = await epochOf(CO);
    check('with two owners, one can be demoted', (await setAdminRole(OWNER, CO, 'staff')).ok, true);
    check('the demotion revokes their sessions, so the new role is in force now',
      await epochOf(CO), epochBefore + 1);
    check('and the demoted account can no longer manage accounts',
      (await createAdmin(CO, { email: 'never@example.com', password: 'a-perfectly-fine-password' })).reason,
      'forbidden');

    check('promoting works too', (await setAdminRole(OWNER, CO, 'owner')).ok, true);
    check('and with two owners, one can be deleted', (await removeAdmin(OWNER, CO)).ok, true);
    check('leaving one owner and one staff',
      [await countAdmins(), await activeOwners(), await roleOf(OWNER), await roleOf(STAFF)],
      [2, 1, 'owner', 'staff']);
  }

  /* ------------------------------------------------------------------ 5 */

  console.log('\n  two owners acting on each other at the same moment');
  {
    /*
     * The invariant the locking CTE exists for, and the one a plain "is there
     * another owner" read gets wrong.
     *
     * Two owners, two requests, each aimed at the other: both look the other up,
     * both find an owner, and without the FOR UPDATE both succeed and the shop
     * is left with nobody who can ever create an account again. It is textbook
     * write skew - the row being read is not the row being written, so nothing
     * collides on its own and Postgres has no reason to stop either one.
     *
     * All three paths are raced, because all three can reach zero owners.
     */
    const twoOwners = async label => {
      const made = await createAdmin(OWNER, {
        email: `${label}@example.com`, password: 'a-perfectly-fine-password', role: 'owner',
      });
      check(`two owners for the ${label} race`, [made.ok, await activeOwners()], [true, 2]);
      return made.id;
    };
    const survivorId = async () => Number((await raw`
      SELECT id FROM admins WHERE role = 'owner' AND suspended_at IS NULL LIMIT 1`)[0].id);

    /* ------------------------------- the control: the same race, unlocked */
    {
      /*
       * A race test that would also pass with the guard taken out proves
       * nothing at all, so this is the same race against the statement
       * lib/admin-accounts.js deliberately does NOT run: the obvious one, where
       * the owner count is read from the snapshot instead of locked.
       *
       * The window is widened with pg_sleep rather than by hoping the two
       * requests interleave, so this is a demonstration and not a coin toss.
       * Both statements take their snapshot, both sit inside it while the other
       * commits, and both then write - which is precisely the state two people
       * clicking at once on a Sunday produces by accident.
       *
       * Everything in here is raw SQL. Nothing under test is involved: the
       * point is to show what the code would do if it were written the obvious
       * way, and then that it is not written the obvious way.
       */
      let reproduced = false;
      for (let attempt = 0; attempt < 3 && !reproduced; attempt++) {
        const A = await twoOwners(`control-${attempt}`);
        const naive = id => raw`
          UPDATE admins a SET role = 'staff'
           WHERE a.id = ${id}
             AND (SELECT count(*) FROM (SELECT pg_sleep(0.6)) _s) = 1
             AND (a.role <> 'owner'
                  OR EXISTS (SELECT 1 FROM admins b
                              WHERE b.id <> ${id} AND b.role = 'owner'
                                AND b.suspended_at IS NULL))
          RETURNING a.id`;
        const [x, y] = await Promise.all([naive(OWNER), naive(A)]);
        reproduced = x.length === 1 && y.length === 1 && (await activeOwners()) === 0;

        // Put the shop back before anything else runs, whatever happened.
        await raw`UPDATE admins SET role = 'owner' WHERE id = ${OWNER}`;
        await raw`DELETE FROM admins WHERE id = ${A}`;
      }
      check('without the lock, two owners demoting each other BOTH succeed', reproduced, true);
      note('so the shop would be left with no owner and no way to make one');
      check('the shop is back to one owner before the real races run',
        [await activeOwners(), await countAdmins()], [1, 2]);
    }

    /* ------------------------------------------------------------- demote */
    {
      const CO = await twoOwners('race-demote');
      const go = (actor, target) => setAdminRole(actor, target, 'staff')
        .catch(e => ({ ok: false, threw: String(e?.message || e) }));
      const [a, b] = await Promise.all([go(OWNER, CO), go(CO, OWNER)]);
      check('exactly one demotion is let through', [a.ok, b.ok].filter(Boolean).length, 1);
      check('and the shop still has an owner', await activeOwners(), 1);
      OWNER = await survivorId();
    }

    /* ------------------------------------------------------------- delete */
    {
      const CO = await twoOwners('race-delete');
      const go = (actor, target) => removeAdmin(actor, target)
        .catch(e => ({ ok: false, threw: String(e?.message || e) }));
      const [a, b] = await Promise.all([go(OWNER, CO), go(CO, OWNER)]);
      check('exactly one deletion is let through', [a.ok, b.ok].filter(Boolean).length, 1);
      check('and the shop still has an owner', await activeOwners(), 1);
      OWNER = await survivorId();
    }

    /* ------------------------------------------------------------ suspend */
    {
      const CO = await twoOwners('race-suspend');
      const go = (actor, target) => setAdminSuspended(actor, target, true)
        .catch(e => ({ ok: false, threw: String(e?.message || e) }));
      const [a, b] = await Promise.all([go(OWNER, CO), go(CO, OWNER)]);
      check('exactly one suspension is let through', [a.ok, b.ok].filter(Boolean).length, 1);
      check('and an owner can still sign in', await activeOwners(), 1);
      OWNER = await survivorId();
    }

    // Harness tidying, deliberately with raw SQL so that nothing under test is
    // involved in it: leave exactly the one live owner and the staff account.
    for (const row of await raw`SELECT id FROM admins WHERE id <> ${OWNER} AND id <> ${STAFF}`) {
      await raw`DELETE FROM admins WHERE id = ${Number(row.id)}`;
    }
    check('tidied back to one owner and one staff',
      [await countAdmins(), await activeOwners(), await roleOf(OWNER), await roleOf(STAFF)],
      [2, 1, 'owner', 'staff']);
  }

  /* ------------------------------------------------------------------ 6 */

  console.log('\n  suspending an account');
  {
    const before = await epochOf(STAFF);
    check('suspending works', (await setAdminSuspended(OWNER, STAFF, true)).ok, true);
    const [row] = await raw`SELECT suspended_at FROM admins WHERE id = ${STAFF}`;
    check('the row is stamped, not deleted', row.suspended_at !== null, true);
    check('every session it held is revoked on the spot', await epochOf(STAFF), before + 1);

    // lib/auth.js reads the session with the same predicate. A suspended admin
    // therefore has no epoch to match, on top of the epoch having moved.
    const live = await raw`
      SELECT session_epoch FROM admins WHERE id = ${STAFF} AND suspended_at IS NULL`;
    check('and the session lookup finds no row at all for them', live.length, 0);

    check('a suspended admin cannot manage accounts either',
      (await createAdmin(STAFF, { email: 'nope@example.com', password: 'a-perfectly-fine-password' })).reason,
      'forbidden');
    check('and cannot be sent a reset link', await issueResetToken('desk@example.com'), null);

    check('restoring works', (await setAdminSuspended(OWNER, STAFF, false)).ok, true);
    check('the stamp is cleared',
      (await raw`SELECT suspended_at FROM admins WHERE id = ${STAFF}`)[0].suspended_at, null);
    check('and the session lookup finds them again',
      (await raw`SELECT session_epoch FROM admins WHERE id = ${STAFF} AND suspended_at IS NULL`).length, 1);
  }

  /* ------------------------------------------------------------------ 7 */

  console.log('\n  a password reset link');
  {
    const issued = await issueResetToken('desk@example.com', '198.51.100.7');
    check('a link is minted for a real address', issued !== null, true);
    check('for the right admin', issued.admin.id, STAFF);
    check('the URL points at the reset screen',
      resetUrl(issued.token).startsWith('https://verify.invalid/admin/reset?t='), true);

    const [row] = await raw`
      SELECT token_hash, expires_at, used_at, requested_ip FROM admin_password_resets
       WHERE admin_id = ${STAFF} ORDER BY id DESC LIMIT 1`;
    check('what is stored is a SHA-256, not the token',
      [/^[0-9a-f]{64}$/.test(row.token_hash), row.token_hash === issued.token], [true, false]);
    check('and it is the digest of the token that was handed out',
      row.token_hash, await sha256(issued.token));
    check('the token itself appears nowhere in the table',
      (await raw`SELECT COUNT(*)::int AS c FROM admin_password_resets
                  WHERE token_hash = ${issued.token}`)[0].c, 0);
    check('the requesting address is recorded', row.requested_ip, '198.51.100.7');
    check('it is unused', row.used_at, null);

    const ttlMin = Math.round(
      (new Date(row.expires_at).getTime() - Date.now()) / 60000);
    check(`it expires in about ${RESET_TTL_MINUTES} minutes`,
      Math.abs(ttlMin - RESET_TTL_MINUTES) <= 1, true);

    check('an unknown address mints nothing', await issueResetToken('nobody@example.com'), null);
    check('and wrote no row',
      (await raw`SELECT COUNT(*)::int AS c FROM admin_password_resets`)[0].c, 1);

    check('the link resolves to the admin it opens', (await resetTarget(issued.token)).id, STAFF);
    check('a token that was never issued resolves to nothing',
      await resetTarget('x'.repeat(43)), null);
    check('and a short one is refused without a query', await resetTarget('short'), null);

    /* --------------------------------------------- single use, and sessions */

    const before = await epochOf(STAFF);
    check('a password the rules refuse does not spend the link',
      (await claimReset(issued.token, 'password123')).reason, 'common');
    check('the link is still live', (await resetTarget(issued.token)) !== null, true);
    check('and nothing was revoked', await epochOf(STAFF), before);

    const done = await claimReset(issued.token, 'a-brand-new-counter-passphrase');
    check('a good password is accepted', [done.ok, done.id], [true, STAFF]);
    check('the new password verifies',
      await bcrypt.compare('a-brand-new-counter-passphrase',
        (await raw`SELECT pass_hash FROM admins WHERE id = ${STAFF}`)[0].pass_hash), true);
    check('the old one does not',
      await bcrypt.compare('a-perfectly-fine-password',
        (await raw`SELECT pass_hash FROM admins WHERE id = ${STAFF}`)[0].pass_hash), false);
    check('the change is dated',
      (await raw`SELECT password_changed_at FROM admins WHERE id = ${STAFF}`)[0].password_changed_at !== null,
      true);
    check('EVERY session that account held is revoked', await epochOf(STAFF), before + 1);

    check('the same link a second time is refused',
      await claimReset(issued.token, 'yet-another-password'), { ok: false, reason: 'invalid' });
    check('and the password did not move again',
      await bcrypt.compare('a-brand-new-counter-passphrase',
        (await raw`SELECT pass_hash FROM admins WHERE id = ${STAFF}`)[0].pass_hash), true);
    check('the row is stamped used rather than deleted',
      (await raw`SELECT used_at IS NOT NULL AS u FROM admin_password_resets
                  WHERE token_hash = ${await sha256(issued.token)}`)[0].u, true);

    /* ------------------------------------------------------------ expiry */

    const stale = await issueResetToken('desk@example.com');
    await raw`
      UPDATE admin_password_resets SET expires_at = now() - interval '1 minute'
       WHERE token_hash = ${await sha256(stale.token)}`;
    check('an expired link resolves to nothing', await resetTarget(stale.token), null);
    check('and cannot be claimed',
      await claimReset(stale.token, 'a-completely-different-password'), { ok: false, reason: 'invalid' });

    /* ------------------------------------------ a new link kills the old */

    const first = await issueResetToken('desk@example.com');
    const second = await issueResetToken('desk@example.com');
    check('asking twice invalidates the older link', await resetTarget(first.token), null);
    check('and the newest one works', (await resetTarget(second.token)) !== null, true);
    check('the old one cannot be claimed either',
      (await claimReset(first.token, 'a-third-good-password')).reason, 'invalid');
  }

  /* ------------------------------------------------------------------ 8 */

  console.log('\n  two requests racing on one reset link');
  {
    const issued = await issueResetToken('desk@example.com');
    const before = await epochOf(STAFF);

    const go = pw => claimReset(issued.token, pw)
      .catch(e => ({ ok: false, threw: String(e?.message || e) }));
    const [a, b] = await Promise.all([go('the-winner-password-a'), go('the-winner-password-b')]);

    check('exactly one of them wins', [a.ok, b.ok].filter(Boolean).length, 1);
    const hash = (await raw`SELECT pass_hash FROM admins WHERE id = ${STAFF}`)[0].pass_hash;
    const which = await Promise.all([
      bcrypt.compare('the-winner-password-a', hash),
      bcrypt.compare('the-winner-password-b', hash),
    ]);
    check('and exactly one password was set', which.filter(Boolean).length, 1);
    check('the epoch moved once, not twice', await epochOf(STAFF), before + 1);
    check('the token is spent',
      (await raw`SELECT COUNT(*)::int AS c FROM admin_password_resets
                  WHERE token_hash = ${await sha256(issued.token)} AND used_at IS NULL`)[0].c, 0);
  }

  /* ------------------------------------------------------------------ 9 */

  console.log('\n  asking for a reset costs the same for a real and a fake address');
  {
    /*
     * The trap app/api/subscribe/route.js documents at length. Identical wording
     * is only half of it: the obvious implementation does a SELECT and then, on
     * a hit, an INSERT, so a hit costs an extra round trip and the latency alone
     * answers "is this address an admin".
     *
     * What is timed is issueResetToken, because that is the only part of the
     * request that behaves differently between the two cases - the two rate
     * limit statements before it and the redirect after it are the same code on
     * both paths, and the mail is sent from after(), outside the response.
     *
     * Samples are interleaved so that a slow patch on the link cannot land
     * entirely on one branch, and medians are compared rather than means so
     * that one outlier does not decide the answer.
     */
    const N = 25;
    const hits = [];
    const misses = [];

    const timed = async addr => {
      const t = process.hrtime.bigint();
      await issueResetToken(addr, '203.0.113.9');
      return Number(process.hrtime.bigint() - t) / 1e6;
    };

    // Warm-up, outside the measurement: the first query on a fresh Neon
    // connection pays for the connection.
    await timed('desk@example.com');
    await timed('nobody-at-all@example.com');

    for (let i = 0; i < N; i++) {
      // Alternate which branch goes first, so ordering cannot bias either one.
      if (i % 2 === 0) {
        hits.push(await timed('desk@example.com'));
        misses.push(await timed('nobody-at-all@example.com'));
      } else {
        misses.push(await timed('nobody-at-all@example.com'));
        hits.push(await timed('desk@example.com'));
      }
    }

    const median = xs => {
      const s = [...xs].sort((a, b) => a - b);
      const m = s.length >> 1;
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };

    const mh = median(hits);
    const mm = median(misses);
    const gap = Math.abs(mh - mm);
    const rel = gap / Math.min(mh, mm);

    note(`hit median   ${mh.toFixed(1)} ms  (n=${N})`);
    note(`miss median  ${mm.toFixed(1)} ms  (n=${N})`);
    note(`difference   ${gap.toFixed(1)} ms  (${(rel * 100).toFixed(1)}% of the smaller)`);

    // The bar: the gap has to be small next to the round trip itself, and
    // smaller than the spread WITHIN either branch - if the two medians are
    // closer together than the samples of one branch are to each other, no
    // number of observations separates them.
    const spread = xs => {
      const s = [...xs].sort((a, b) => a - b);
      return s[Math.floor(s.length * 0.75)] - s[Math.floor(s.length * 0.25)];
    };
    const noise = Math.max(spread(hits), spread(misses));
    note(`branch noise ${noise.toFixed(1)} ms  (interquartile range)`);

    /*
     * Twenty percent of the median, OR inside the branch's own noise —
     * whichever is the more forgiving.
     *
     * The flat percentage on its own is not a statement about the endpoint, it
     * is a statement about the network on the day. This runs against Neon over
     * the public internet: a quiet run puts both medians at ~83 ms and the gap
     * at 0.1 ms, and a noisy one puts them at 141 and 153 with an 85 ms
     * interquartile range inside EACH branch. The second of those failed the
     * 20% bar while carrying no information at all — a gap that is one eighth
     * of the spread of the samples it is drawn from is not a signal, and no
     * number of observations would turn it into one.
     *
     * A check that fails on a third of its runs is a check people learn to
     * re-run rather than read, which is worse than not having it. So the bar
     * is: either the branches are close in absolute terms, or the difference
     * between them is smaller than the variation within one of them. A real
     * leak — a database round trip on one side and not the other — clears both,
     * because it moves the median by more than the jitter it is hiding in.
     */
    const insideNoise = gap <= noise;
    check('the two branches are within 20% of each other, or inside the noise',
      rel < 0.20 || insideNoise, true);
    if (rel >= 0.20 && insideNoise) {
      note(`(the 20% bar was missed at ${(rel * 100).toFixed(1)}%, but ${gap.toFixed(1)} ms`);
      note(` is inside the ${noise.toFixed(1)} ms spread of a single branch - network, not the endpoint)`);
    }
    check('and the gap is lost inside the noise of a single branch', gap <= noise, true);

    // The other half of the property - that the two answers are the same words
    // - is held by tests/admin-accounts.test.mjs, which pins the forgot screen
    // to exactly one success redirect reached from both branches. It is checked
    // there rather than here because it is a fact about the source, and a
    // source fact is better proved by reading the source than by a database.
    check('a miss still returns nothing at all', await issueResetToken('nobody-at-all@example.com'), null);
  }

  /* ----------------------------------------------------------------- 10 */

  console.log('\n  removing an account takes its credentials with it');
  {
    const doomed = await createAdmin(OWNER, {
      email: 'leaving@example.com', password: 'a-perfectly-fine-password',
    });
    const ID = doomed.id;
    await issueResetToken('leaving@example.com');
    await raw`INSERT INTO admin_recovery_codes (admin_id, code_hash) VALUES (${ID}, ${'a'.repeat(64)})`;

    check('the account has a live reset link and a recovery code', [
      Number((await raw`SELECT COUNT(*)::int AS c FROM admin_password_resets WHERE admin_id = ${ID}`)[0].c),
      Number((await raw`SELECT COUNT(*)::int AS c FROM admin_recovery_codes WHERE admin_id = ${ID}`)[0].c),
    ], [1, 1]);

    check('removed', (await removeAdmin(OWNER, ID)).ok, true);
    check('the row is gone', await adminById(ID), null);
    check('and so is every credential into it', [
      Number((await raw`SELECT COUNT(*)::int AS c FROM admin_password_resets WHERE admin_id = ${ID}`)[0].c),
      Number((await raw`SELECT COUNT(*)::int AS c FROM admin_recovery_codes WHERE admin_id = ${ID}`)[0].c),
    ], [0, 0]);

    check('removing an account that is already gone says so',
      await removeAdmin(OWNER, ID), { ok: false, reason: 'not-found' });
  }

  /* ----------------------------------------------------------------- 11 */

  console.log('\n  the accounts screen sees what it needs to');
  {
    const rows = await listAdmins();
    check('one row per admin', rows.length, await countAdmins());
    const owner = rows.find(r => r.id === OWNER);
    check('roles, suspension and two-factor are all there',
      [owner.role, owner.suspended, owner.twoFactor, typeof owner.recoveryLeft],
      ['owner', false, false, 'number']);
    check('and no password hash is anywhere in what it returns',
      JSON.stringify(rows).includes('$2'), false);
  }

  /* ----------------------------------------------------------------- 12 */

  console.log('\n  the schema is safe to re-run, which is what every deploy does');
  {
    for (const stmt of statements) await db(stmt);
    check('a second pass changes nothing about the roles',
      [await countAdmins(), await activeOwners(), await roleOf(STAFF)],
      [await countAdmins(), 1, 'staff']);
    check('and the owner promotion did not fire again', await roleOf(OWNER), 'owner');
  }

} finally {
  await admin(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
  console.log(`\n  dropped ${DB}`);
}

console.log(failures ? `\n  ${failures} FAILURE(S)\n` : '\n  all checks passed\n');
process.exit(failures ? 1 : 0);
