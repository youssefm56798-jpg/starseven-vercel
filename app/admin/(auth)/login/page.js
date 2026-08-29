import bcrypt from 'bcryptjs';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  createSession, csrfOk, csrfToken, currentAdmin, startPendingSession,
} from '../../../../lib/auth.js';
import { limits } from '../../../../lib/config.js';
import { clientIp, rateOk, sql } from '../../../../lib/db.js';
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

  // A second limit keyed on the ACCOUNT, not the address. The per-IP limit is
  // the only throttle there is otherwise, and it is defeated by an attacker who
  // rotates source addresses - so a targeted admin email could be guessed at
  // from a fresh IP each time with no ceiling. Keying on the email as well caps
  // attempts against one account regardless of where they come from. Same
  // window and count as the IP limit; the two are independent, so tripping
  // either one blocks. Empty email skips it - the address-guessing that would
  // exploit an empty key is already bounded by the IP limit above.
  if (email && !(await rateOk('login-acct', email, max, windowSec))) {
    redirect('/admin/login?m=rate');
  }

  const rows = await sql`
    SELECT id, email, name, pass_hash, session_epoch, totp_enrolled_at, suspended_at
      FROM admins WHERE email = ${email} LIMIT 1`;
  const admin = rows[0];
  const ok = await bcrypt.compare(pass, admin ? admin.pass_hash : DUMMY_HASH);

  // Same answer either way — never reveal which half was wrong.
  if (!admin || !ok) redirect('/admin/login?m=bad');

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
