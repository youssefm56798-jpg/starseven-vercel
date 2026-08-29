'use server';

import { after } from 'next/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { csrfOk } from '../../../lib/auth.js';
import { clientIp, rateOk } from '../../../lib/db.js';
import { limits } from '../../../lib/config.js';
import { sendMail, tplAdminReset } from '../../../lib/mail.js';
import { issueResetToken, resetUrl, RESET_TTL_MINUTES } from '../../../lib/admin-reset.js';
import {
  createAdmin, removeAdmin, setAdminRole, setAdminSuspended,
} from '../../../lib/admin-accounts.js';
import { requireOwner } from './guard.js';

/**
 * The owner desk for admin accounts.
 *
 * Its own actions file rather than logic inside the page, matching
 * security-actions.js, because these write the admins table and that is not
 * something to have three copies of.
 *
 * Every action here does the same three things before it does anything else:
 *
 *   requireOwner()   the session exists AND its role may manage accounts. The
 *                    role is read from the row, not from the token, so a
 *                    demotion takes effect on the next request rather than in
 *                    eight hours.
 *   csrfOk()         a Server Action is a POST endpoint; SameSite=Lax is the
 *                    first lock and this is the second.
 *   lib/admin-accounts.js checks the caller role AGAIN, from the database,
 *                    inside the same module that writes the row.
 *
 * The third one looks like belt and braces and is deliberately kept. The check
 * that gets forgotten is never the one in the module doing the writing, it is
 * the one at the top of the next action somebody adds — and a check that lives
 * with the write cannot be left off a new caller. It is also what lets
 * scripts/verify-admin-accounts.mjs prove against a real Postgres that staff
 * cannot manage accounts: the actions cannot be loaded outside Next, but the
 * module they call can.
 */

const back = code => `/admin/accounts${code ? `?m=${code}` : ''}`;

/** Turns a reason from lib/admin-accounts.js into a flash code. */
const FLASH = {
  forbidden: 'forbidden',
  'not-found': 'acct_missing',
  self: 'acct_self',
  'last-owner': 'acct_last_owner',
  duplicate: 'acct_duplicate',
  'bad-email': 'acct_bad_email',
  'bad-role': 'bad_input',
  required: 'pw_short',
  'too-short': 'pw_short',
  'too-long': 'pw_short',
  common: 'pw_weak',
  'contains-email': 'pw_weak',
};

const flashFor = reason => FLASH[reason] || 'bad_input';

/* ------------------------------------------------------------------ create */

export async function createStaffAccount(formData) {
  const owner = await requireOwner();
  if (!(await csrfOk(formData.get('_csrf')))) redirect(back('csrf'));

  const password = String(formData.get('pass') || '');
  if (password !== String(formData.get('confirm') || '')) redirect(back('pw_mismatch'));

  const res = await createAdmin(owner.id, {
    email: formData.get('email'),
    password,
    name: formData.get('name'),
    role: formData.get('role'),
  });
  if (!res.ok) redirect(back(flashFor(res.reason)));

  redirect(back('acct_created'));
}

/* -------------------------------------------------------------------- role */

export async function changeAdminRole(formData) {
  const owner = await requireOwner();
  if (!(await csrfOk(formData.get('_csrf')))) redirect(back('csrf'));

  const res = await setAdminRole(owner.id, formData.get('id'), formData.get('role'));
  if (!res.ok) redirect(back(flashFor(res.reason)));

  redirect(back(res.role === 'owner' ? 'acct_promoted' : 'acct_demoted'));
}

/* ----------------------------------------------------------------- suspend */

export async function suspendAdmin(formData) {
  const owner = await requireOwner();
  if (!(await csrfOk(formData.get('_csrf')))) redirect(back('csrf'));

  const on = String(formData.get('act') || '') === 'suspend';
  const res = await setAdminSuspended(owner.id, formData.get('id'), on);
  if (!res.ok) redirect(back(flashFor(res.reason)));

  redirect(back(on ? 'acct_suspended' : 'acct_restored'));
}

/* ------------------------------------------------------------------ remove */

export async function deleteAdmin(formData) {
  const owner = await requireOwner();
  if (!(await csrfOk(formData.get('_csrf')))) redirect(back('csrf'));

  const res = await removeAdmin(owner.id, formData.get('id'));
  if (!res.ok) redirect(back(flashFor(res.reason)));

  redirect(back('acct_removed'));
}

/* ------------------------------------------------------- mail a reset link */

/**
 * Send somebody a link to set a new password.
 *
 * The same machinery /admin/forgot uses, from the other end: an owner pressing
 * this for a member of staff who is not in the room. None of the enumeration
 * care that surrounds the public screen applies here — the caller is a signed-in
 * owner looking at a list of the accounts, so there is nothing to leak — but the
 * token, its expiry and its single use are identical, because there is one
 * implementation of all three.
 *
 * Rate limited on the OWNER rather than on the target. What this could be
 * abused into is a mail cannon, and the cannon is the account holding the
 * session; keying on the target would let one compromised owner session spread
 * the same volume across every account instead of being stopped by it.
 *
 * The send is deferred to after() for the same reason the response does not
 * need to wait on Resend anywhere else, and its failure never fails the action:
 * the link is already minted and the owner is told it went out. What they get
 * wrong in that case is one sentence on a screen, and what they would get
 * instead is an error page after the token was already written.
 */
export async function mailResetLink(formData) {
  const owner = await requireOwner();
  if (!(await csrfOk(formData.get('_csrf')))) redirect(back('csrf'));

  const [max, windowSec] = limits.login;
  if (!(await rateOk('admin-reset-send', `admin:${owner.id}`, max, windowSec))) {
    redirect(back('rate'));
  }

  // The address on the row is recorded as the requester, because it is: an
  // owner asked for this on somebody else behalf, and the audit column should
  // say so rather than being blank on the one path that is not self-service.
  const issued = await issueResetToken(
    formData.get('email'), clientIp({ headers: await headers() }),
  );
  if (!issued) redirect(back('acct_missing'));

  const [subject, html] = tplAdminReset(
    resetUrl(issued.token), RESET_TTL_MINUTES, issued.admin.name,
  );
  after(async () => {
    try {
      await sendMail({ to: issued.admin.email, subject, html, kind: 'admin-reset' });
    } catch (e) {
      console.error('[s7] admin reset mail failed:', e?.message || e);
    }
  });

  redirect(back('acct_reset_sent'));
}
