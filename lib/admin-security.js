import bcrypt from 'bcryptjs';
import { sql } from './db.js';
import { bumpSessionEpoch } from './session-epoch.js';
import { passwordProblem, BCRYPT_COST } from './credentials.js';
import {
  newRecoveryCodes,
  newSecret,
  openSecret,
  otpauthUri,
  readableSecret,
  recoveryHash,
  sealSecret,
  verifyTotp,
} from './totp.js';

/**
 * Everything that writes the admins row for a security reason, in one file.
 *
 * The screens call these and do not second-guess them, the same arrangement
 * lib/credentials.js has with the checkout: one place answers "is this
 * password acceptable", one place answers "is this second factor real". A
 * screen that reimplements either has its own opinion, and two opinions about
 * whether a code has already been used is how a one-time code becomes a
 * two-time code.
 *
 * ---------------------------------------------------------------------------
 * Single use, without an interactive transaction
 *
 * Neon over HTTP cannot BEGIN, read, decide in JavaScript and then write — the
 * same constraint lib/order-status.js is shaped around, and the same answer
 * applies. Both single-use guarantees here are the WHERE clause of the UPDATE
 * that claims the thing, never a SELECT followed by an UPDATE:
 *
 *   a TOTP code    UPDATE ... SET totp_last_step = $step WHERE totp_last_step < $step
 *   a recovery code UPDATE ... SET used_at = now() WHERE used_at IS NULL
 *
 * In both cases a second attempt matches no row and is refused, and two
 * attempts arriving together can only have one winner because Postgres
 * re-evaluates the condition against the row as the other transaction left it.
 * Written as a read and then a write, two submissions of the same recovery code
 * a few milliseconds apart would both see it unused and both be let in — which
 * is the entire failure mode a one-time code exists to prevent.
 */

/** The parts of an admin row the security screen renders. */
export async function securityFor(adminId) {
  const id = Number(adminId);
  const rows = await sql`
    SELECT a.id, a.email, a.name, a.totp_enrolled_at, a.password_changed_at,
           a.totp_pending <> '' AS enrolling,
           (SELECT COUNT(*)::int FROM admin_recovery_codes r
             WHERE r.admin_id = a.id AND r.used_at IS NULL) AS recovery_left
      FROM admins a
     WHERE a.id = ${id}`;

  const a = rows[0];
  if (!a) return null;
  return {
    id: Number(a.id),
    email: a.email,
    name: a.name,
    enrolled: a.totp_enrolled_at !== null,
    enrolledAt: a.totp_enrolled_at,
    enrolling: Boolean(a.enrolling),
    recoveryLeft: Number(a.recovery_left),
    passwordChangedAt: a.password_changed_at,
  };
}

/**
 * Start enrolment: mint a secret, store it sealed in totp_pending, hand the
 * plaintext back once so it can be shown.
 *
 * Pending rather than live, because an enrolment that is abandoned halfway —
 * the browser closed, the phone out of battery — must not leave an admin unable
 * to sign in with a secret nothing holds. Nothing changes about how this admin
 * logs in until a code proves the phone and this module has actually seen it.
 *
 * Re-running this replaces any half-finished enrolment, which is what somebody
 * pressing the button twice means. It deliberately does NOT touch a live
 * secret: an enrolled admin who starts a second enrolment and walks away still
 * has the first one working.
 */
export async function beginEnrolment(adminId) {
  const id = Number(adminId);
  const secret = newSecret();
  const rows = await sql`
    UPDATE admins SET totp_pending = ${await sealSecret(secret)}
     WHERE id = ${id}
    RETURNING email`;
  if (!rows.length) return null;

  return {
    secret,
    readable: readableSecret(secret),
    uri: otpauthUri(secret, rows[0].email),
  };
}

