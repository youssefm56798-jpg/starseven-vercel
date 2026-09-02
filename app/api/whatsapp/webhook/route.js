import { sql } from '../../../../lib/db.js';
import { signatureValid, verifyChallenge, parseWebhook } from '../../../../lib/whatsapp.js';
import { normaliseRef, isRef } from '../../../../lib/order-number.js';
import { transitionAndNotify } from '../../../../lib/order-notify.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The WhatsApp order-confirmation webhook.
 *
 * ---------------------------------------------------------------------------
 * What it is for
 *
 * Placing an order here costs an attacker nothing — no card, no deposit — and
 * every order takes stock the moment it is accepted. So the shop asks the phone
 * number to prove it exists: a template message goes out at checkout with two
 * buttons, and this is where the answer arrives.
 *
 * ANY reply verifies the number. A tap of Confirm, a tap of Not me, or typed
 * text — all three prove a live WhatsApp account received our message, which is
 * the thing a fake number cannot do. Only the Not-me button additionally
 * cancels. See lib/config.js for what verification then buys the order.
 *
 * ---------------------------------------------------------------------------
 * This URL is public, and the signature is the only thing guarding it
 *
 * Meta has to be able to reach it, so anybody can. A POST here claims "the
 * customer on order #100001 replied", and acting on that claim keeps an order's
 * stock and can cancel an order outright. Unsigned, one curl command confirms
 * every order on the shop — handing back the exact abuse the confirmation
 * exists to prevent, with a public endpoint attached.
 *
 * So: the raw body is read as text and verified BEFORE it is parsed as JSON,
 * and before a single row is read. lib/whatsapp.js holds the comparison and the
 * reasons it is shaped the way it is.
 *
 * ---------------------------------------------------------------------------
 * Always 200, once it is authentic
 *
 * Meta retries until it gets a 200, and a retry storm is worse than a dropped
 * event: it multiplies whatever went wrong. So an authentic request that this
 * app then fails to make sense of is still answered 200 and logged, rather than
 * being demanded again every few minutes for a day.
 *
 * The exception is the signature itself, which answers 403 and means it. There
 * is nothing to retry about a request that was not from Meta.
 */

/** Bodies from Meta are small. Anything larger is not one. */
const MAX_BODY = 128 * 1024;

/* -------------------------------------------------------------- the handshake */

/**
 * Meta calls this once, when the webhook URL is first saved in the app
 * dashboard, and echoing the challenge is what proves we own the endpoint.
 *
 * It is a GET with no signature — there is no body to sign — so the shared
 * verify token is the whole of the authentication, and it is compared in
 * constant time in lib/whatsapp.js.
 */
export async function GET(req) {
  const challenge = verifyChallenge(
    new URL(req.url).searchParams,
    process.env.WHATSAPP_VERIFY_TOKEN || '',
  );

  if (!challenge) return new Response('forbidden', { status: 403 });

  // Plain text, and exactly the challenge. Meta compares it byte for byte.
  return new Response(challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
  });
}

/* ------------------------------------------------------------------- events */

/**
 * Claim one webhook event id, returning false if it was already handled.
 *
 * Meta retries on any slow response, so the same tap of Confirm arrives more
 * than once as a matter of course. Without this, one reply could cancel an
 * order, have it restocked, and then be acted on again.
 *
 * The same shape as the checkout's idempotency claim: an INSERT guarded by a
 * unique key, where losing the race is the answer rather than an error. A
 * duplicate arriving while the first is still in flight blocks on the
 * uncommitted row and then finds it, which is the case a check-then-act misses.
 */
async function claim(eventId, kind) {
  const rows = await sql`
    INSERT INTO wa_events (event_id, kind)
    VALUES (${eventId}, ${kind})
    ON CONFLICT (event_id) DO NOTHING
    RETURNING event_id`;
  return rows.length > 0;
}

/**
 * The order a reply belongs to, or null.
 *
 * Two ways in, and the order of preference is the security argument:
 *
 *   context   the id of OUR outbound message, which Meta echoes on a reply.
 *             Unguessable, because we minted it and it is stored on the order.
 *             This is the good path.
 *   payload   the order number we put in the button. Guessable by design —
 *             #100002 follows #100001 — so it is only ever accepted together with
 *             the phone number matching the order it names.
 *
 * The phone is checked on BOTH paths regardless. The signature is what makes
 * the payload trustworthy at all; this is the second lock, so that a leaked app
 * secret alone is not enough to confirm somebody else's order.
 */
