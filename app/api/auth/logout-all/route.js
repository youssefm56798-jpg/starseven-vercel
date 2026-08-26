import { ok } from '../../../../lib/http.js';
import { guardOrigin, requireUser } from '../../../../lib/auth-guard.js';
import { endAllSessions } from '../../../../lib/customer-auth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Signs the account out of every browser it is signed into. */
export async function POST(req) {
  const blocked = guardOrigin(req);
  if (blocked) return blocked;

  const { user, response } = await requireUser();
  if (response) return response;

  await endAllSessions(user.id);
  return ok();
}
