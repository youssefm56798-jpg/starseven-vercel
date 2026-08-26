import { fail } from './http.js';
import { site } from './config.js';
import { originAllowed } from './credentials.js';
import { currentUser } from './customer-auth.js';

/**
 * The two checks every customer route starts with.
 *
 * Kept in one place so a new endpoint cannot quietly skip one. A route that
 * forgets to call `guard` is a route with no CSRF protection, and that is the
 * kind of omission that is invisible in review — so the tests assert that
 * every route under /api/auth and /api/cart imports this module.
 */

/** Refuses cross-site state changes. Returns a Response, or null to proceed. */
export function guardOrigin(req) {
  if (!originAllowed(req, site.url)) {
    return fail('bad-origin', 403);
  }
  return null;
}

/**
 * Refuses anything that is not a JSON request.
 *
 * A cross-site form post cannot set Content-Type: application/json without a
 * preflight, and a preflight this API never answers. So insisting on JSON is
 * a third independent lock on CSRF, after SameSite and the origin check.
 */
export function guardJson(req) {
  const type = (req.headers.get('content-type') || '').split(';')[0].trim();
  if (type !== 'application/json') return fail('bad-content-type', 415);
  return null;
}

/** Both, for any route that changes state. */
export function guard(req) {
  return guardOrigin(req) || guardJson(req);
}

/**
 * The signed-in customer, or a 401.
 *
 * Returns `{ user }` or `{ response }`. Callers destructure and return the
 * response if it is there — which reads better than a thrown error and makes
 * the unauthenticated path impossible to forget.
 */
export async function requireUser() {
  const user = await currentUser();
  if (!user) return { response: fail('unauthenticated', 401) };
  return { user };
}
