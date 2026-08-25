import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

/**
 * Admin sessions.
 *
 * PHP sessions do not exist on serverless, so login state travels in a signed,
 * HttpOnly cookie instead. The signing secret never leaves the server, so a
 * visitor can neither forge a session nor edit the one they hold.
 */
const COOKIE = 's7_admin';
const MAX_AGE = 60 * 60 * 8; // 8 hours

function secret() {
  const s = process.env.SESSION_SECRET || '';
  if (s.length < 16) throw new Error('SESSION_SECRET is missing or too short');
  return new TextEncoder().encode(s);
}

export async function createSession(admin) {
  const token = await new SignJWT({ id: admin.id, name: admin.name || admin.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  (await cookies()).set(COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}

/** The signed-in admin, or null. Never throws on a malformed cookie. */
export async function currentAdmin() {
  try {
    const token = (await cookies()).get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret());
    return { id: payload.id, name: payload.name };
  } catch {
    return null;
  }
}

/**
 * CSRF: admin forms carry a token derived from the session cookie. An attacker
 * on another origin cannot read the cookie, so cannot produce a matching token.
 */
export async function csrfToken() {
  const token = (await cookies()).get(COOKIE)?.value || 'anon';
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
