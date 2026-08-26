import { sql } from './db.js';
import { cleanCartLines, CART_MAX_QTY } from './credentials.js';

/**
 * The signed-in cart.
 *
 * Every function here takes a userId and every statement filters on it. That
 * is the whole of the "each user sees only their own cart" requirement: there
 * is no function in this file that can be asked for a cart by cart id, so a
 * route cannot accidentally offer one. The userId always comes from a verified
 * access token, never from the request body.
 */

/** The user's cart row, created on first use. */
async function cartIdFor(userId) {
  const rows = await sql`
    INSERT INTO carts (user_id) VALUES (${userId})
    ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
    RETURNING id`;
  return rows[0].id;
}

/** This user's lines. Never anyone else's — there is no parameter for that. */
export async function readCart(userId) {
  const rows = await sql`
    SELECT ci.sku, ci.qty
      FROM cart_items ci
      JOIN carts c ON c.id = ci.cart_id
     WHERE c.user_id = ${userId}
     ORDER BY ci.id`;
  return rows.map(r => ({ sku: r.sku, qty: Number(r.qty) }));
}

/**
 * Replaces the cart wholesale.
 *
 * Delete-then-insert rather than a diff: the client sends the basket it
 * believes in, and reconciling two orderings of the same small list is more
 * code and more ways to be wrong than simply rewriting five rows.
 */
export async function replaceCart(userId, lines) {
  const clean = cleanCartLines(lines);
  const cartId = await cartIdFor(userId);

  await sql`DELETE FROM cart_items WHERE cart_id = ${cartId}`;
  for (const line of clean) {
    await sql`
      INSERT INTO cart_items (cart_id, sku, qty)
      VALUES (${cartId}, ${line.sku}, ${line.qty})
      ON CONFLICT (cart_id, sku) DO UPDATE SET qty = EXCLUDED.qty`;
  }
  await sql`UPDATE carts SET updated_at = now() WHERE id = ${cartId}`;
  return clean;
}

/**
 * Folds a guest basket into the signed-in one at login.
 *
 * Quantities are summed rather than overwritten, because both baskets were
 * built on purpose: the one on the phone and the one on the laptop are both
 * things the customer chose. Capped per line, so summing cannot produce a
 * quantity the schema would reject.
 */
export async function mergeCart(userId, incoming) {
  const guest = cleanCartLines(incoming);
  if (!guest.length) return readCart(userId);

  const existing = await readCart(userId);
  const totals = new Map(existing.map(l => [l.sku, l.qty]));
  for (const line of guest) {
    totals.set(line.sku, Math.min(CART_MAX_QTY, (totals.get(line.sku) || 0) + line.qty));
  }
  return replaceCart(userId, [...totals].map(([sku, qty]) => ({ sku, qty })));
}
