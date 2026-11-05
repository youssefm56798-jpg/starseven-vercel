import { localizedAdminMetadata } from "../../_lib/locale-server.js";
import { AdminText } from '../../_lib/locale.js';
import { after } from 'next/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { csrfOk, csrfToken } from '../../../../lib/auth.js';
import { clientIp, rateOk } from '../../../../lib/db.js';
import { limits } from '../../../../lib/config.js';
import { emailOk, normaliseEmail } from '../../../../lib/credentials.js';
import { sendMail, tplAdminReset } from '../../../../lib/mail.js';
import { issueResetToken, resetUrl, RESET_TTL_MINUTES } from '../../../../lib/admin-reset.js';
import { LOGIN_MESSAGES } from '../../_lib/ui.js';

export const dynamic = 'force-dynamic';
export async function generateMetadata(){return localizedAdminMetadata({
  title: 'Forgotten password — Star Seven admin',
  robots: { index: false, follow: false },
});}

/**
 * Ask for a link that sets a new admin password.
 *
 * Open to anybody, which is what makes it delicate: it takes an email address
 * from a stranger and it must not tell that stranger whether the address can
 * get into the shop admin. Knowing which addresses are admins is most of the
 * work of a targeted attack on a two-person shop.
 *
 * Three things together make it silent, and all three are needed:
 *
 *   the same words     one redirect, reached from both branches. There is
 *                      literally one `redirect(...)` on the success path below,
 *                      so a hit and a miss cannot drift apart later by somebody
 *                      editing one of two copies.
 *
 *   the same time      lib/admin-reset.js does the lookup and the mint in ONE
 *                      statement, so a hit and a miss cost the same round trip.
 *                      app/api/subscribe/route.js documents at length how the
 *                      obvious two-query version turns identical wording into a
 *                      working oracle anyway, and lib/order-access.js solves it
 *                      the same way this does.
 *
 *   the mail deferred  after(), so the hundreds of milliseconds a send to
 *                      Resend costs are not inside the response of the branch
 *                      that has something to send. That was the whole of the
 *                      remaining gap on /api/subscribe.
 *
 * scripts/verify-admin-accounts.mjs measures the two branches and fails if they
 * separate.
 *
 * ---------------------------------------------------------------------------
 * Two limits, and what each one is for
 *
 * Per IP, because this endpoint is the enumeration surface: without it somebody
 * can walk a list of addresses looking for the one that gets a different
 * anything. Per email, because it is also a way to make the shop send mail to a
 * person on request, repeatedly, and a limit on the source address does not
 * stop that from a rotating one. Exactly the pair /order/find carries, for
 * exactly the same two reasons.
 *
 * The CSRF token on this form is the anonymous one — there is no session cookie
 * to derive a per-visitor value from, so it is the same string for everyone,
 * which is true of the login and setup forms too. It is kept because the shape
 * of every form in this panel is the same and a form that is one day rendered
 * to a signed-in admin should not need remembering. What actually stops this
 * being used as a cross-site mail cannon is the pair of limits above.
 */
async function requestReset(formData) {
  'use server';

  if (!(await csrfOk(formData.get('_csrf')))) redirect('/admin/forgot?m=csrf');

  const email = normaliseEmail(formData.get('email'));
  // A malformed address is refused before anything is looked up. This leaks
  // nothing: it is a statement about the string, not about the shop.
  if (!emailOk(email)) redirect('/admin/forgot?m=bad_email');

  const ip = clientIp({ headers: await headers() });
  const [max, windowSec] = limits.login;
  if (!(await rateOk('admin-forgot', ip, max, windowSec))) redirect('/admin/forgot?m=rate');
  if (!(await rateOk('admin-forgot-acct', email, limits.orderFindEmail[0], limits.orderFindEmail[1]))) {
    redirect('/admin/forgot?m=rate');
  }

  const issued = await issueResetToken(email, ip);

  // The only branch, and it does no work that the other branch can be timed
  // against: building two strings and registering a callback.
  if (issued) {
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
  }

  redirect('/admin/forgot?m=reset_sent');
}

export default async function ForgotPage({ searchParams }) {
  const sp = await searchParams;
  const msg = LOGIN_MESSAGES[String(sp?.m || '')];
  const token = await csrfToken();

  return (
    <div className="s7login">
      <div className="box">
        <div className="logo"><i>★</i>{' '}<AdminText text="STAR SEVEN" /></div>
        <div className="card">
          <h1><AdminText text="Forgotten password" /></h1>
          {msg ? <div className={msg[0]}>{<AdminText text={msg[1]} />}</div> : null}
          <p className="sub"><AdminText text="Type the address on your admin account and we will email a link that sets a new password. The link works once and expires in" />{' '}{RESET_TTL_MINUTES}{' '}<AdminText text="minutes." /></p>
          <form action={requestReset}>
            <input type="hidden" name="_csrf" value={token} />
            <label htmlFor="email"><AdminText text="Email" /></label>
            <input id="email" type="email" name="email" required autoComplete="username" autoFocus />
            <button type="submit"><AdminText text="Email me a link" /></button>
          </form>
          <p className="sub" style={{ marginTop: '14px' }}>
            <a href="/admin/login"><AdminText text="Back to the login screen" /></a>
          </p>
        </div>
      </div>
    </div>
  );
}