async function orderForReply(reply) {
  if (reply.context) {
    const [row] = await sql`
      SELECT id, ref, status, phone, phone_verified_at
        FROM orders
       WHERE wa_message_id = ${reply.context} AND phone = ${reply.from}
       LIMIT 1`;
    if (row) return row;
  }

  const ref = normaliseRef(reply.payload);
  if (!isRef(ref)) return null;

  const [row] = await sql`
    SELECT id, ref, status, phone, phone_verified_at
      FROM orders
     WHERE ref = ${ref} AND phone = ${reply.from}
     LIMIT 1`;
  return row || null;
}

/** Buttons whose payload means "this was not me". Everything else is a yes. */
const REJECT = /^(no|cancel|not-?me)\b/i;

export async function POST(req) {
  const secret = process.env.WHATSAPP_APP_SECRET || '';

  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY) return new Response('too large', { status: 413 });

  // Read as TEXT and verify these exact bytes. Parsing first and re-serialising
  // would change key order and whitespace, so the digest would never match.
  const raw = await req.text();
  if (raw.length > MAX_BODY) return new Response('too large', { status: 413 });

  if (!signatureValid(raw, req.headers.get('x-hub-signature-256'), secret)) {
    // Deliberately terse, and deliberately not retried by us. There is nothing
    // to say to a caller that could not sign, and nothing to log about it that
    // is not a way to fill the log on demand.
    return new Response('forbidden', { status: 403 });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    // Authentic but unparseable. 200, so Meta stops.
    console.error('[s7] whatsapp webhook: signed body was not JSON');
    return Response.json({ ok: true });
  }

  const { replies, statuses } = parseWebhook(body);

  /* ------------------------------------------------------------- deliveries */

  for (const s of statuses) {
    if (!(await claim(`status:${s.id}:${s.status}`, 'status'))) continue;

    /*
     * `delivered` is what earns an order the short hold, and it is the whole
     * reason this branch exists. An order whose warning never arrived keeps the
     * long one: cancelling somebody who was never told is precisely the
     * unfairness the warning is there to prevent, so a failed send must not
     * shorten anything.
     *
     * COALESCE so a re-delivery cannot move a stamp the sweep has already read,
     * and so the earliest delivery is the one that counts.
     */
    if (s.status === 'delivered') {
      await sql`
        UPDATE orders
           SET wa_delivered_at = COALESCE(wa_delivered_at, now())
         WHERE wa_message_id = ${s.id}`;
    } else {
      console.error('[s7] whatsapp delivery failed for message', s.id);
    }
  }

  /* ---------------------------------------------------------------- replies */

  for (const reply of replies) {
    if (!(await claim(`msg:${reply.id}`, 'reply'))) continue;

    const order = await orderForReply(reply);
    if (!order) {
      // Somebody messaging the shop's WhatsApp who is not answering an order —
      // a real customer asking a question, most likely. Nothing to do here; it
      // is a conversation for a human, in the inbox.
      continue;
    }

    /*
     * Verified, whatever they said.
     *
     * The tap and the typed reply are worth the same thing to this column: both
     * prove a live WhatsApp account received our message on that number, which
     * is the fact the whole exchange exists to establish. Reading intent out of
     * Egyptian dialect free text would be guessing, and guessing wrong here
     * either cancels an order somebody wanted or keeps one they refused.
     *
     * COALESCE for the same reason as above: the first answer is the one that
     * counts, and a later message must not restart anything.
     */
    await sql`
      UPDATE orders
         SET phone_verified_at = COALESCE(phone_verified_at, now())
       WHERE id = ${order.id}`;

    /*
     * And only an explicit No cancels.
     *
     * Through transitionAndNotify, like every other cancel in this app — it
     * owns the legal moves, the restock, the coupon return and the audit row,
     * and a second implementation here is how stock gets credited twice. An
     * order already past `new` is refused by the guard inside it, which is the
     * right answer: once the shop has confirmed the order by phone, a stray tap
     * days later must not unpick it.
     */
    if (REJECT.test(reply.payload)) {
      const res = await transitionAndNotify({
        orderId: order.id,
        to: 'cancelled',
        actor: 'customer:whatsapp',
        note: 'Customer said this was not their order, from the WhatsApp confirmation.',
      });
      if (!res.ok) {
        console.error('[s7] whatsapp cancel refused for', order.ref, res.reason);
      }
    }
  }

  return Response.json({ ok: true });
}
