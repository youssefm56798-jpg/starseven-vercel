import bcrypt from 'bcryptjs';
import { sql } from './db.js';
import { bumpSessionEpoch } from './session-epoch.js';
import { cleanName, normaliseEmail, emailProblem, passwordProblem, BCRYPT_COST } from './credentials.js';
import { can, cleanRole, DEFAULT_ROLE } from './admin-roles.js';

/**
 * Creating, suspending and removing admin accounts.
 *
 * Everything that writes another admin row lives here, the same way
 * lib/admin-security.js owns everything that writes your own. Kept free of
 * next/headers and next/navigation on purpose, exactly as lib/session-epoch.js
 * is and for the same reason: scripts/verify-admin-accounts.mjs is how the
 * guarded statements below are proved against a real Postgres, and a module
 * that only the Next bundler can load cannot be proved against anything.
 *
 * ---------------------------------------------------------------------------
 * The permission check is in here, not only in the Server Action
 *
 * app/admin/_lib/account-actions.js calls requireOwner() before any of these,
 * and that check is real. It is also not the only one, because it is the one
 * that a future action, a future route handler or a copy-paste can forget. So
 * every function here takes the id of the admin doing the asking and re-reads
 * that admin ROLE FROM THE DATABASE before it writes anything.
 *
 * Re-reads, rather than trusting a role handed in by the caller: the session
 * cookie is a signed JWT and the role in it would be whatever was true when it
 * was minted. An admin demoted five minutes ago must not still be able to
 * create accounts because their cookie says owner. Reading the row is one
 * indexed lookup on a table with a handful of rows in it, and it is the
 * difference between an authorisation check and a decoration.
 *
 * ---------------------------------------------------------------------------
 * The last owner
 *
 * The entire point of this feature is that the shop does not get locked out of
 * its own admin. So the last owner cannot be demoted, cannot be suspended and
 * cannot be deleted, and that is enforced by the WHERE clause of the statement
 * that would do it - never by a SELECT followed by an UPDATE.
 *
 * The guard is not simply "is there another owner", because that answer read
 * from a snapshot is wrong under concurrency in a way that is easy to miss.
 * Two owners, and two requests demoting one each: both statements look up the
 * other owner, both find one, both succeed, and the shop is left with zero
 * owners and no way back. It is textbook write skew - the rows being read are
 * not the rows being written, so nothing collides.
 *
 * What closes it is the `owners` CTE below, which takes FOR UPDATE over every
 * active owner row in id order before the decision is made. The second request
 * blocks on the row the first one holds; when it unblocks, Postgres re-checks
 * that row against the CTE WHERE clause as the first request LEFT it, sees it
 * is no longer an owner, and drops it from the set. The count is then honest
 * and the second demotion is refused. Locking in id order is what stops two
 * requests taking the same two locks in opposite orders and deadlocking.
 *
 * scripts/verify-admin-accounts.mjs runs exactly that race.
 */

/** The columns the accounts screen renders, for every admin. */
export async function listAdmins() {
  const rows = await sql`
    SELECT a.id, a.email, a.name, a.role, a.suspended_at, a.last_login,
           a.created_at, a.created_by, a.password_changed_at,
           a.totp_enrolled_at IS NOT NULL AS two_factor,
           (SELECT COUNT(*)::int FROM admin_recovery_codes r
             WHERE r.admin_id = a.id AND r.used_at IS NULL) AS recovery_left
      FROM admins a
     ORDER BY a.id`;

  return rows.map(a => ({
    id: Number(a.id),
    email: a.email,
    name: a.name,
    role: a.role,
    suspended: a.suspended_at !== null,
    suspendedAt: a.suspended_at,
    lastLogin: a.last_login,
    createdAt: a.created_at,
    createdBy: a.created_by === null ? null : Number(a.created_by),
    passwordChangedAt: a.password_changed_at,
    twoFactor: Boolean(a.two_factor),
    recoveryLeft: Number(a.recovery_left),
  }));
}

/** One admin, or null. Only ever used to explain why a guarded write matched nothing. */
export async function adminById(id) {
  const rows = await sql`
    SELECT id, email, name, role, suspended_at FROM admins WHERE id = ${Number(id)}`;
  const a = rows[0];
  return a ? { id: Number(a.id), email: a.email, name: a.name, role: a.role, suspended: a.suspended_at !== null } : null;
}

/**
 * The role of the admin doing the asking, read fresh, or null if that admin has
 * been removed or suspended since the cookie was minted.
 */
