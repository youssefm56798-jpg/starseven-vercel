import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { sql } from './db.js';
import { bumpSessionEpoch, epochTag } from './session-epoch.js';

/**
 * Admin sessions.
 *
 * PHP sessions do not exist on serverless, so login state travels in a signed,
 * HttpOnly cookie instead. The signing secret never leaves the server, so a
 * visitor can neither forge a session nor edit the one they hold.
 *
 * ---------------------------------------------------------------------------
 * Killing a session that has already been issued
 *
 * A signed token with an expiry in it is not revocable. That is not a detail of
 * this implementation, it is what the shape means: everything needed to accept
 * the token is inside the token, so nothing that happens afterwards can be
 * taken into account. For eight hours after a laptop is left on a train there
 * was no action available — not changing the password, not deleting the admin
 * row — that would stop that cookie working.
 *
 * The fix is one integer on the admin row. The token carries the epoch it was
 * minted under, the verifier refuses any token whose epoch is not the current
 * one, and bumping the column by one therefore invalidates every session that
 * admin holds, everywhere, at once. Changing a password bumps it; so does the
 * sign-out-everywhere button.
 *
 * The obvious objection is that this puts a database read in front of every
 * admin request, which is the cost the stateless token existed to avoid. It
 * does not, for two reasons stacked on top of each other:
 *
 *   react cache()      dedupes within one render. The panel layout calls
 *                      currentAdmin() and then every page calls it again
 *                      through requireAdmin(); that is one read, not two.
 *
 *   unstable_cache()   dedupes across requests, in the Next data cache, for a
 *                      minute. So the steady state is one read per admin per
 *                      minute per region rather than one per page view.
 *
 * A minute of staleness would be a bad answer for revocation on its own, which
 * is why the cache entry is tagged and revokeSessions() invalidates the tag in
 * the same action that bumps the column. Revocation is immediate; the minute is
 * only the ceiling if that invalidation is ever missed.
 *
 * A token with no epoch in it at all is refused. Every session issued before
 * this existed is therefore dead on deploy, and the one-off cost of that is an
 * admin logging in again — which is the right way round, because the
 * alternative is treating an unverifiable token as valid.
 *
 * Failing closed is deliberate too. If the epoch cannot be read the session is
 * treated as invalid, not as valid: an admin panel whose database is down can
 * do nothing useful anyway, so there is no case where letting the request
 * through is the kinder answer.
 */
const COOKIE = 's7_admin';
const MAX_AGE = 60 * 60 * 8; // 8 hours

/**
 * The cookie for a login that has cleared the password but not the second
 * factor. A separate cookie rather than a claim inside the main one, so that
 * nothing which reads the session can mistake a half-finished login for a
 * finished one by forgetting to check a field.
 */
const PENDING_COOKIE = 's7_admin_2fa';
const PENDING_MAX_AGE = 60 * 5; // five minutes to reach for a phone

/** How long the data cache may hold an epoch before reading it again. */
const EPOCH_TTL = 60;

function secret() {
  const s = process.env.SESSION_SECRET || '';
  if (s.length < 16) throw new Error('SESSION_SECRET is missing or too short');
  return new TextEncoder().encode(s);
}

/**
 * The current session epoch and role for an admin, or null if there is no such
 * admin — or if that admin is suspended.
 *
 * Wrapped twice, as described above. The inner unstable_cache callback reads
 * nothing request-scoped — only the id it is given — which is what makes it
 * legal to cache at all.
 *
 * ---------------------------------------------------------------------------
 * Why the role rides along here
 *
 * Putting the role in the token instead would make it free to read and wrong to
 * trust: a signed JWT says what was true when it was minted, so an admin
 * demoted five minutes ago would keep the powers of the role they no longer
 * have for the rest of their eight hours. This read is already on the path of
 * every admin request and is already deduped twice over, so carrying one more
 * column costs nothing — it is the same row, the same index lookup, the same
 * cache entry.
 *
 * Changing a role bumps the epoch (see lib/admin-accounts.js), which
 * invalidates this tag in the same breath. So the role a request sees is either
 * current or the session is refused; it is never a stale role on a live
 * session.
 *
 * ---------------------------------------------------------------------------
 * Why suspension is checked here as well
 *
 * Suspending already revokes: setAdminSuspended bumps the epoch, so every
 * cookie the suspended admin holds stops verifying immediately. Refusing the
 * row here too is the second lock, and it is the one that does not depend on
 * anybody remembering to revoke. A suspended admin has to get past both to see
 * a screen, and the failure mode of each one is the safe direction.
 */
