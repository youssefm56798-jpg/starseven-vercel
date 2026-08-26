import { sql } from '../../../../lib/db.js';
import { ok, fail } from '../../../../lib/http.js';
import { requireUser } from '../../../../lib/auth-guard.js';
import { publicUser } from '../../../../lib/customer-auth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Who am I.
 *
 * This one does read the database, because it returns the profile rather than
 * just proving identity — but it is called on demand by the account page, not
 * on every render. The identity itself still comes from the token.
 */
export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;

  const rows = await sql`
    SELECT id, email, name, phone, token_version FROM users WHERE id = ${user.id} LIMIT 1`;
  if (!rows[0]) return fail('unauthenticated', 401);

  // The token carries the version it was minted with. If the account has since
  // been signed out everywhere, that number moved and this token is stale even
  // though its signature is still good.
  if (Number(rows[0].token_version) !== Number(user.tokenVersion)) {
    return fail('unauthenticated', 401);
  }

  return ok({ user: publicUser(rows[0]) });
}
