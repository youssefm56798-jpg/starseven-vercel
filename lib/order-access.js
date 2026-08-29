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

  /*
   * The two window columns are read as text, not as dates.
   *
   * They are DATE in Postgres, and the driver hands a DATE back as a JS Date
   * built at LOCAL midnight. On a machine running anywhere behind UTC that is
   * the previous day the moment anything formats it in another zone, which is
   * a whole class of off-by-one that only shows up for some deployments and
   * some months of the year. ::text keeps them as the calendar days they are,
   * and lib/delivery-eta.js takes YYYY-MM-DD from end to end.
   */
  const rows = await sql`
    SELECT id, ref, name, phone, address, city, notes, lang, email,
           subtotal, shipping, discount, total, coupon, status, created_at,
           refund_requested_at, refund_reason, cancelled_at,
           expected_from::text AS expected_from,
           expected_to::text   AS expected_to,
           courier, tracking_ref
      FROM orders
     WHERE access_hash = ${await sha256(token)}
     LIMIT 1`;

  const order = rows[0];
  if (!order || order.ref !== ref) return null;
  return order;
}

/**
 * The order timeline, as much of it as a customer is allowed to see.
 *
 * order_events is one table doing two jobs on purpose — the shop audit log and
 * the customer history — so the difference between the two has to be a query,
 * and this is it. lib/order-status.js keeps eventsFor(), which returns the row
 * whole for the admin screen. This lives here instead, next to the token that
 * unlocked the order, because deciding what a credential entitles someone to
 * read is the job of this module and not of the state machine.
 *
 * ---------------------------------------------------------------------------
 * What is left out, and why
 *
 * The filtering is done in SQL rather than in the component. A projection that
 * never selects a column cannot leak it through a rendering mistake later, and
 * "we remembered not to print it" is not a guarantee anyone can check.
 *
 *   actor        never selected. It holds 'admin:4', 'system', 'customer' and
 *                whatever a webhook calls itself. The admin id is an internal
 *                identifier and printing it tells a customer how many staff
 *                the shop has and which one touched their order; none of the
 *                other values mean anything to them either. The admin screen
 *                shows it because that is what an audit trail is for.
 *
 *   kind='note'  never returned. These are internal notes typed in the admin
 *                panel - "rang twice, no answer", "address looks fake" - and
 *                they are written on the assumption that the customer is not
 *                reading them. Surfacing them would be the single most
 *                damaging thing this page could do.
 *
 *   kind='mail'  never returned. The note on these is "confirmed notice sent"
 *                or "confirmed notice FAILED", which is the shop watching its
 *                own plumbing. It is also one row per status change, so
 *                showing them would print every step of the timeline twice.
 *
 *   note on a    never returned. transition() takes a free-text note from
 *   status row   whoever called it, and every caller is the shop. It reads
 *                like a private remark because it is one.
 *
 * What is left is the two things that are genuinely the customer's own: the
 * status changes, which they were emailed about anyway - so hiding one here
 * would make this page disagree with their inbox - and their own cancellation
 * request, including the reason, because they typed it.
 *
 * Status moves that walk backwards are shown as they happened rather than
 * tidied away. An admin who marks an order shipped by mistake and corrects it
 * has sent the customer two emails, and a history that quietly drops one of
 * them is the version that gets argued about on the phone.
 */
export async function timelineFor(orderId) {
  const id = Number(orderId);
  if (!Number.isInteger(id) || id <= 0) return [];

  return sql`
    SELECT id, kind, to_status,
           CASE WHEN kind = 'refund-request' THEN note ELSE '' END AS note,
           created_at
      FROM order_events
     WHERE order_id = ${id}
       AND kind IN ('status', 'refund-request')
     ORDER BY id`;
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
