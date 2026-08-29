import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { csrfOk, csrfToken, destroySession } from '../../../../lib/auth.js';
import { clientIp, rateOk } from '../../../../lib/db.js';
import { limits } from '../../../../lib/config.js';
import { claimReset, resetTarget, RESET_TTL_MINUTES } from '../../../../lib/admin-reset.js';
import { LOGIN_MESSAGES } from '../../_lib/ui.js';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Set a new password — Star Seven admin',
  robots: { index: false, follow: false },
};

/**
 * Set a new password, holding a link from /admin/forgot.
 *
 * The token in the query string IS the credential, and the whole of this
 * screen assumes that: there is no session here and nothing else is asked for.
 * That is the same arrangement /order/[ref] has, one level up in what it grants
 * — which is why this token expires in half an hour and an order link does not.
 *
 * ---------------------------------------------------------------------------
 * What happens on submit, in order, and why that order
 *
 *   1. CSRF, for the shape of it. See the note on /admin/forgot: with no
 *      session cookie there is no per-visitor value to derive, so this is not
 *      the control. It is also not needed to be: anybody able to make a browser
 *      post this form already had to know the token, and knowing the token they
 *      could simply use it.
 *
 *   2. A rate limit. Nothing here verifies a password, so this is not the
 *      password oracle that app/admin/_lib/security-actions.js guards against —
 *      it is a cap on grinding at 256-bit tokens, which is unnecessary, and a
 *      cap on bcrypt work, which is not: every submission with a well-formed
 *      token costs a bcrypt hash at cost 12, and that is CPU somebody else is
 *      paying for.
 *
 *   3. The claim, in lib/admin-reset.js, as one guarded statement. Two requests
 *      racing on one link have exactly one winner.
 *
 *   4. The session cookie in THIS browser is cleared. The reset revoked every
 *      session the account had, this one included if the person doing the reset
 *      was signed in — clearing it means they land on a login screen rather
 *      than on a guard that redirects them there.
 *
 * The redirect on success goes to the login screen and not into the panel.
 * Setting a password is not signing in: an account with a second factor still
 * has to produce a code, and minting a session here would be a way to walk past
 * it holding only the mailbox. That is the one thing a reset must never become.
 */
async function setNewPassword(formData) {
  'use server';

  const token = String(formData.get('t') || '');
  const backTo = code => `/admin/reset?t=${encodeURIComponent(token)}&m=${code}`;

  if (!(await csrfOk(formData.get('_csrf')))) redirect(backTo('csrf'));

  const ip = clientIp({ headers: await headers() });
  const [max, windowSec] = limits.login;
  if (!(await rateOk('admin-reset', ip, max, windowSec))) redirect(backTo('rate'));

  const next = String(formData.get('pass') || '');
  if (next !== String(formData.get('confirm') || '')) redirect(backTo('pw_mismatch'));

  const res = await claimReset(token, next);
  if (!res.ok) {
    if (res.reason === 'invalid') redirect('/admin/login?m=reset_dead');
    redirect(backTo({
      'too-short': 'pw_short',
      'too-long': 'pw_short',
      required: 'pw_short',
      common: 'pw_weak',
      'contains-email': 'pw_weak',
    }[res.reason] || 'bad_input'));
  }

  await destroySession();
  redirect('/admin/login?m=pw_reset');
}

export default async function ResetPage({ searchParams }) {
  const sp = await searchParams;
  const token = String(sp?.t || '');
  const msg = LOGIN_MESSAGES[String(sp?.m || '')];
  const csrf = await csrfToken();

  const target = await resetTarget(token);

  // A dead link says so plainly. There is nothing to protect by being vague:
  // whoever is looking at this page is holding a token, and the only question
  // they can have answered here is one about that token.
  if (!target) {
    return (
      <div className="s7login">
        <div className="box">
          <div className="logo"><i>★</i> STAR SEVEN</div>
          <div className="card">
            <h1>That link is no longer valid</h1>
            <p className="sub">
              A reset link works once and expires after {RESET_TTL_MINUTES} minutes. Ask for
              a fresh one and use the newest email.
            </p>
            <p className="sub"><a href="/admin/forgot">Send me another link</a></p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="s7login">
      <div className="box">
        <div className="logo"><i>★</i> STAR SEVEN</div>
        <div className="card">
          <h1>Set a new password</h1>
          {msg ? <div className={msg[0]}>{msg[1]}</div> : null}
          <p className="sub">
            For <b>{target.email}</b>. Saving signs out every browser this account is
            signed in to, and you will be asked to log in again.
          </p>
          <form action={setNewPassword}>
            <input type="hidden" name="_csrf" value={csrf} />
            <input type="hidden" name="t" value={token} />
            <label htmlFor="pass">New password (10+ characters)</label>
            <input id="pass" type="password" name="pass" required minLength={10}
                   autoComplete="new-password" autoFocus />
            <label htmlFor="confirm">New password again</label>
            <input id="confirm" type="password" name="confirm" required minLength={10}
                   autoComplete="new-password" />
            <button type="submit">Save the new password</button>
          </form>
        </div>
      </div>
    </div>
  );
}
