import { ok, fail, readJson } from '../../../lib/http.js';
import { guard, requireUser } from '../../../lib/auth-guard.js';
import { readCart, replaceCart } from '../../../lib/server-cart.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The signed-in cart.
 *
 * Note what is absent: there is no cart id, no user id and no customer
 * parameter anywhere in this file. The only identity available to it is the
 * one lib/customer-auth verified from the cookie, so "show me someone else's
 * cart" is not a request that can be phrased.
 */
export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  return ok({ cart: await readCart(user.id) });
}

export async function PUT(req) {
  const blocked = guard(req);
  if (blocked) return blocked;

  const { user, response } = await requireUser();
  if (response) return response;

  const { body, tooLarge } = await readJson(req);
  if (tooLarge) return fail('too-large', 413);

  return ok({ cart: await replaceCart(user.id, body.cart) });
}
