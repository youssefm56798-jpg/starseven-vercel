import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  clearPendingSession, createSession, csrfOk, csrfToken, currentAdmin, pendingAdminId,
} from '../../../../../lib/auth.js';
import { limits } from '../../../../../lib/config.js';
import { clientIp, rateOk, sql } from '../../../../../lib/db.js';
import { verifySecondFactor } from '../../../../../lib/admin-security.js';
import { LOGIN_MESSAGES } from '../../../_lib/ui.js';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Two-factor — Star Seven admin',
  robots: { index: false, follow: false },
};

/**
 * The second half of signing in.
 *
 * Getting here means the password was right and nothing more. The only thing
 * this page has is the pending cookie from lib/auth.js, which carries an admin
 * id, expires in five minutes and is signed with an audience claim that the
 * real session verifier does not accept — so it cannot be presented as a
 * session, and a session cannot be presented here.
 *
 * One field, not two. A six-digit code and a recovery code go in the same box
 * and lib/admin-security.js decides which it is looking at by shape. That is
 * not only fewer controls: a screen that asks up front which kind you have is a
 * screen that has to be told, and there is no reason to give a form the chance
 * to be wrong about it.
 *
 * ---------------------------------------------------------------------------
 * What stops this being brute-forced
 *
 * A six-digit code has a million values and lives for ninety seconds, which is
 * only safe while the number of attempts is capped. Three things cap it:
 *
 *   the pending cookie   five minutes, then the password has to be typed again
 *   a per-address limit  the same window and count the password screen uses
 *   a per-account limit  keyed on the admin id, so rotating source addresses
 *                        does not buy an attacker a fresh allowance
 *
 * The per-account limit is the important one and it is the same reasoning the
 * login screen already applies to the email address: a limit that can be reset
 * by changing where the request comes from is not a limit on the account.
 */
async function verify(formData) {
  'use server';

  const pending = await pendingAdminId();
  if (!pending) redirect('/admin/login?m=expired');

  if (!(await csrfOk(formData.get('_csrf')))) redirect('/admin/login/verify?m=csrf');

  const ip = clientIp({ headers: await headers() });
  const [max, windowSec] = limits.login2fa;
  if (!(await rateOk('login-2fa', ip, max, windowSec))) redirect('/admin/login/verify?m=rate');
  if (!(await rateOk('login-2fa-acct', `admin:${pending}`, max, windowSec))) {
    redirect('/admin/login/verify?m=rate');
  }

  const res = await verifySecondFactor(pending, formData.get('code'));
  if (!res.ok) redirect('/admin/login/verify?m=bad2fa');

  const rows = await sql`
    SELECT id, email, name, session_epoch FROM admins WHERE id = ${pending}`;
  const admin = rows[0];
  // The admin row disappeared between the password and the code. Vanishingly
  // unlikely and still not a reason to mint a session for a row that is gone.
  if (!admin) {
    await clearPendingSession();
    redirect('/admin/login?m=expired');
  }

  await sql`UPDATE admins SET last_login = now() WHERE id = ${admin.id}`;
  await createSession(admin);

  // A recovery code that has just been spent is worth saying out loud, because
  // the set is finite and running out means being locked out. The dashboard
  // flash is the only place an admin will reliably see it.
  if (res.via === 'recovery') redirect('/admin?m=recovery_used');
  redirect('/admin');
}

export default async function VerifyPage({ searchParams }) {
  // Already signed in: there is nothing to verify.
  if (await currentAdmin()) redirect('/admin');

  const pending = await pendingAdminId();
  if (!pending) redirect('/admin/login?m=expired');

  const sp = await searchParams;
  const msg = LOGIN_MESSAGES[String(sp?.m || '')];
  const token = await csrfToken();

  return (
    <div className="s7login">
      <div className="box">
        <div className="logo"><i>★</i> STAR SEVEN</div>
        <div className="card">
          <h1>Two-factor</h1>
          {msg ? <div className={msg[0]}>{msg[1]}</div> : null}
          <form action={verify}>
            <input type="hidden" name="_csrf" value={token} />
            <label htmlFor="code">Code from your authenticator app</label>
            <input
              id="code"
              name="code"
              required
              autoFocus
              autoComplete="one-time-code"
              inputMode="text"
              placeholder="123456"
            />
            <button type="submit">Verify</button>
          </form>
          <p className="sub" style={{ marginTop: '14px' }}>
            Lost the phone? Type one of your recovery codes here instead. Each one
            works once.
          </p>
        </div>
      </div>
    </div>
  );
}
