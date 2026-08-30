import bcrypt from 'bcryptjs';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  createSession, csrfOk, csrfToken, currentAdmin, startPendingSession,
} from '../../../../lib/auth.js';
import { limits } from '../../../../lib/config.js';
import { clientIp, rateClear, rateOk, sql } from '../../../../lib/db.js';
import { LOGIN_MESSAGES } from '../../_lib/ui.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Log in — Star Seven admin', robots: { index: false, follow: false } };

/**
 * A real bcrypt hash of a value nobody will ever type. When the email is
 * unknown we still spend one bcrypt comparison against it, so a wrong email and
 * a wrong password take the same time — otherwise the response time alone would
 * tell an attacker which addresses are real.
 */
const DUMMY_HASH = '$2a$10$v/V3SjUk6Fpq0hU0pEhH4Oh9iVz6YYK/WSxHskfMOURNmyPRKp4vC';

async function doLogin(formData) {
  'use server';

  if (!(await csrfOk(formData.get('_csrf')))) redirect('/admin/login?m=csrf');

  const ip = clientIp({ headers: await headers() });
  const [max, windowSec] = limits.login;
  if (!(await rateOk('login', ip, max, windowSec))) redirect('/admin/login?m=rate');

  const email = String(formData.get('email') || '').trim().toLowerCase();
  const pass = String(formData.get('pass') || '');

  const rows = await sql`
    SELECT id, email, name, pass_hash, session_epoch, totp_enrolled_at, suspended_at
      FROM admins WHERE email = ${email} LIMIT 1`;
  const admin = rows[0];
  const ok = await bcrypt.compare(pass, admin ? admin.pass_hash : DUMMY_HASH);

  /*
   * The account limit, and the reason it is spent HERE and not before the
   * password is checked.
   *
   * A second limit keyed on the ACCOUNT rather than the address is worth having:
   * the per-IP limit is defeated by an attacker who rotates source addresses, so
   * a targeted admin email could otherwise be guessed at from a fresh IP each
   * time with no ceiling.
   *
   * But charging it before the password was known to be wrong made it a weapon.
   * The bucket key is the email itself, so anyone who knows the owner's address
   * - plausibly the one printed in MAIL_FROM - could send eight wrong passwords
   * from a single address, fill the bucket, and the owner's NEXT attempt, with
   * the right password, was refused. Repeated once a window, that is an
   * indefinite lockout of the shop's own admin, from one IP, at about thirty
   * requests an hour.
   *
   * So a wrong password spends the allowance and a right one does not, and a
   * right one clears whatever somebody else spent. The stuffing ceiling is
   * unchanged - an attacker only ever submits wrong passwords, and eight of
   * those still stop them - but a caller who can prove they are the account
   * holder is never turned away by somebody else's failures.
   */
  if (!admin || !ok) {
    // Empty email skips it: an empty key would be one shared bucket for every
    // unknown address, and that guessing is already bounded by the IP limit.
    const under = email ? await rateOk('login-acct', email, max, windowSec) : true;
    // Same answer either way — never reveal which half was wrong.
    redirect(under ? '/admin/login?m=bad' : '/admin/login?m=rate');
  }

  if (email) await rateClear('login-acct', email);

  /*
   * A suspended account, checked AFTER the password and not in the query above.
   *
   * The order is what makes the honest message safe. Filtering suspended rows
   * out of the SELECT would fold suspension into the generic wrong-email-or-
   * password answer, which is correct but tells a member of staff nothing about
   * why the password they know is right is being refused. Checking it here
   * means the message is only ever shown to somebody who has just proved they
   * hold the password for this account, so it discloses nothing they did not
   * already have — and the bcrypt comparison has already been paid either way,
   * so it costs no timing difference.
   *
   * Suspension already killed the sessions this account held, by bumping the
   * epoch. This is the other half: it stops a new one being minted.
   */
  if (admin.suspended_at !== null) redirect('/admin/login?m=suspended');

  /*
   * The password was right, which is not the same as being signed in.
   *
   * An admin with a second factor enrolled gets the pending cookie and the
   * verify screen instead of a session. Two things about that are load-bearing.
   * The pending cookie is a different cookie carrying a different audience
   * claim, so nothing that reads the session can mistake the half-finished
   * login for a finished one by failing to check a field — the session either
   * exists or it does not. And last_login is stamped where the session is
   * actually created, not here, so it means "got in" rather than "typed the
   * right password", which is what somebody reading that column to see whether
   * an account has been compromised needs it to mean.
   *
   * The branch cannot be used to learn anything: reaching it at all requires
   * the password, so it tells an attacker only about an account they already
   * hold the first factor for.
   */
  if (admin.totp_enrolled_at !== null) {
    await startPendingSession(admin);
    redirect('/admin/login/verify');
  }

  await sql`UPDATE admins SET last_login = now() WHERE id = ${admin.id}`;
  await createSession(admin);
  redirect('/admin');
}

export default async function LoginPage({ searchParams }) {
  if (await currentAdmin()) redirect('/admin');

  const sp = await searchParams;
  const msg = LOGIN_MESSAGES[String(sp?.m || '')];
  const token = await csrfToken();

  return (
    <div className="s7login">
      <div className="box">
        <div className="logo"><i>★</i> STAR SEVEN</div>
        <div className="card">
          <h1>Log in</h1>
          {msg ? <div className={msg[0]}>{msg[1]}</div> : null}
          <form action={doLogin}>
            <input type="hidden" name="_csrf" value={token} />
            <label htmlFor="email">Email</label>
            <input id="email" type="email" name="email" required autoComplete="username" autoFocus />
            <label htmlFor="pass">Password</label>
            <input id="pass" type="password" name="pass" required autoComplete="current-password" />
            <button type="submit">Log in</button>
          </form>
          <p className="sub" style={{ marginTop: '14px' }}>
            <a href="/admin/forgot">Forgotten your password?</a>
          </p>
        </div>
      </div>
    </div>
  );
}
