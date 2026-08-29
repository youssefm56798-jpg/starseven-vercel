'use server';

import bcrypt from 'bcryptjs';
import { redirect } from 'next/navigation';
import { createSession, csrfOk, destroySession, revokeSessions } from '../../../lib/auth.js';
import { rateOk, sql } from '../../../lib/db.js';
import { limits } from '../../../lib/config.js';
import {
  beginEnrolment,
  cancelEnrolment,
  changePassword,
  confirmEnrolment,
  disableTotp,
  regenerateRecoveryCodes,
} from '../../../lib/admin-security.js';
import { requireAdmin } from './guard.js';

/**
 * The security screen writes to the admins row, so it gets its own actions
 * file rather than living inside the page.
 *
 * Two shapes in here, on purpose. The plain form actions redirect with a flash
 * code, exactly like the rest of the panel. The two that mint recovery codes
 * return them instead, and are called from a client component - because a
 * redirect cannot carry ten secrets and the alternatives all mean writing them
 * down somewhere. Putting them in a cookie so the next render could read them
 * would be storing the plaintext of the very thing that is deliberately only
 * ever stored as a digest, and putting them in the URL would be worse. Handing
 * them back as the return value of the call means they exist in one response
 * body and nowhere else, which is the property that makes them worth having.
 *
 * Every one of these re-checks the session with requireAdmin() rather than
 * trusting the page that rendered the form, and every one of them checks CSRF.
 * A server action is a POST endpoint; the fact that only one page renders a
 * button for it is not a control.
 */

const back = code => `/admin/security${code ? `?m=${code}` : ''}`;

/**
 * The current password, re-checked, and throttled.
 *
 * Three actions on this screen ask for the password again — changing it,
 * turning the second factor off, and reissuing recovery codes — and all three
 * are reachable by anyone holding a session. Without a limit they are an
 * unmetered password oracle for exactly the attacker the second factor exists
 * to stop: one who has the cookie and wants the password so they can keep the
 * account after the cookie is revoked.
 *
 * Keyed on the admin rather than the address, because the attacker who matters
 * here is already inside and can come from anywhere. The same allowance as the
 * login screen, which is where the rest of the password guessing is capped.
 */
async function reauthOk(adminId) {
  const [max, windowSec] = limits.login;
  return rateOk('admin-reauth', `admin:${Number(adminId)}`, max, windowSec);
}

async function passwordOk(adminId, given) {
  const id = Number(adminId);
  if (!(await reauthOk(id))) return false;

  const rows = await sql`SELECT pass_hash FROM admins WHERE id = ${id}`;
  if (!rows.length) return false;
  return bcrypt.compare(String(given ?? ''), rows[0].pass_hash);
}

/* ------------------------------------------------------------- password */

export async function changeAdminPassword(formData) {
  const admin = await requireAdmin();
  if (!(await csrfOk(formData.get('_csrf')))) redirect(back('csrf'));

  const next = String(formData.get('next') || '');
  if (next !== String(formData.get('confirm') || '')) redirect(back('pw_mismatch'));

  // changePassword checks the current password itself, so the throttle has to
  // be applied here rather than through passwordOk — otherwise this one action
  // would be the unmetered oracle the other two are protected from.
  if (!(await reauthOk(admin.id))) redirect(back('rate'));

  const res = await changePassword(admin.id, formData.get('current'), next);
  if (!res.ok) {
    redirect(back({
      'wrong-password': 'pw_wrong',
      unchanged: 'pw_same',
      'too-short': 'pw_short',
      'too-long': 'pw_short',
      common: 'pw_weak',
      'contains-email': 'pw_weak',
      required: 'pw_short',
    }[res.reason] || 'bad_input'));
  }

  /*
   * Changing the password ended every session, including this browser. Mint a
   * new cookie at the new epoch so the person who just typed their password
   * twice is not thrown back to the login screen for their trouble - while
   * everybody else holding a session, which is the point, is.
   */
  await createSession({ ...res.admin, session_epoch: res.epoch });
  redirect(back('pw_changed'));
}

/* --------------------------------------------------------- sessions */

export async function signOutEverywhere(formData) {
  const admin = await requireAdmin();
  if (!(await csrfOk(formData.get('_csrf')))) redirect(back('csrf'));

  await revokeSessions(admin.id);
  // The cookie in this browser is dead either way now; clearing it as well
  // means the redirect below lands on a login screen rather than on a guard.
  await destroySession();
  redirect('/admin/login?m=bye_all');
}

/* ------------------------------------------------------- second factor */

export async function startTwoFactor(formData) {
  const admin = await requireAdmin();
  if (!(await csrfOk(formData.get('_csrf')))) redirect(back('csrf'));
  await beginEnrolment(admin.id);
  redirect(back());
}

export async function abandonTwoFactor(formData) {
  const admin = await requireAdmin();
  if (!(await csrfOk(formData.get('_csrf')))) redirect(back('csrf'));
  await cancelEnrolment(admin.id);
  redirect(back());
}

export async function turnOffTwoFactor(formData) {
  const admin = await requireAdmin();
  if (!(await csrfOk(formData.get('_csrf')))) redirect(back('csrf'));

  // The password again. Turning the second factor off is the one action here
  // that makes the account easier to reach, so it is the one that most needs
  // an unattended session not to be enough.
  if (!(await passwordOk(admin.id, formData.get('current')))) redirect(back('pw_wrong'));

  await disableTotp(admin.id);
  // disableTotp revoked every session, this one included.
  await destroySession();
  redirect('/admin/login?m=totp_off');
}

/**
 * Confirm enrolment with a code from the phone, and hand back the ten recovery
 * codes. Called from the client component, so it answers rather than redirects.
 */
export async function confirmTwoFactor({ code, csrf }) {
  const admin = await requireAdmin();
  if (!(await csrfOk(csrf))) return { error: 'csrf' };

  const res = await confirmEnrolment(admin.id, code);
  if (!res.ok) return { error: res.reason === 'bad-code' ? 'bad_code' : 'not_started' };
  return { codes: res.codes };
}

/** A fresh set, which invalidates whatever was printed before. */
export async function reissueRecoveryCodes({ password, csrf }) {
  const admin = await requireAdmin();
  if (!(await csrfOk(csrf))) return { error: 'csrf' };
  if (!(await passwordOk(admin.id, password))) return { error: 'pw_wrong' };

  return { codes: await regenerateRecoveryCodes(admin.id) };
}