/**
 * Finish enrolment: the code proves the phone holds the pending secret, so
 * promote it and issue the recovery codes.
 *
 * The codes are returned in the clear exactly once, here. What lands in the
 * table is a SHA-256 of each, so this return value is the only moment they
 * exist anywhere readable — which is why the screen shows them on a page the
 * admin has to acknowledge rather than in a flash message that a refresh eats.
 *
 * The promotion is guarded on totp_pending still being the value that was
 * verified. Two tabs finishing enrolment at once would otherwise each promote
 * their own secret and issue their own recovery set, and whichever lost would
 * have shown its owner ten codes that no longer work.
 */
export async function confirmEnrolment(adminId, code) {
  const id = Number(adminId);
  const rows = await sql`SELECT totp_pending FROM admins WHERE id = ${id}`;
  const sealed = rows[0]?.totp_pending || '';
  if (!sealed) return { ok: false, reason: 'not-started' };

  const secret = await openSecret(sealed);
  if (!secret) return { ok: false, reason: 'not-started' };

  const step = await verifyTotp(secret, code);
  if (step === null) return { ok: false, reason: 'bad-code' };

  const promoted = await sql`
    UPDATE admins
       SET totp_secret = ${sealed},
           totp_pending = '',
           totp_enrolled_at = now(),
           totp_last_step = ${step}
     WHERE id = ${id} AND totp_pending = ${sealed}
    RETURNING id`;
  if (!promoted.length) return { ok: false, reason: 'not-started' };

  return { ok: true, codes: await issueRecoveryCodes(id) };
}

/**
 * Ten fresh codes, replacing whatever was there.
 *
 * The delete and the insert are one batch. Neon has no interactive
 * transaction, so a batch is the strongest thing available, and it is the right
 * strength here: the failure to avoid is the delete landing and the insert not,
 * which would leave an admin with a phone, no codes, and no idea.
 */
async function issueRecoveryCodes(adminId) {
  const id = Number(adminId);
  const codes = newRecoveryCodes();
  const hashes = await Promise.all(codes.map(recoveryHash));

  await sql.transaction([
    sql`DELETE FROM admin_recovery_codes WHERE admin_id = ${id}`,
    sql`
      INSERT INTO admin_recovery_codes (admin_id, code_hash)
      SELECT ${id}::int, h FROM unnest(${hashes}::text[]) AS h`,
  ]);

  return codes;
}

/** Regenerating from the security screen. Same thing, said out loud. */
export async function regenerateRecoveryCodes(adminId) {
  return issueRecoveryCodes(adminId);
}

/**
 * Check a second factor at sign-in: a six-digit code, or one recovery code.
 *
 * Which one it is decides itself by shape, so there is no radio button to get
 * wrong and no way to probe which kind an admin has. Both paths answer with the
 * same { ok: false } on failure.
 *
 * Returns `via` so the caller can say something useful about a recovery code
 * having been spent. Nothing branches on it for access.
 *
 * One consequence worth stating, because it is the thing that stops a rotated
 * SESSION_SECRET being a lockout: the TOTP branch needs the secret to open, and
 * a rotated key means it will not. A recovery code is a plain SHA-256 and does
 * not depend on that key at all, so it still works. The way back from a key
 * rotation is a recovery code and then a fresh enrolment.
 */
