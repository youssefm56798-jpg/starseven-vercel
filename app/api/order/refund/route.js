import { clientIp, rateOk } from '../../../../lib/db.js';
import { ok, fail, readJson } from '../../../../lib/http.js';
import { site, mail } from '../../../../lib/config.js';
import { originAllowed } from '../../../../lib/credentials.js';
import { orderFor, requestRefund } from '../../../../lib/order-access.js';
import { sendMail } from '../../../../lib/mail.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Records a cancellation or refund request against one order.
 *
 * The token in the body is the only credential, and it is re-checked here
 * against the reference exactly as the page checked it — the page having
 * rendered proves nothing about this request. There is no order id parameter,
 * so the row written to is always the one the token unlocked.
 */
export async function POST(req) {
  if (!originAllowed(req, site.url)) return fail('bad-origin', 403);
  if ((req.headers.get('content-type') || '').split(';')[0].trim() !== 'application/json') {
    return fail('bad-content-type', 415);
  }

  // Someone holding one valid token should not be able to hammer this.
  if (!(await rateOk('order-refund', clientIp(req), 20, 3600))) return fail('too-many', 429);

  const { body, tooLarge } = await readJson(req);
  if (tooLarge) return fail('too-large', 413);

  const order = await orderFor(body?.ref, body?.t);
  if (!order) return fail('not-found', 404);

  if (order.status === 'cancelled') return fail('already-cancelled', 409);

  const updated = await requestRefund(order.id, body?.reason);
  if (!updated) return fail('failed', 500);

  // Best effort: the request is already recorded, and a bounced notification
  // must not turn a successful request into an error the customer sees.
  try {
    if (mail.notifyTo) {
      // Every value that lands in this HTML is escaped. order.name is the
      // customer's own free text, stored raw at checkout - the reason field was
      // already being stripped here, but the name beside it was not, so a name
      // of "<a href=//evil>update your address</a>" rendered as a live link in
      // the shop's own inbox. ref and phone are server-shaped and total is
      // numeric, but they go through the same helper rather than trusting that.
      const esc = v => String(v ?? '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const reason = updated.refund_reason || '(no reason given)';
      await sendMail({
        to: mail.notifyTo,
        subject: `Cancellation requested — ${order.ref}`,
        html: `<p><b>${esc(order.ref)}</b> — ${esc(order.name)} (${esc(order.phone)})</p>
               <p>Status: ${esc(order.status)}. Total: ${esc(order.total)}</p>
               <p><b>Reason:</b> ${esc(reason)}</p>`,
        kind: 'refund-request',
      });
    }
  } catch (e) {
    console.error('[s7] refund notify failed:', e?.message || e);
  }

  return ok({ requestedAt: updated.refund_requested_at });
}
