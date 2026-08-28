import bcrypt from 'bcryptjs';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createSession, csrfOk, csrfToken, currentAdmin } from '../../../../lib/auth.js';
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

  const rows = await sql`SELECT id, email, name, pass_hash FROM admins WHERE email = ${email} LIMIT 1`;
  const admin = rows[0];
  const ok = await bcrypt.compare(pass, admin ? admin.pass_hash : DUMMY_HASH);

  // Same answer either way — never reveal which half was wrong.
  if (!admin || !ok) redirect('/admin/login?m=bad');

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
        </div>
      </div>
    </div>
  );
}