const readSession = cache(async id => unstable_cache(
  async () => {
    const rows = await sql`
      SELECT session_epoch, role FROM admins
       WHERE id = ${id} AND suspended_at IS NULL`;
    return rows.length
      ? { epoch: Number(rows[0].session_epoch), role: String(rows[0].role || 'staff') }
      : null;
  },
  ['s7-admin-epoch', String(id)],
  { revalidate: EPOCH_TTL, tags: [epochTag(id)] },
)());

const cookieOptions = maxAge => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge,
});

/**
 * Issue a full session.
 *
 * The epoch has to come from the row, and callers that have just changed it
 * must pass the value they got back from their own UPDATE rather than letting
 * this read it: the cached copy is invalidated in the same breath as the write,
 * and reading it here would be a race against that invalidation for no reason.
 */
export async function createSession(admin) {
  const epoch = Number(admin.session_epoch ?? 0);
  const token = await new SignJWT({ id: admin.id, name: admin.name || admin.email, ep: epoch })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());

  const jar = await cookies();
  jar.set(COOKIE, token, cookieOptions(MAX_AGE));
  // A finished login has no business still carrying the half-finished one.
  jar.set(PENDING_COOKIE, '', cookieOptions(0));
}

export async function destroySession() {
  const jar = await cookies();
  jar.set(COOKIE, '', cookieOptions(0));
  jar.set(PENDING_COOKIE, '', cookieOptions(0));
}

/** The signed-in admin, or null. Never throws on a malformed cookie. */
export async function currentAdmin() {
  try {
    const token = (await cookies()).get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret());

    // A token from before session_epoch existed carries no epoch and cannot be
    // shown to be current, so it is not accepted. One re-login, once.
    if (typeof payload.ep !== 'number') return null;

    const row = await readSession(Number(payload.id));
    if (row === null || row.epoch !== payload.ep) return null;

    // The role comes from the row, never from the token. See readSession.
    return { id: payload.id, name: payload.name, role: row.role };
  } catch {
    return null;
  }
}

/**
 * End every session this admin holds, including the one making the request.
 *
 * The write itself lives in lib/session-epoch.js and is re-exported here,
 * because this is where anyone looking for it will look. See that file for why
 * it is not simply defined here.
 */
export const revokeSessions = bumpSessionEpoch;

/* ------------------------------------------------- the half-finished login */

/**
 * Issue the cookie that says the password was right and the second factor is
 * still outstanding.
 *
 * It carries the admin id and nothing else useful, is good for five minutes,
 * and is signed with a different audience claim from the real session so that
 * one can never be presented as the other — even if a future change makes the
 * two cookie names collide. Five minutes is long enough to find a phone and
 * short enough that a half-finished login left on a shared machine is not a
 * standing invitation.
 */
export async function startPendingSession(admin) {
  const token = await new SignJWT({ id: admin.id })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setAudience('s7-2fa')
    .setExpirationTime(`${PENDING_MAX_AGE}s`)
    .sign(secret());

  const jar = await cookies();
  jar.set(PENDING_COOKIE, token, cookieOptions(PENDING_MAX_AGE));
  jar.set(COOKIE, '', cookieOptions(0));
}

/** The admin id waiting on a second factor, or null. */
export async function pendingAdminId() {
  try {
    const token = (await cookies()).get(PENDING_COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret(), { audience: 's7-2fa' });
    const id = Number(payload.id);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export async function clearPendingSession() {
  (await cookies()).set(PENDING_COOKIE, '', cookieOptions(0));
}

/**
 * CSRF: admin forms carry a token derived from the session cookie. An attacker
 * on another origin cannot read the cookie, so cannot produce a matching token.
 *
 * The pending cookie is read as a fallback so the second-factor form is
 * protected the same way. Without it that form would derive its token from the
 * literal string 'anon' plus the secret, which is the same value for every
 * visitor and therefore no protection at all — and it is the one form on the
 * site standing between a stolen password and the panel.
 */
export async function csrfToken() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value || jar.get(PENDING_COOKIE)?.value || 'anon';
  const data = new TextEncoder().encode(token + (process.env.SESSION_SECRET || ''));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function csrfOk(sent) {
  const expected = await csrfToken();
  if (typeof sent !== 'string' || sent.length !== expected.length) return false;
  // constant-time compare
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sent.charCodeAt(i);
  return diff === 0;
}
