import { sql } from './db.js';
import { localeUrl } from './urls.js';

/**
 * Getting back to your own order, without an account.
 *
 * This shop takes cash at the door. The only thing a customer ever wants to
 * come back for is the state of one order — has it shipped, can I cancel it —
 * and asking them to invent a password for that is friction with no payoff.
 *
 * So: email is mandatory at checkout, the confirmation carries a link, and the
 * link is the credential.
 *
 *   /order/S7-2708-1234?t=<32 random bytes, base64url>
 *
 * The token is never stored. What goes in the database is its SHA-256, so a
 * dump of `orders` yields nothing that can be replayed to read somebody's
 * address. The lookup is by digest, and the reference in the URL is checked
 * against the row that digest found — so guessing a reference gets you nothing
 * without the token, and holding a token for one order tells you nothing about
 * any other.
 *
 * No expiry. A customer chasing a refund six weeks later still needs it, and
 * unlike a session this grants exactly one order rather than an identity.
 */

const hex = buf => Array.from(new Uint8Array(buf))
  .map(b => b.toString(16).padStart(2, '0')).join('');

export async function sha256(value) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value))));
}

/** 32 random bytes, base64url. Opaque — there is nothing in it to guess at. */
export function newAccessToken() {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...raw))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The link that goes in the confirmation email. */
export function orderUrl(ref, token, lang) {
  return `${localeUrl(`/order/${encodeURIComponent(ref)}`, lang)}?t=${encodeURIComponent(token)}`;
}

/**
 * The order this token opens, or null.
 *
 * Both halves have to agree: the digest finds a row, and that row is the
 * reference the URL claims. A mismatch is treated exactly like a miss — the
 * caller gets null and shows the same "we cannot find that" page either way,
 * so this cannot be used to test whether a reference exists.
 */
export async function orderFor(ref, token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  if (typeof ref !== 'string' || !/^[A-Za-z0-9-]{1,32}$/.test(ref)) return null;

  const rows = await sql`
    SELECT id, ref, name, phone, address, city, notes, lang, email,
           subtotal, shipping, discount, total, coupon, status, created_at,
           refund_requested_at, refund_reason
      FROM orders
     WHERE access_hash = ${await sha256(token)}
     LIMIT 1`;

  const order = rows[0];
  if (!order || order.ref !== ref) return null;
  return order;
}

/** The lines on an order. Only ever called with an order already unlocked. */
export async function itemsFor(orderId) {
  const rows = await sql`
    SELECT sku, name, price, qty FROM order_items
     WHERE order_id = ${orderId} ORDER BY id`;
  return rows.map(r => ({ ...r, price: Number(r.price), qty: Number(r.qty) }));
}

/**
 * Records that the customer wants to cancel or be refunded.
 *
 * It does not cancel anything. On a cash-on-delivery shop the decision is a
 * human one — the parcel may already be with the courier — so this records the
 * request, stamps the time, and leaves the status to the admin. Writing it
 * against the order the token already unlocked means there is no id to tamper
 * with.
 */
export async function requestRefund(orderId, reason) {
  const clean = String(reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
  const rows = await sql`
    UPDATE orders
       SET refund_requested_at = COALESCE(refund_requested_at, now()),
           refund_reason = CASE WHEN ${clean} = '' THEN refund_reason ELSE ${clean} END
     WHERE id = ${orderId}
     RETURNING ref, refund_requested_at, refund_reason`;
  return rows[0] || null;
}
