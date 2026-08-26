import { sql, clientIp, rateOk } from '../../../../lib/db.js';
import { ok, fail, readJson } from '../../../../lib/http.js';
import { limits } from '../../../../lib/config.js';
import { guard } from '../../../../lib/auth-guard.js';
import { normaliseEmail, emailOk } from '../../../../lib/credentials.js';
import {
  verifyPassword, startSession, publicUser, DUMMY_HASH, sha256,
} from '../../../../lib/customer-auth.js';
import { mergeCart } from '../../../../lib/server-cart.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  const blocked = guard(req);
  if (blocked) return blocked;

  const ip = clientIp(req);
  const { body, tooLarge } = await readJson(req);
  if (tooLarge) return fail('too-large', 413);

  const email = normaliseEmail(body.email);
  const password = String(body.password ?? '');

  // Two independent buckets. The IP bucket stops one host working through a
  // list of addresses; the account bucket stops a botnet working through
  // passwords for one address. The account bucket is keyed by a digest so the
  // rate_limits table never holds a list of customer email addresses.
  const underIp = await rateOk('c-login-ip', ip, ...limits.cLoginIp);
  const underAccount = emailOk(email)
    ? await rateOk('c-login-acct', await sha256(email), ...limits.cLoginAccount)
    : true;
  if (!underIp || !underAccount) return fail('too-many', 429);

  const rows = emailOk(email)
    ? await sql`
        SELECT id, email, name, phone, password_hash, token_version
          FROM users WHERE lower(email) = ${email} LIMIT 1`
    : [];

  const user = rows[0] || null;

  // The compare runs either way. Against a real hash when the account exists,
  // against a fixed one when it does not — so an unknown address costs the
  // same 200-odd milliseconds as a wrong password, and response time stops
  // answering "does this person shop here".
  const matched = await verifyPassword(password, user?.password_hash || DUMMY_HASH);

  if (!user || !matched) return fail('bad-credentials', 401);

  await startSession(user);
  await sql`UPDATE users SET last_login_at = now() WHERE id = ${user.id}`;

  // Whatever was in the guest basket joins whatever is already on the account.
  const cart = await mergeCart(user.id, body.cart);

  return ok({ user: publicUser(user), cart });
}
