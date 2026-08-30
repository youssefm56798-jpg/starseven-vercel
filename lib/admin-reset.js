import bcrypt from 'bcryptjs';
import { sql } from './db.js';
import { site } from './config.js';
import { bumpSessionEpoch } from './session-epoch.js';
import { normaliseEmail, passwordProblem, BCRYPT_COST } from './credentials.js';
import { newAccessToken, sha256 } from './order-access.js';

/**
 * The way back in when the admin password is gone.
 *
 * Before this, recovery meant opening the Neon console and pasting a bcrypt
 * hash over the column by hand. That is not a procedure, it is a reason to pick
 * a password you can remember - and with staff accounts there is now more than
 * one person who can forget one.
 *
 * Free of next/* on purpose, like lib/admin-accounts.js and for the same
 * reason: scripts/verify-admin-accounts.mjs proves the statements below against
 * a real Postgres, and it cannot load a module that only the Next bundler can
 * resolve.
 *
 * ---------------------------------------------------------------------------
 * The token
 *
 * 32 random bytes, and what is stored is its SHA-256. The token exists in one
 * email and nowhere else - not in the database, not in a log - so a dump of
 * admin_password_resets is not a way into the panel. Identical discipline to
 * orders.access_hash and admin_recovery_codes, and the helpers are literally
 * the ones lib/order-access.js already uses rather than a second copy of them.
 *
 * Single use is the WHERE clause of the UPDATE that spends it:
 *
 *   used_at IS NULL AND expires_at > now()
 *
 * never a SELECT that checks and an UPDATE that then writes. Two requests
 * arriving together on one link can only have one winner, because Postgres
 * re-evaluates the condition against the row as the other transaction left it.
 * Written the other way, both would see an unused token and both would set a
 * password - and the second one would win, which is a stranger who intercepted
 * a link getting the account instead of the person who asked for it.
 *
 * ---------------------------------------------------------------------------
 * Not telling a stranger whether an address is an admin
 *
 * /admin/forgot takes an email from anybody at all. It must answer the same
 * way for an address that is an admin and one that is not, and app/api/subscribe
 * documents at length why answering with the same WORDS is only half of it: the
 * obvious implementation does a SELECT, and then on a hit does an INSERT and a
 * send, so a hit costs more round trips than a miss and the latency alone is a
 * reliable oracle for which addresses can get into the shop admin.
 *
 * So issueResetToken() is ONE statement, exactly as issueRecoveryToken() in
 * lib/order-access.js is. The lookup, the invalidation of any older live link
 * and the mint are three CTEs of one query, the mint is a data-modifying CTE
 * fed by the lookup, and a data-modifying CTE runs to completion whether or not
 * the outer query reads it. The bytes sent are identical either way and so is
 * the plan; what differs between a hit and a miss is one row inserted inside a
 * statement that was already in flight.
 *
 * The mail is sent by the caller from after(), so the Resend round trip is not
 * in the response path either.
 *
 * ---------------------------------------------------------------------------
 * What a reset does NOT do
 *
 * It does not turn the second factor off, and it must never learn how. A reset
 * link is a credential delivered to a mailbox; if it also cleared TOTP then
 * anybody who reached that mailbox would be past both factors at once, and the
 * second factor would be protecting nothing against the one attacker it exists
 * for. Somebody who has lost the phone as well uses a recovery code, which is
 * what recovery codes are.
 */

/**
 * How long a reset link lives.
 *
 * Deliberately far shorter than the thirty days an order link gets. An order
 * link is a credential for one order that a customer is meant to keep; this one
 * grants an identity, and the mailbox it lands in is the whole of its security.
 * Thirty minutes is long enough to walk to a desk and short enough that a link
 * found in an old mail is already dead.
 */
export const RESET_TTL_MINUTES = 30;

/** The link that goes in the email. Admin is English-only, so no locale. */
export const resetUrl = token =>
  `${site.url.replace(/\/$/, '')}/admin/reset?t=${encodeURIComponent(token)}`;

/**
 * Mint a reset link for an address, if it belongs to an admin who can use it.
 *
 * Returns { admin, token } on a hit and null on a miss. The CALLER must send
 * the same response either way - see app/admin/(auth)/forgot/page.js, which has
 * one redirect and reaches it from both branches.
 *
 * Suspended admins are excluded from the lookup rather than filtered after it.
 * A suspended account is one the owner has deliberately shut, and a reset link
 * that reopened it would make suspension a suggestion.
 */
