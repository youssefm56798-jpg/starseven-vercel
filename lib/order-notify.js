import { after } from 'next/server';
import { sql } from './db.js';
import { sendMail } from './mail.js';
import { transition, logEvent } from './order-status.js';
import { tplStatus } from './order-mail.js';

/**
 * Moving an order, and telling the customer about it.
 *
 * This is the entry point every route uses. transition() on its own is
 * correct but silent, and a status change nobody is told about is most of the
 * value of having statuses at all.
 *
 * ---------------------------------------------------------------------------
 * Why this is a separate module rather than a few lines inside transition()
 *
 * after() comes from next/server. Importing it into lib/order-status.js would
 * make the state machine — the part of this codebase most worth being able to
 * test in isolation — depend on a request being in flight, and would break
 * scripts/verify-order-status.mjs, which runs the module against a real
 * Postgres outside Next entirely. So the transaction stays framework-free and
 * the framework-shaped half lives here.
 *
 * The cost of splitting them is that a caller could reach past this and call
 * transition() directly, and the order would move without a word. That is what
 * the import test in tests/order-status.test.mjs is for: nothing under app/ may
 * import transition, only this.
 *
 * ---------------------------------------------------------------------------
 * Why the send is deferred
 *
 * after() runs the callback once the response has been sent. Awaiting Resend
 * inline would put a few hundred milliseconds of somebody else's HTTP request
 * between an admin pressing Save and the page coming back, for a side effect
 * the admin is not waiting on. app/api/subscribe/route.js already does this,
 * for the same reason plus one of its own.
 *
 * It also decouples the failure. The order has already moved and the audit row
 * is already written by the time this runs; a bounced notification must not be
 * able to turn a committed status change into an error, and after the response
 * has gone there is nothing left for it to break.
 */

/**
 * Move an order, then tell the customer.
 *
 * Same result shape as transition(), which it returns untouched — the mail is a
 * consequence of the move, never a condition of it.
 *
 * `notify: false` moves the order silently. It exists for a bulk correction
 * where the shop is fixing its own bookkeeping and mailing every affected
 * customer would be worse than saying nothing.
 */
export async function transitionAndNotify({ orderId, to, actor = 'system', note = '', notify = true }) {
  const res = await transition({ orderId, to, actor, note });

  // Nothing moved: an illegal move, a missing order, or a save of the status it
  // was already on. None of the three is news.
  if (!res.ok || !res.changed || !notify) return res;

  after(() => notifyStatus(orderId, to).catch(e => {
    console.error('[s7] status mail failed:', e?.message || e);
  }));

  return res;
}

/**
 * Send the one message for a status the customer hears about.
 *
 * Separate and exported so a webhook or a retry can send without moving
 * anything, and so the failure paths can be read in one place. It never
 * throws — every branch that cannot send returns false instead, because every
 * caller is inside an after() where a rejection is invisible anyway.
 */
export async function notifyStatus(orderId, status) {
  const rows = await sql`
    SELECT id, ref, name, phone, email, lang, total
      FROM orders WHERE id = ${orderId} LIMIT 1`;

  const order = rows[0];
  if (!order) return false;

  // Email became mandatory at checkout, but rows written before that did not
  // have one, and a blank address is not an error worth logging every time.
  if (!order.email) return false;

  const built = tplStatus(order, status, order.lang === 'en' ? 'en' : 'ar');
  if (!built) return false;

  const [subject, html] = built;
  const sent = await sendMail({ to: order.email, subject, html, kind: `order-${status}` });

  // Onto the order timeline, so the shop can see what the customer was told and
  // when — which is the first question asked when somebody rings up saying they
  // were never informed. sendMail already records the send in email_log; this
  // is the same fact on the order it belongs to.
  await logEvent({
    orderId,
    kind: 'mail',
    actor: 'system',
    note: sent ? `${status} notice sent` : `${status} notice FAILED`,
  });

  return sent;
}
