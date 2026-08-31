import { sql } from '../../../../lib/db.js';
import { ok, fail } from '../../../../lib/http.js';
import { orderHoldHours } from '../../../../lib/config.js';
import { transitionAndNotify } from '../../../../lib/order-notify.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/release — give back the stock that unconfirmed orders are
 * sitting on.
 *
 * ---------------------------------------------------------------------------
 * What this is for
 *
 * Placing an order on this shop costs nothing. There is no card, no deposit,
 * and nothing a customer types is verified — that is what cash on delivery
 * means. Every accepted order decrements `products.stock` immediately, and
 * until this route existed there was no path by which that stock came back
 * except a human opening the order and pressing Cancel.
 *
 * So the cheapest attack on this shop was never the checkout arithmetic, which
 * recomputes everything from the database and cannot be moved from a browser.
 * It was volume: a script placing orders for twenty of everything takes the
 * whole catalogue to "out of stock" for real customers and there it stays. The
 * rate limits slow one attacker down; they do nothing about the stock the
 * orders that got through are already holding.
 *
 * An unconfirmed order now holds its stock for `ORDER_HOLD_HOURS` and no
 * longer. Past that this cancels it, which credits the stock back and returns
 * any coupon redemption — an attack drains the shop for one window and then
 * heals without anybody being woken up.
 *
 * ---------------------------------------------------------------------------
 * It does not have its own idea of what cancelling means
 *
 * Every order goes out through transitionAndNotify(), the same call the admin
 * panel and the customer's own Cancel button use. That is deliberate and it is
 * the rule lib/order-status.js is built on: one writer for the status column,
 * so the restock, the coupon return and the audit row cannot drift apart per
 * caller. This file decides WHICH orders and nothing else about what happens
 * to them.
 *
 * The customer is emailed, in the ordinary cancellation wording, which ends by
 * inviting them to say if they still want it. A real order that slipped past
 * the window is recoverable by a reply rather than by silence.
 *
 * ---------------------------------------------------------------------------
 * Only `new`, and never anything further along
 *
 * The moment somebody at the shop presses Confirm, there is a real person on
 * the end of a real phone call and no timer touches that order again, however
 * long the delivery then takes. `new` means nobody has looked at it yet, and
 * ORDER_HOLD_HOURS is set well past the slowest honest call-back — see
 * lib/config.js, which carries that argument and the cost of getting it wrong.
 */

/**
 * How many orders one run will cancel.
 *
 * A cap rather than "all of them", for two reasons that both point the same
 * way. Each cancellation is its own transaction plus an email, so a run that
 * found ten thousand orders would sit on the function until it timed out and
 * commit an arbitrary prefix of its work. And a backlog that large is either an
 * attack in progress or this route having been broken for a week; in both cases
 * chewing through it steadily across several runs is better than one enormous
 * burst of mail.
 *
 * Whatever is left over is picked up by the next run, because the query re-reads
 * the live table every time. `remaining` in the reply says how much is left.
 */
const BATCH = 50;

/**
 * Whether this request really came from the scheduler.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` on every invocation,
 * but ONLY when CRON_SECRET is set on the project. With the variable unset it
 * sends no header at all — and an endpoint that treated a missing header as
 * "must be the scheduler then" would be a public URL that cancels orders.
 *
 * So this fails closed in both directions: no secret configured means nothing
 * is authorised, including the scheduler. A sweep that is not running is a
 * visible problem (stock stops coming back, and the reply below says why); a
 * sweep anybody can trigger is an invisible one.
 *
 * The comparison is length-checked first and then done character by character
 * over the whole string, so it does not return early on the first byte that
 * differs. A timing oracle on a secret this valuable is not worth saving three
 * lines over.
 */
function authorised(req) {
  const secret = process.env.CRON_SECRET || '';
  if (secret.length < 16) return false;

  const given = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (given.length !== secret.length) return false;

  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= given.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

export async function GET(req) {
  if (!authorised(req)) return fail('forbidden', 403);

  // Turned off. Answered as a success rather than an error: the scheduler is
  // behaving correctly and there is nothing wrong with a shop that has chosen
  // to hold stock indefinitely — it is simply the behaviour this route exists
  // to change, and the reply says so rather than leaving it to be guessed at.
  if (!orderHoldHours) {
    return ok({ swept: 0, remaining: 0, disabled: true, reason: 'ORDER_HOLD_HOURS is 0' });
  }

  /*
   * The candidates, oldest first.
   *
   * `created_at` and not any of the edit stamps: the question is how long this
   * order has been sitting unconfirmed, and an admin correcting an address on
   * it is not the shop confirming it. The status test is the real guard — an
   * order somebody has touched is not `new` any more.
   *
   * The interval is built from a parameter cast to text, the same shape
   * rateOk() uses in lib/db.js, because an interval literal cannot take a bare
   * parameter.
   */
  const stale = await sql`
    SELECT id, ref
      FROM orders
     WHERE status = 'new'
       AND created_at < now() - (${String(orderHoldHours)} || ' hours')::interval
     ORDER BY id ASC
     LIMIT ${BATCH + 1}`;

  const batch = stale.slice(0, BATCH);
  const more = stale.length > BATCH;

  const cancelled = [];
  const failed = [];

  for (const order of batch) {
    /*
     * One at a time, and a refusal is not a failure of the run.
     *
     * Between the read above and this call an admin may have confirmed the
     * order, or the customer may have cancelled it themselves. transition()
     * tests the live row, so whichever of the two landed first stands and this
     * one is told it lost — which is the correct outcome, not an error. The
     * loop carries on; only a genuine fault is collected.
     */
    try {
      const res = await transitionAndNotify({
        orderId: order.id,
        to: 'cancelled',
        actor: 'system:hold-expired',
        note: `Not confirmed within ${orderHoldHours}h — stock released automatically.`,
      });
      if (res.ok && res.changed) cancelled.push(order.ref);
    } catch (e) {
      console.error('[s7] hold release failed:', order.ref, e?.message || e);
      failed.push(order.ref);
    }
  }

  if (cancelled.length || failed.length) {
    console.log(`[s7] hold release: cancelled ${cancelled.length}, failed ${failed.length}`);
  }

  return ok({
    swept: cancelled.length,
    failed: failed.length,
    // Only ever "there is at least one more page", never a count: counting the
    // whole backlog is a second scan of the table to print a number nobody acts
    // on differently from a boolean.
    remaining: more,
    holdHours: orderHoldHours,
  });
}