export async function issueResetToken(email, ip = '') {
  const addr = normaliseEmail(email);
  if (!addr || addr.length > 254) return null;

  const token = newAccessToken();
  const digest = await sha256(token);

  const rows = await sql`
    WITH hit AS (
      SELECT id, email, name
        FROM admins
       WHERE lower(email) = ${addr} AND suspended_at IS NULL
       LIMIT 1
    ), spent AS (
      UPDATE admin_password_resets r
         SET used_at = now()
       WHERE r.admin_id = (SELECT id FROM hit)
         AND r.used_at IS NULL
      RETURNING r.id
    ), minted AS (
      INSERT INTO admin_password_resets (admin_id, token_hash, expires_at, requested_ip)
      SELECT id, ${digest}::text,
             now() + (${String(RESET_TTL_MINUTES)} || ' minutes')::interval,
             ${String(ip).slice(0, 64)}::text
        FROM hit
      RETURNING id
    )
    SELECT id, email, name FROM hit`;

  const admin = rows[0];
  if (!admin) return null;
  return { admin: { id: Number(admin.id), email: admin.email, name: admin.name }, token };
}

/**
 * The admin a live link belongs to, or null. Read-only.
 *
 * Used by the reset screen to decide whether to render a form, and by the
 * action to get the address that lib/credentials.js needs in order to refuse a
 * password containing it. It decides nothing about whether the token may be
 * spent - claimReset does that, in one guarded statement, and this read has no
 * vote.
 */
export async function resetTarget(token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const rows = await sql`
    SELECT a.id, a.email, a.name
      FROM admin_password_resets r
      JOIN admins a ON a.id = r.admin_id
     WHERE r.token_hash = ${await sha256(token)}
       AND r.used_at IS NULL
       AND r.expires_at > now()
       AND a.suspended_at IS NULL
     LIMIT 1`;
  const a = rows[0];
  return a ? { id: Number(a.id), email: a.email, name: a.name } : null;
}

/**
 * Spend the link and set the password.
 *
 * The password rules are checked BEFORE the token is claimed, so somebody who
 * types a password the shop will not accept still holds a working link. The
 * check needs the address, which is why resetTarget() runs first - and the
 * claim below does not trust a word of what it found.
 *
 * The claim and the password write are one statement, so there is no state in
 * which a link has been spent and the password has not moved. The session
 * revocation is the statement after it, and it goes through
 * lib/session-epoch.js rather than adding session_epoch to the UPDATE above:
 * that module is the only writer of the epoch, tests/admin-security.test.mjs
 * holds that line, and it is the only thing that also invalidates the cached
 * copy in lib/auth.js. Bumping the column without invalidating the cache is a
 * revocation that appears to work and then does not, for up to a minute.
 *
 * Revoking is not optional here and it is the point of the whole feature: a
 * password is reset because it may be in somebody else hands, and the sessions
 * that hand already holds are what has to go.
 */
export async function claimReset(token, newPassword) {
  const target = await resetTarget(token);
  if (!target) return { ok: false, reason: 'invalid' };

  const problem = passwordProblem(newPassword, target.email);
  if (problem) return { ok: false, reason: problem };

  const hash = await bcrypt.hash(String(newPassword), BCRYPT_COST);

  const rows = await sql`
    WITH claimed AS (
      UPDATE admin_password_resets
         SET used_at = now()
       WHERE token_hash = ${await sha256(token)}
         AND used_at IS NULL
         AND expires_at > now()
      RETURNING admin_id
    )
    UPDATE admins a
       SET pass_hash = ${hash}, password_changed_at = now()
      FROM claimed c
     WHERE a.id = c.admin_id
       AND a.suspended_at IS NULL
    RETURNING a.id, a.email`;

  // No row means the token was spent between resetTarget and here - by the
  // other half of a race, or by a second tab. Refused, and it says the same
  // thing a stale link says, because that is what it now is.
  if (!rows.length) return { ok: false, reason: 'invalid' };

  const id = Number(rows[0].id);
  await bumpSessionEpoch(id);
  return { ok: true, id, email: rows[0].email };
}
