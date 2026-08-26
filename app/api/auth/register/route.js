import { sql, clientIp, rateOk } from '../../../../lib/db.js';
import { ok, fail, readJson } from '../../../../lib/http.js';
import { limits } from '../../../../lib/config.js';
import { guard } from '../../../../lib/auth-guard.js';
import {
  normaliseEmail, emailOk, passwordProblem, cleanName, cleanCartLines,
} from '../../../../lib/credentials.js';
import { hashPassword, startSession, publicUser } from '../../../../lib/customer-auth.js';
import { replaceCart } from '../../../../lib/server-cart.js';

// bcrypt at cost 12 is far too slow for an edge function, and this route also
// needs the Node crypto surface.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  const blocked = guard(req);
  if (blocked) return blocked;

  const ip = clientIp(req);
  if (!(await rateOk('c-register', ip, ...limits.cRegister))) {
    return fail('too-many', 429);
  }

  const { body, tooLarge } = await readJson(req);
  if (tooLarge) return fail('too-large', 413);

  const email = normaliseEmail(body.email);
  if (!emailOk(email)) return fail('bad-email', 400);

  const pwProblem = passwordProblem(body.password, email);
  if (pwProblem) return fail('bad-password', 400, { reason: pwProblem });

  const name = cleanName(body.name);
  const phone = cleanName(body.phone, 32);

  // Hash before the insert, so a duplicate address costs the same time as a
  // new one. Doing it after would let an attacker time the difference and read
  // off which addresses already have accounts here.
  const hash = await hashPassword(body.password);

  const rows = await sql`
    INSERT INTO users (email, password_hash, name, phone)
    VALUES (${email}, ${hash}, ${name}, ${phone})
    ON CONFLICT (lower(email)) DO NOTHING
    RETURNING id, email, name, phone, token_version`;

  // Address already registered. Deliberately the same shape and status as a
  // success would be if we were hiding it — but registration cannot hide a
  // collision and still work, so this says so plainly rather than pretending.
  if (!rows[0]) return fail('email-taken', 409);

  const user = rows[0];
  await startSession(user);

  // A basket built before signing up should survive signing up.
  const merged = cleanCartLines(body.cart);
  if (merged.length) await replaceCart(user.id, merged);

  return ok({ user: publicUser(user) });
}
