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
 * unlike a session this grants exactly one order rather than an identity. The
 * one exception, and the argument for it, is at RECOVERY_TTL_DAYS below.
 *
 * ---------------------------------------------------------------------------
 * One order, several links
 *
 * The single digest lived in orders.access_hash, and one digest per order is
 * a credential that can be issued exactly once. That cost two things.
 *
 * A status email could not link to the order: at the moment an order ships
 * there is no token left to build a URL from, and writing a fresh digest into
 * that one column would have silently killed the link already in the inbox of
 * the customer. And losing the confirmation was a dead end, because there was
 * nothing stored to re-send.
 *
 * db/schema.sql now carries an order_tokens table — a row per link, holding a
 * digest, a purpose and a date. Minting is additive, so a new link never
 * invalidates an old one, which is the whole reason a status email can carry
 * one at all. Everything else is unchanged: the token is in one email and
 * nowhere else, the lookup is still by digest, and the reference in the URL is
 * still checked against the row that digest found.
 *
 * access_hash is still written at checkout and still read here. Both are on
 * purpose and both are temporary — see the note on orderFor() below.
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

/** The purposes a token row may carry. A label, never a permission. */
export const TOKEN_PURPOSES = ['checkout', 'status-mail', 'recovery'];

/**
 * How long a link minted by /order/find stays live.
 *
 * The links a customer is expected to keep — the one in the confirmation, the
 * ones in the status notices — have no expiry, for the reason at the top of
 * this file, which has not changed. This one does, and the argument is narrow:
 * it is the only token a stranger can cause to be minted, and the only one
 * whose loss costs nothing, because the page that made it makes another on
 * request. Thirty days is long enough that a customer who comes back to the
 * mail a fortnight later still gets in.
 */
export const RECOVERY_TTL_DAYS = 30;

/**
 * The order this token opens, or null.
 *
 * Both halves have to agree: the digest finds a row, and that row is the
 * reference the URL claims. A mismatch is treated exactly like a miss — the
 * caller gets null and shows the same "we cannot find that" page either way,
 * so this cannot be used to test whether a reference exists.
 *
 * ---------------------------------------------------------------------------
 * Why two places are searched
 *
 * order_tokens is where every link minted from here on lives, and db/schema.sql
 * copies every existing access_hash into it on deploy. That copy is not enough
 * on its own: the schema is applied during the build, while the PREVIOUS
 * deployment is still taking orders, so an order placed in the minutes between
 * has its digest written to the column by code that knows nothing about the
 * table, and would not be migrated until the next deploy — which could be
 * weeks. Reading both closes that window, and the column keeps being written
 * so that a rollback does not strand it in the other direction.
 *
 * Both halves are single-row index lookups on a digest, which is what keeps
 * the failure uniform in TIME as well as in wording. Searching by reference
 * first would have been simpler to read and would have leaked exactly what
 * this design exists to hide: a reference that exists costs a row fetch and
 * one that does not costs an index miss, and the difference is measurable.
 *
 * The digest is written into the statement twice rather than hoisted into a
 * variable. Reading the query is then enough to see that what reaches the
 * database is a hash and never a token, and tests/order-access.test.mjs holds
 * that line by grepping for it.
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
    UNION ALL
    SELECT o.id, o.ref, o.name, o.phone, o.address, o.city, o.notes, o.lang, o.email,
           o.subtotal, o.shipping, o.discount, o.total, o.coupon, o.status, o.created_at,
           o.refund_requested_at, o.refund_reason
      FROM order_tokens t
      JOIN orders o ON o.id = t.order_id
     WHERE t.token_hash = ${await sha256(token)}
       AND (t.expires_at IS NULL OR t.expires_at > now())
     LIMIT 1`;

  const order = rows[0];
  if (!order || order.ref !== ref) return null;
  return order;
}

/**
 * A fresh link into one order, as its own row.
 *
 * Additive by construction: nothing is updated and nothing is revoked, so the
 * link in the confirmation email keeps working after this runs. That is the
 * property the whole table exists for — the previous design had to overwrite
 * the one digest it had, which is why no status email could ever carry a link.
 *
 * Returns the URL, or '' when it could not mint one. A caller that gets ''
 * sends its message without a button rather than not sending it: a status
 * notice with no link is what the customer used to get anyway, and a notice
 * that never arrives is worse.
 *
 * Casts are not needed here the way they are in the checkout write — these
 * parameters sit in a VALUES list, where each one takes its type from the
 * column above it. It is INSERT ... SELECT that has no column to infer from.
 */
export async function mintOrderLink(order, purpose = 'status-mail') {
  const id = Number(order?.id);
  if (!Number.isInteger(id) || id <= 0) return '';
  if (typeof order?.ref !== 'string' || !order.ref) return '';
  if (!TOKEN_PURPOSES.includes(purpose)) return '';

  const token = newAccessToken();
  try {
    await sql`
      INSERT INTO order_tokens (order_id, token_hash, purpose)
      VALUES (${id}, ${await sha256(token)}, ${purpose})`;
  } catch (e) {
    console.error('[s7] order link mint failed:', e?.message || e);
    return '';
  }
  return orderUrl(order.ref, token, order.lang);
}

/**
 * The order that matches a reference AND the email it was placed with, plus a
 * fresh recovery link for it. Null when there is no such order.
 *
 * This is the half of /order/find that touches the database, kept here rather
 * than in the route so that it can be exercised against a real Postgres by
 * scripts/verify-order-access.mjs — the route imports next/server, which does
 * not resolve outside a Next build, exactly as lib/order-status.js is kept
 * free of it for scripts/verify-order-status.mjs.
 *
 * One statement, and that is the entire point of it.
 *
 * The obvious shape is a SELECT, then an INSERT if the SELECT found something.
 * That endpoint answers "if it matches, we have sent the link" in both cases,
 * but it does not answer in the same time: a hit costs two round trips and a
 * miss costs one, and a few hundred milliseconds of difference turns a page
 * that refuses to confirm anything into a reliable oracle for whether an email
 * and a reference belong together. app/api/subscribe/route.js has the same
 * problem written down at length.
 *
 * Here the mint is a data-modifying CTE fed by the lookup, so the statement
 * sent is byte-for-byte identical either way, and so is the plan: `hit` is a
 * lookup on the unique index over ref, and `minted` inserts one row or none.
 * A data-modifying CTE runs to completion whether or not the outer query reads
 * it, so nothing needs to select from it. What differs between a hit and a
 * miss is one row inserted, inside a statement that was already in flight.
 *
 * The email is compared with lower() rather than trusted to be stored
 * lowercased: checkout lowercases it today, and rows written before it did are
 * still in the table.
 */
export async function issueRecoveryToken(ref, email) {
  if (typeof ref !== 'string' || !/^[A-Za-z0-9-]{1,32}$/.test(ref)) return null;
  const addr = String(email ?? '').trim().toLowerCase();
  if (!addr || addr.length > 190) return null;

  const token = newAccessToken();

  const rows = await sql`
    WITH hit AS (
      SELECT id, ref, email, lang
        FROM orders
       WHERE ref = ${ref} AND lower(email) = ${addr}
       LIMIT 1
    ), minted AS (
      INSERT INTO order_tokens (order_id, token_hash, purpose, expires_at)
      SELECT id, ${await sha256(token)}::text, 'recovery'::text,
             now() + (${String(RECOVERY_TTL_DAYS)} || ' days')::interval
        FROM hit
      RETURNING order_id
    )
    SELECT ref, email, lang FROM hit`;

  const order = rows[0];
  return order ? { order, token } : null;
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
