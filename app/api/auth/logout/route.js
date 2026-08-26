import { ok } from '../../../../lib/http.js';
import { guardOrigin } from '../../../../lib/auth-guard.js';
import { currentUser, endSession } from '../../../../lib/customer-auth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Ends this session.
 *
 * Always returns ok, even with no session or a expired one: logging out is
 * idempotent, and telling an anonymous caller whether they held a valid
 * session is a small free oracle with no upside.
 */
export async function POST(req) {
  const blocked = guardOrigin(req);
  if (blocked) return blocked;

  const user = await currentUser();
  await endSession(user?.sessionId);
  return ok();
}