async function actorRole(actorId) {
  const id = Number(actorId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const rows = await sql`
    SELECT role FROM admins WHERE id = ${id} AND suspended_at IS NULL`;
  return rows[0]?.role ?? null;
}

/** Refuses unless the asker is currently allowed to manage accounts. */
async function mayManage(actorId) {
  return can(await actorRole(actorId), 'accounts:manage');
}

/* ------------------------------------------------------------------ create */

/**
 * A new admin.
 *
 * The password is set by the owner here rather than mailed as an invite link,
 * and that is a considered trade rather than the lazy option. An invite makes
 * the account unusable when the mail bounces or Resend is misconfigured, which
 * on a two-person shop means the person is standing next to the owner unable to
 * log in. Handing the password over in the room and having them change it is
 * both simpler and more reliable, and the reset link below exists for the case
 * where they are not in the room.
 *
 * The password goes through lib/credentials.js, which is where every other
 * password on this site is judged - including the rule that it may not contain
 * the address it belongs to.
 */
export async function createAdmin(actorId, { email, password, name = '', role = DEFAULT_ROLE } = {}) {
  if (!(await mayManage(actorId))) return { ok: false, reason: 'forbidden' };

  const addr = normaliseEmail(email);
  const emailBad = emailProblem(addr);
  if (emailBad) return { ok: false, reason: 'bad-email' };

  const wanted = cleanRole(role);
  if (!wanted) return { ok: false, reason: 'bad-role' };

  const pwBad = passwordProblem(password, addr);
  if (pwBad) return { ok: false, reason: pwBad };

  const rows = await sql`
    INSERT INTO admins (email, pass_hash, name, role, created_by)
    VALUES (${addr}, ${await bcrypt.hash(String(password), BCRYPT_COST)},
            ${cleanName(name)}, ${wanted}, ${Number(actorId)})
    ON CONFLICT (email) DO NOTHING
    RETURNING id`;

  if (!rows.length) return { ok: false, reason: 'duplicate' };
  return { ok: true, id: Number(rows[0].id), role: wanted, email: addr };
}

/* -------------------------------------------------------------------- role */

/**
 * Promote or demote.
 *
 * Demoting the last owner is refused by the statement, not by this function.
 * See the note at the top for why the guard is a locking CTE rather than a
 * count.
 *
 * A successful change revokes every session the target holds. That is not
 * housekeeping: lib/auth.js caches the role alongside the session epoch, and
 * bumping the epoch is what makes the new role take effect now rather than
 * within a minute. It also means a demoted admin has to sign in again, which is
 * the honest thing to do to somebody whose access just changed.
 */
export async function setAdminRole(actorId, targetId, role) {
  if (!(await mayManage(actorId))) return { ok: false, reason: 'forbidden' };

  const id = Number(targetId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, reason: 'not-found' };
  if (id === Number(actorId)) return { ok: false, reason: 'self' };

  const wanted = cleanRole(role);
  if (!wanted) return { ok: false, reason: 'bad-role' };

  const rows = await sql`
    WITH owners AS (
      SELECT id FROM admins
       WHERE role = 'owner' AND suspended_at IS NULL
       ORDER BY id
         FOR UPDATE
    )
    UPDATE admins a
       SET role = ${wanted}
     WHERE a.id = ${id}
       AND (${wanted}::text = 'owner'
            OR a.role <> 'owner'
            OR EXISTS (SELECT 1 FROM owners o WHERE o.id <> ${id}))
    RETURNING a.id`;

  if (!rows.length) return { ok: false, reason: await whyNot(id) };

  await bumpSessionEpoch(id);
  return { ok: true, role: wanted };
}

/* --------------------------------------------------------------- suspend */

/**
 * Suspend or restore.
 *
 * Suspension is the reversible half of removal, and it is what a shop actually
 * wants the day somebody leaves: the login stops working immediately, the row
 * stays, and every order_events entry naming that admin still resolves to a
 * person. Deleting on the way out of the door would leave the audit trail
 * pointing at an id that no longer means anything.
 *
 * Suspending revokes on the spot rather than waiting for the eight-hour session
 * to run out, which is the whole reason lib/session-epoch.js exists. lib/auth.js
 * additionally refuses to resolve a session for a suspended row, so the two
 * mechanisms have to both fail before a suspended admin sees a screen.
 */
export async function setAdminSuspended(actorId, targetId, suspended) {
  if (!(await mayManage(actorId))) return { ok: false, reason: 'forbidden' };

  const id = Number(targetId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, reason: 'not-found' };
  if (id === Number(actorId)) return { ok: false, reason: 'self' };

  if (!suspended) {
    const back = await sql`
      UPDATE admins SET suspended_at = NULL WHERE id = ${id} RETURNING id`;
    if (!back.length) return { ok: false, reason: 'not-found' };
    return { ok: true, suspended: false };
  }

  const rows = await sql`
    WITH owners AS (
      SELECT id FROM admins
       WHERE role = 'owner' AND suspended_at IS NULL
       ORDER BY id
         FOR UPDATE
    )
    UPDATE admins a
       SET suspended_at = COALESCE(a.suspended_at, now())
     WHERE a.id = ${id}
       AND (a.role <> 'owner'
            OR EXISTS (SELECT 1 FROM owners o WHERE o.id <> ${id}))
    RETURNING a.id`;

  if (!rows.length) return { ok: false, reason: await whyNot(id) };

  await bumpSessionEpoch(id);
  return { ok: true, suspended: true };
}

/* ---------------------------------------------------------------- remove */

/**
 * Delete the row.
 *
 * The recovery codes and any live reset link go with it, by ON DELETE CASCADE,
 * because a credential into an account that no longer exists is a loose end
 * nobody would think to sweep. order_events keeps its rows and keeps naming the
 * id: the actor column is free text precisely so that it does not have to point
 * at a row that is still there.
 */
export async function removeAdmin(actorId, targetId) {
  if (!(await mayManage(actorId))) return { ok: false, reason: 'forbidden' };

  const id = Number(targetId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, reason: 'not-found' };
  if (id === Number(actorId)) return { ok: false, reason: 'self' };

  const rows = await sql`
    WITH owners AS (
      SELECT id FROM admins
       WHERE role = 'owner' AND suspended_at IS NULL
       ORDER BY id
         FOR UPDATE
    )
    DELETE FROM admins a
     WHERE a.id = ${id}
       AND (a.role <> 'owner'
            OR EXISTS (SELECT 1 FROM owners o WHERE o.id <> ${id}))
    RETURNING a.id, a.email`;

  if (!rows.length) return { ok: false, reason: await whyNot(id) };
  return { ok: true, email: rows[0].email };
}

/**
 * Why a guarded write matched no row.
 *
 * Only ever reached on the failure path, and only to choose a message. The
 * guard has already decided; this does not get a vote.
 */
async function whyNot(id) {
  const target = await adminById(id);
  if (!target) return 'not-found';
  return target.role === 'owner' ? 'last-owner' : 'not-found';
}
