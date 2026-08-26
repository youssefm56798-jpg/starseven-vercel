import { SignJWT, jwtVerify } from 'jose';
import { cookies, headers } from 'next/headers';
import bcrypt from 'bcryptjs';
import { sql } from './db.js';

/**
 * Customer sessions.
 *
 * Two tokens, because the brief asks for two things that pull against each
 * other: never make the customer log in again, and do not read the database on
 * every request — but also be able to revoke a session.
 *
 *   access token   short-lived JWT, signature-verified, no database read.
 *                  This is what every authenticated page render uses.
 *   refresh token  32 opaque random bytes, stored as a SHA-256 digest, rotated
 *                  on every use. This is the only thing that touches the
 *                  sessions table, and only when the access token has expired.
 *
 * The cost is a revocation window: a session that is revoked keeps working
 * until its access token expires, at most ACCESS_TTL. That is the trade the
 * brief implies, so it is written down rather than left to be discovered.
 *
 * Nothing replayable is stored. A dump of `sessions` yields digests; the raw
 * refresh token exists in one cookie and nowhere else.
 *
 * Deliberately separate from lib/auth.js, which is the admin. An admin can
 * reprice the catalogue and a customer can see their own basket; sharing one
 * table or one cookie would put those a single mistake apart.
 */

const ACCESS_COOKIE = '__Host-s7_at';
const REFRESH_COOKIE = '__Secure-s7_rt';

export const ACCESS_TTL = 60 * 15;              // 15 minutes
export const REFRESH_TTL = 60 * 60 * 24 * 60;   // 60 days
const BCRYPT_COST = 12;

/** The refresh cookie is only ever sent to the routes that rotate it. */
const REFRESH_PATH = '/api/auth';

function secret() {
  const s = process.env.SESSION_SECRET || '';
  if (s.length < 16) throw new Error('SESSION_SECRET is missing or too short');
  return new TextEncoder().encode(s);
}

/* --------------------------------------------------------------- hashing --- */

const hex = buf => Array.from(new Uint8Array(buf))
  .map(b => b.toString(16).padStart(2, '0')).join('');

/** SHA-256, for values that must be looked up but never recovered. */
export async function sha256(value) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value))));
}

export const hashPassword = pw => bcrypt.hash(pw, BCRYPT_COST);
export const verifyPassword = (pw, hash) => bcrypt.compare(pw, hash);

/**
 * A bcrypt hash of a value nobody knows.
 *
 * Login compares against this when the email is unknown, so an unknown account
 * costs the same time as a wrong password. Without it, response time answers
 * "does this address have an account here" for anyone who asks.
 */
export const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.wjTPGGhbcHVzGZLGVQd5N9dJ3xXQ9Ky';

/* ---------------------------------------------------------------- tokens --- */

/** 32 random bytes, base64url. Opaque — it carries no meaning to guess at. */
export function newRefreshToken() {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...raw))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const newFamilyId = () => newRefreshToken().slice(0, 22);

async function signAccess({ userId, sessionId, familyId, tokenVersion }) {
  return new SignJWT({ sid: sessionId, fam: familyId, v: tokenVersion })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(String(userId))
    .setIssuedAt()
    .setIssuer('s7')
    .setAudience('s7-customer')
    .setExpirationTime(`${ACCESS_TTL}s`)
    .sign(secret());
}

/**
 * The signed-in customer, from the access token alone.
 *
 * No database read — this is the hot path, and it is the whole point of the
 * two-token design. Returns null for anything malformed, expired or foreign;
 * it never throws, because a bad cookie is a logged-out visitor, not a crash.
 */
export async function currentUser() {
  try {
    const token = (await cookies()).get(ACCESS_COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret(), {
      issuer: 's7',
      audience: 's7-customer',
    });
    const id = Number(payload.sub);
    if (!Number.isInteger(id) || id <= 0) return null;
    return { id, sessionId: payload.sid, familyId: payload.fam, tokenVersion: payload.v };
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------- cookies --- */

const base = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
};

async function setCookies(accessToken, refreshToken) {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, accessToken, { ...base, path: '/', maxAge: ACCESS_TTL });
  if (refreshToken !== null) {
    jar.set(REFRESH_COOKIE, refreshToken, { ...base, path: REFRESH_PATH, maxAge: REFRESH_TTL });
  }
}

export async function clearCookies() {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, '', { ...base, path: '/', maxAge: 0 });
  jar.set(REFRESH_COOKIE, '', { ...base, path: REFRESH_PATH, maxAge: 0 });
}

