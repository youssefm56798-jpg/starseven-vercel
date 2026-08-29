import { after } from 'next/server';
import { clientIp, rateOk } from '../../../../lib/db.js';
import { ok, fail, readJson } from '../../../../lib/http.js';
import { site, mail } from '../../../../lib/config.js';
import { originAllowed } from '../../../../lib/credentials.js';
import { orderFor } from '../../../../lib/order-access.js';
import { canSelfCancel } from '../../../../lib/order-status.js';
import { transitionAndNotify } from '../../../../lib/order-notify.js';
import { sendMail } from '../../../../lib/mail.js';
import { esc } from '../../_lib/shared.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/order/cancel   { ref, t, reason? }
 *
 * Cancels an order, for real, on the customer's own say-so.
 *
 * The sibling route — /api/order/refund — records a request and waits for a
 * human. That is the right answer once a parcel is moving and the wrong one
 * before it is: an order placed twenty minutes ago that nobody has touched
 * does not need a phone call to stop, and making the customer wait for one is
 * how a two-second correction turns into a support conversation and a driver
 * sent out for nothing.
 *
 * So this handles the part that can be settled without a human, and hands
 * everything else to the request flow. lib/order-status.js draws the line.
 *
 * The token in the body is the only credential, re-checked here against the
 * reference exactly as the page checked it — the page having rendered proves
 * nothing about this request. There is no order id parameter, so the row acted
 * on is always the one the token unlocked.
 */
export async function POST(req) {
  if (!originAllowed(req, site.url)) return fail('bad-origin', 403);
  if ((req.headers.get('content-type') || '').split(';')[0].trim() !== 'application/json') {
    return fail('bad-content-type', 415);
  }

  // Tighter than the refund request's limit, because this one changes state and
  // returns stock. Someone holding a valid token still should not be able to
  // drive it in a loop.
  if (!(await rateOk('order-cancel', clientIp(req), 10, 3600))) return fail('too-many', 429);

  const { body, tooLarge } = await readJson(req);
  if (tooLarge) return fail('too-large', 413);

  const order = await orderFor(body?.ref, body?.t);
  if (!order) return fail('not-found', 404);

  if (order.status === 'cancelled') return fail('already-cancelled', 409);

  /*
   * Too late to do it unsupervised. Answered as a distinct error rather than a
   * flat refusal so the page can swap the button for the request form and say
   * what happened, instead of showing "something went wrong" for an order that
   * is simply already on a van.
   */
  if (!canSelfCancel(order.status)) {
    return fail('too-late', 409, { status: order.status });
  }

  const res = await transitionAndNotify({
    orderId: order.id,
    to: 'cancelled',
    actor: 'customer',
    note: String(body?.reason ?? '').slice(0, 500),
  });

  if (!res.ok) {
    /*
     * The order moved between the status read above and the write. In practice
     * that is an admin marking it shipped while the customer was deciding, and
     * the customer is now in exactly the case the check above catches — so give
     * them the same answer rather than a 500. The transition guard tests the
     * live row, so whichever of the two landed first is the one that stands and
     * this branch is the loser being told so.
     */
    if (res.reason === 'illegal-transition') {
      return fail('too-late', 409, { status: res.from });
    }
    if (res.reason === 'not-found') return fail('not-found', 404);
    return fail('failed', 500);
  }

  /*
   * Tell the shop, and tell it after the response has gone.
   *
   * This is the half that actually matters operationally: the customer already
   * knows they cancelled, and transitionAndNotify has their confirmation in
   * hand. Nobody at the shop knows, and the thing they are about to do is pack
   * an order that no longer exists.
   */
  after(async () => {
    if (!mail.notifyTo) return;
    const reason = String(body?.reason ?? '').trim().slice(0, 500) || '(no reason given)';
    try {
      await sendMail({
        to: mail.notifyTo,
        subject: `Cancelled by customer — ${order.ref}`,
        // Every value escaped. order.name is the customer's own free text,
        // stored raw at checkout, and the sibling route learned this the hard
        // way: a name of "<a href=//evil>update your address</a>" renders as a
        // live link inside the shop's own inbox.
        html: `<p><b>${esc(order.ref)}</b> — ${esc(order.name)} (${esc(order.phone)})</p>
               <p>Cancelled by the customer from the order page. Was: ${esc(res.from)}.</p>
               <p>Stock and any coupon use have been returned automatically.</p>
               <p><b>Reason:</b> ${esc(reason)}</p>`,
        kind: 'cancel-customer',
      });
    } catch (e) {
      console.error('[s7] cancel notify failed:', e?.message || e);
    }
  });

  return ok({ status: 'cancelled', from: res.from });
}
