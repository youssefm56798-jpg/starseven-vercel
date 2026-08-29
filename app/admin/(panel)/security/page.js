import { csrfToken } from '../../../../lib/auth.js';
import { sql } from '../../../../lib/db.js';
import { openSecret, otpauthUri, readableSecret } from '../../../../lib/totp.js';
import { securityFor } from '../../../../lib/admin-security.js';
import { requireAdmin } from '../../_lib/guard.js';
import { day, dt, Flash } from '../../_lib/ui.js';
import ConfirmButton from '../../_lib/confirm-button.js';
import {
  abandonTwoFactor,
  changeAdminPassword,
  signOutEverywhere,
  startTwoFactor,
  turnOffTwoFactor,
} from '../../_lib/security-actions.js';
import { ConfirmEnrolment, ReissueCodes } from './codes.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Security — Star Seven admin' };

/**
 * Everything about getting into this account, on one screen.
 *
 * Three things live here and they are three answers to the same question — what
 * can be done about a credential that has got out.
 *
 *   the password        changed, which ends every session as a side effect
 *   two-factor          so a password on its own stops being enough
 *   sign out everywhere for the laptop left on a train, when nothing is known
 *                       to have leaked and the sessions still have to go
 *
 * The enrolment secret is read back out of the row on every render rather than
 * carried through a redirect, which is what lets the page survive a refresh
 * halfway through setup. It is stored sealed (see lib/totp.js) and opened here
 * only to be displayed, so the plaintext exists in the response and in the
 * admins row of nobody who holds the environment.
 *
 * No QR code, deliberately: drawing one means a dependency or three hundred
 * lines of Reed-Solomon, and every authenticator app takes a secret typed in by
 * hand. The secret is shown in groups of four for exactly that, and the full
 * otpauth:// URI is there for anyone who wants to make their own QR.
 */
export default async function SecurityPage({ searchParams }) {
  const session = await requireAdmin();
  const sp = await searchParams;
  const token = await csrfToken();

  const me = await securityFor(session.id);
  // The session verified a moment ago, so the row was there a moment ago.
  if (!me) return <p className="sub">That account no longer exists.</p>;

  let pending = null;
  if (me.enrolling) {
    const rows = await sql`SELECT totp_pending FROM admins WHERE id = ${session.id}`;
    const secret = await openSecret(rows[0]?.totp_pending);
    if (secret) {
      pending = { secret, readable: readableSecret(secret), uri: otpauthUri(secret, me.email) };
    }
  }

  return (
    <>
      <h1>Security</h1>
      <p className="sub">Signed in as {me.email}.</p>

      <Flash code={sp?.m} />

      {/* ------------------------------------------------------ two-factor */}

      <div className="panel">
        <h2>
          Two-factor
          <span className="right">
            <span className={`pill ${me.enrolled ? 'delivered' : 'new'}`}>
              {me.enrolled ? 'on' : 'off'}
            </span>
          </span>
        </h2>
        <div className="pad">
          {me.enrolled ? (
            <>
              <p className="sub">
                On since {day(me.enrolledAt)}. Signing in asks for a code from your
                authenticator app after the password.
              </p>

              <div className="kv">
                <b>Recovery codes left</b>
                <span className={me.recoveryLeft <= 2 ? 'pill cancelled' : 'muted'}>
                  {me.recoveryLeft} of 10
                </span>
              </div>
              {me.recoveryLeft <= 2 ? (
                <div className="flash err">
                  Almost out. Generate a new set before the last one is spent — with
                  no codes and no phone there is no way back into this account.
                </div>
              ) : null}

              <ReissueCodes csrf={token} />

              <hr style={{ margin: '18px 0', border: 0, borderTop: '1px solid #2a2a2a' }} />

              <p className="sub">
                Turning two-factor off deletes the secret and every recovery code,
                and signs out every browser.
              </p>
              <form action={turnOffTwoFactor}>
                <input type="hidden" name="_csrf" value={token} />
                <div className="field">
                  <label htmlFor="off-pw">Your password</label>
                  <input
                    id="off-pw"
                    name="current"
                    type="password"
                    required
                    autoComplete="current-password"
                    style={{ maxWidth: '260px' }}
                  />
                </div>
                <ConfirmButton
                  message="Turn two-factor off? Your recovery codes are deleted and every session is signed out."
                >
                  Turn two-factor off
                </ConfirmButton>
              </form>
            </>
          ) : pending ? (
            <>
              <p className="sub">
                Add this to an authenticator app — Google Authenticator, 1Password,
                Aegis, whichever you use — then type the six digits it shows.
              </p>

              <div className="kv">
                <b>Secret</b>
                <code style={{ fontSize: '15px', letterSpacing: '2px' }}>{pending.readable}</code>
              </div>
              <div className="kv">
                <b>Or the full link</b>
                <code className="muted" style={{ wordBreak: 'break-all' }}>{pending.uri}</code>
              </div>

              <p className="muted">
                Nothing changes about how you sign in until the code below is
                accepted, so an interrupted setup cannot lock you out.
              </p>

              <ConfirmEnrolment csrf={token} />

              <form action={abandonTwoFactor} style={{ marginTop: '10px' }}>
                <input type="hidden" name="_csrf" value={token} />
                <button className="btn sm ghost" type="submit">Cancel setup</button>
              </form>
            </>
          ) : (
            <>
              <p className="sub">
                A password on its own is one thing to steal. With two-factor on,
                signing in also needs a code from your phone that changes every
                thirty seconds.
              </p>
              <form action={startTwoFactor}>
                <input type="hidden" name="_csrf" value={token} />
                <button className="btn red" type="submit">Set up two-factor</button>
              </form>
            </>
          )}
        </div>
      </div>

      {/* -------------------------------------------------------- password */}

      <div className="panel">
        <h2>Password</h2>
        <div className="pad">
          <p className="sub">
            {me.passwordChangedAt
              ? `Last changed ${dt(me.passwordChangedAt)}.`
              : 'Never changed since this account was created.'}
            {' '}Changing it signs out every browser, including this one — which is
            then signed straight back in, so you stay where you are.
          </p>
          <form action={changeAdminPassword}>
            <input type="hidden" name="_csrf" value={token} />
            <div className="field">
              <label htmlFor="pw-current">Current password</label>
              <input id="pw-current" name="current" type="password" required
                     autoComplete="current-password" style={{ maxWidth: '260px' }} />
            </div>
            <div className="field">
              <label htmlFor="pw-next">New password (10+ characters)</label>
              <input id="pw-next" name="next" type="password" required minLength={10}
                     autoComplete="new-password" style={{ maxWidth: '260px' }} />
            </div>
            <div className="field">
              <label htmlFor="pw-confirm">New password again</label>
              <input id="pw-confirm" name="confirm" type="password" required minLength={10}
                     autoComplete="new-password" style={{ maxWidth: '260px' }} />
            </div>
            <button className="btn red" type="submit">Change password</button>
          </form>
        </div>
      </div>

      {/* -------------------------------------------------------- sessions */}

      <div className="panel">
        <h2>Sessions</h2>
        <div className="pad">
          <p className="sub">
            A session lasts eight hours and lives in a cookie. This ends all of
            them at once — every browser, every phone, this tab included. Use it if
            a device has gone missing, or if you are not sure who is signed in.
          </p>
          <form action={signOutEverywhere}>
            <input type="hidden" name="_csrf" value={token} />
            <ConfirmButton
              className="btn"
              message="Sign out of every browser, including this one?"
            >
              Sign out everywhere
            </ConfirmButton>
          </form>
        </div>
      </div>
    </>
  );
}