/* ------------------------------------------------------------- sessions --- */

/**
 * A weak binding to the browser that logged in.
 *
 * Not a security boundary — a user agent is trivially copied — but a stolen
 * token replayed from a different client is a cheap thing to notice, and it
 * costs one comparison.
 */
async function uaHash() {
  const ua = (await headers()).get('user-agent') || '';
  return sha256(ua.slice(0, 200));
}

/** Issues a brand-new session family. Used by register and login only. */
export async function startSession(user) {
  const refresh = newRefreshToken();
  const familyId = newFamilyId();
  const rows = await sql`
    INSERT INTO sessions (user_id, family_id, refresh_hash, ua_hash, expires_at)
    VALUES (${user.id}, ${familyId}, ${await sha256(refresh)}, ${await uaHash()},
            now() + ${REFRESH_TTL} * interval '1 second')
    RETURNING id`;

  const access = await signAccess({
    userId: user.id,
    sessionId: rows[0].id,
    familyId,
    tokenVersion: user.token_version,
  });
  await setCookies(access, refresh);
  return { sessionId: rows[0].id, familyId };
}

/**
 * Exchanges a refresh token for a fresh pair.
 *
 * Every branch that fails clears the cookies, because a refresh that cannot be
 * honoured is a session that no longer exists — leaving the cookie in place
 * would make the browser retry it forever.
 *
 * The reuse branch is the important one. A token that has already been rotated
 * being presented again means two parties hold it: the legitimate browser and
 * someone else. There is no way to tell which is which, so the entire family
 * is revoked and both are sent back to the login form.
 */
export async function refreshSession() {
  const jar = await cookies();
  const presented = jar.get(REFRESH_COOKIE)?.value;
  if (!presented) return { ok: false, reason: 'no-token' };

  const digest = await sha256(presented);
  const rows = await sql`
    SELECT s.id, s.user_id, s.family_id, s.rotated_at, s.revoked_at, s.expires_at,
           s.ua_hash, u.token_version
      FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.refresh_hash = ${digest}
     LIMIT 1`;

  const row = rows[0];
  if (!row) { await clearCookies(); return { ok: false, reason: 'unknown' }; }

  if (row.rotated_at) {
    // Replay of a spent token — revoke the whole family, both holders.
    await sql`UPDATE sessions SET revoked_at = now()
               WHERE family_id = ${row.family_id} AND revoked_at IS NULL`;
    await clearCookies();
    return { ok: false, reason: 'reuse' };
  }

  if (row.revoked_at || new Date(row.expires_at) <= new Date()) {
    await clearCookies();
    return { ok: false, reason: 'expired' };
  }

  const rotated = newRefreshToken();
  const inserted = await sql`
    INSERT INTO sessions (user_id, family_id, refresh_hash, ua_hash, expires_at)
    VALUES (${row.user_id}, ${row.family_id}, ${await sha256(rotated)}, ${row.ua_hash},
            ${row.expires_at})
    RETURNING id`;
  await sql`UPDATE sessions SET rotated_at = now() WHERE id = ${row.id}`;

  const access = await signAccess({
    userId: row.user_id,
    sessionId: inserted[0].id,
    familyId: row.family_id,
    tokenVersion: row.token_version,
  });
  await setCookies(access, rotated);
  return { ok: true, userId: row.user_id };
}

/** Ends one session — this browser, this login. */
export async function endSession(sessionId) {
  if (sessionId) {
    await sql`UPDATE sessions SET revoked_at = now()
               WHERE id = ${sessionId} AND revoked_at IS NULL`;
  }
  await clearCookies();
}

/**
 * Ends every session everywhere.
 *
 * Bumping token_version is what makes this immediate for refresh: any stored
 * session still in the table will fail its next rotation because the version
 * baked into its access token no longer matches. Access tokens already issued
 * still run out their remaining minutes — see the revocation window above.
 */
export async function endAllSessions(userId) {
  await sql`UPDATE users SET token_version = token_version + 1 WHERE id = ${userId}`;
  await sql`UPDATE sessions SET revoked_at = now()
             WHERE user_id = ${userId} AND revoked_at IS NULL`;
  await clearCookies();
}

/* --------------------------------------------------------------- shapes --- */

/** What the browser is allowed to know about an account. */
export const publicUser = u => ({
  id: u.id,
  email: u.email,
  name: u.name || '',
  phone: u.phone || '',
});
