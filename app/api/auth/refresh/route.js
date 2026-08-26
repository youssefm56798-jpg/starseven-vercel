import { clientIp, rateOk } from '../../../../lib/db.js';
import { ok, fail } from '../../../../lib/http.js';
import { limits } from '../../../../lib/config.js';
import { guardOrigin } from '../../../../lib/auth-guard.js';
import { refreshSession } from '../../../../lib/customer-auth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Exchanges the refresh cookie for a new pair.
 *
 * No JSON body, so guardOrigin rather than the full guard — there is nothing
 * to parse. The origin check still applies: a cross-site page must not be able
 * to spin the rotation and invalidate the real browser's token.
 */
export async function POST(req) {
  const blocked = guardOrigin(req);
  if (blocked) return blocked;

  if (!(await rateOk('c-refresh', clientIp(req), ...limits.cRefresh))) {
    return fail('too-many', 429);
  }

  const result = await refreshSession();
  if (!result.ok) {
    // 'reuse' means a spent token was replayed and the family has just been
    // revoked. The client is told to log in again, not why — the detail is a
    // server-side signal, not something to hand back to whoever asked.
    return fail('unauthenticated', 401);
  }
  return ok();
}
