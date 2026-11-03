import { sql } from './db.js';

/**
 * The one number that can kill an admin session, and the one statement that
 * moves it.
 *
 * This is three lines of SQL in a file of its own, which needs justifying.
 *
 * lib/auth.js is where the epoch is READ and checked, and it cannot avoid
 * importing next/headers to get at the cookie. lib/admin-security.js is where
 * the epoch is BUMPED - changing a password and turning two-factor off both
 * have to revoke, and they have to do it themselves rather than trusting each
 * caller to remember. If the bump lived in auth.js, admin-security would import
 * it and inherit next/headers, and neither module could then be loaded outside
 * the Next bundler: `next/headers` and `next/cache` are both unresolvable to
 * plain Node ESM.
 *
 * That matters because scripts/verify-admin-auth.mjs is how the guarded UPDATEs
 * in admin-security are proved against a real Postgres, and a module that can
 * only be loaded by a running Next server cannot be proved against anything.
 * Splitting the write out is what keeps that verifiable.
 *
 * The cache invalidation below is a dynamic import inside a try, for the same
 * reason and with a second benefit: the revocation is already committed by the
 * time it runs, so a failure to invalidate must not throw away a revocation
 * that has happened. Worst case the cached epoch stays stale for the rest of
 * its window, which is a minute, rather than the eight hours the session would
 * otherwise have had.
 */

/** The Next data-cache tag holding one admin session epoch. */
export const epochTag = id => `s7-admin-epoch-${Number(id)}`;

/**
 * End every session this admin holds. Returns the new epoch, or null if there
 * is no such admin.
 *
 * The caller gets the new value back so that an action which should keep the
 * current browser signed in - changing a password, which must not eject the
 * person typing it - can mint a fresh token without a second read.
 */
export async function bumpSessionEpoch(adminId) {
  const id = Number(adminId);
  const rows = await sql`
    UPDATE admins SET session_epoch = session_epoch + 1
     WHERE id = ${id}
    RETURNING session_epoch`;
  if (!rows.length) return null;

  await invalidateEpoch(id);
  return Number(rows[0].session_epoch);
}

/**
 * Claim a live reset and change its password and epoch in one statement.
 * Keeping these writes together prevents a failed revocation query from leaving
 * a changed password, a spent reset link and still-valid existing sessions.
 * The caller has already checked the password rules and passes only a digest
 * and a bcrypt hash. This module remains the only writer of session_epoch.
 */
export async function claimResetAndRevoke(tokenHash, passwordHash) {
  const rows = await sql`
    WITH claimed AS (
      UPDATE admin_password_resets
         SET used_at = now()
       WHERE token_hash = ${tokenHash}
         AND used_at IS NULL
         AND expires_at > now()
      RETURNING admin_id
    )
    UPDATE admins a
       SET pass_hash = ${passwordHash}, password_changed_at = now(),
           session_epoch = a.session_epoch + 1
      FROM claimed c
     WHERE a.id = c.admin_id
       AND a.suspended_at IS NULL
    RETURNING a.id, a.email`;
  if (!rows.length) return null;

  const row = rows[0];
  await invalidateEpoch(Number(row.id));
  return { id: Number(row.id), email: row.email };
}

async function invalidateEpoch(id) {
  // The row is the authority; this only stops the cache serving the old value.
  // Done after the write, never before: invalidating first would leave a window
  // in which the cache could refill from a row that has not been bumped yet.
  try {
    const { revalidateTag } = await import('next/cache');
    revalidateTag(epochTag(id));
  } catch (e) {
    console.error('[s7] session epoch cache not invalidated:', e?.message || e);
  }
}