export async function verifySecondFactor(adminId, input) {
  const id = Number(adminId);
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false };

  const rows = await sql`
    SELECT totp_secret, totp_last_step, totp_enrolled_at FROM admins WHERE id = ${id}`;
  const row = rows[0];
  if (!row || row.totp_enrolled_at === null) return { ok: false };

  // Six digits, once any spacing an app displays is taken off: a TOTP code.
  if (/^\d[\d\s]*$/.test(raw) && raw.replace(/\D/g, '').length === 6) {
    const secret = await openSecret(row.totp_secret);
    if (!secret) return { ok: false };

    const step = await verifyTotp(secret, raw, { after: Number(row.totp_last_step || 0) });
    if (step === null) return { ok: false };

    // The claim. A code that has already been spent — including by a second
    // request racing this one — matches nothing here and is refused, which is
    // what makes it one-time rather than valid-for-ninety-seconds.
    const claimed = await sql`
      UPDATE admins SET totp_last_step = ${step}
       WHERE id = ${id} AND totp_last_step < ${step}
      RETURNING id`;
    if (!claimed.length) return { ok: false };

    return { ok: true, via: 'totp' };
  }

  // Anything else is treated as a recovery code. Looked up by digest and by
  // admin: a digest alone would be enough, but matching the admin as well means
  // a code cannot open an account it was not issued for even if the unique
  // index on the digest were ever relaxed.
  const claimed = await sql`
    UPDATE admin_recovery_codes
       SET used_at = now()
     WHERE admin_id = ${id}
       AND code_hash = ${await recoveryHash(raw)}
       AND used_at IS NULL
    RETURNING id`;
  if (!claimed.length) return { ok: false };

  const left = await sql`
    SELECT COUNT(*)::int AS c FROM admin_recovery_codes
     WHERE admin_id = ${id} AND used_at IS NULL`;
  return { ok: true, via: 'recovery', left: Number(left[0]?.c ?? 0) };
}

/**
 * Turn the second factor off.
 *
 * Everything goes: the secret, any half-finished enrolment, the recovery codes,
 * and the replay watermark. Leaving stale recovery codes behind would mean an
 * admin who re-enrols later inherits codes printed out months ago by whoever
 * had the account then.
 *
 * Every session is revoked as well. Disabling two-factor is a downgrade in how
 * hard this account is to reach, and if it was done by somebody who should not
 * have been able to do it, the sessions they hold are what to take away.
 */
export async function disableTotp(adminId) {
  const id = Number(adminId);
  await sql.transaction([
    sql`
      UPDATE admins
         SET totp_secret = '', totp_pending = '',
             totp_enrolled_at = NULL, totp_last_step = 0
       WHERE id = ${id}`,
    sql`DELETE FROM admin_recovery_codes WHERE admin_id = ${id}`,
  ]);
  return bumpSessionEpoch(id);
}

/** Abandon a half-finished enrolment without touching a live one. */
export async function cancelEnrolment(adminId) {
  await sql`UPDATE admins SET totp_pending = '' WHERE id = ${Number(adminId)}`;
}

/**
 * Change the password.
 *
 * The current one is required, and that is not ceremony: without it, an
 * unattended session or any CSRF that slips past both locks becomes a
 * permanent takeover rather than a temporary one.
 *
 * The rules come from lib/credentials.js, which is where "is this password
 * acceptable" is already answered for the rest of the site — including the
 * check that it does not contain the email address, which is the mistake real
 * people actually make.
 *
 * On success every session is revoked and the new epoch is handed back, so the
 * caller can mint a fresh cookie for the browser doing the typing. Changing a
 * password should end the sessions somebody else has; it should not eject the
 * person who changed it.
 */
export async function changePassword(adminId, current, next) {
  const id = Number(adminId);
  const rows = await sql`SELECT email, pass_hash, name FROM admins WHERE id = ${id}`;
  const admin = rows[0];
  if (!admin) return { ok: false, reason: 'not-found' };

  if (!(await bcrypt.compare(String(current ?? ''), admin.pass_hash))) {
    return { ok: false, reason: 'wrong-password' };
  }

  const problem = passwordProblem(next, admin.email);
  if (problem) return { ok: false, reason: problem };

  if (await bcrypt.compare(String(next), admin.pass_hash)) {
    return { ok: false, reason: 'unchanged' };
  }

  await sql`
    UPDATE admins
       SET pass_hash = ${await bcrypt.hash(String(next), BCRYPT_COST)},
           password_changed_at = now()
     WHERE id = ${id}`;

  const epoch = await bumpSessionEpoch(id);
  return { ok: true, epoch, admin: { id, name: admin.name || admin.email } };
}
