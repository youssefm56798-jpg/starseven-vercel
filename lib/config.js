/** Runtime configuration, all from environment variables (set in Vercel). */
export const site = {
  name: 'New Star Seven',
  url: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
  whatsapp: process.env.NEXT_PUBLIC_WHATSAPP || '201028282216',
  currency: 'EGP',
  shipping: Number(process.env.SHIPPING_FEE ?? 30),
  freeOver: Number(process.env.FREE_DELIVERY_OVER ?? 300),
};

/**
 * How long an order nobody has confirmed keeps holding its stock.
 *
 * ---------------------------------------------------------------------------
 * The problem this exists for
 *
 * This shop takes cash at the door. There is no card, no deposit and no
 * verification of anything a customer types — which means placing an order
 * costs an attacker nothing at all, and every accepted order decrements
 * `products.stock` on the spot. A script that walks the catalogue putting
 * twenty of everything into an order can take the entire shop to "out of
 * stock" for real customers, and the only cost is the couriers dispatched to
 * addresses that do not want anything.
 *
 * The per-network rate limit below caps how fast one attacker does that. It
 * does not cap the total, because the limit is per network and networks are
 * cheap, and it does nothing at all about the stock those orders are already
 * sitting on. Nothing in the shop gave that stock back except a human noticing
 * and cancelling each order by hand.
 *
 * So an unconfirmed order now holds its stock for a bounded time rather than
 * for ever. Past this window the sweep at /api/cron/release cancels it, which
 * puts the stock back and returns any coupon redemption, through exactly the
 * same transition() every other cancel goes through. An attack drains the shop
 * for a window and then heals on its own.
 *
 * ---------------------------------------------------------------------------
 * Why 72 hours, and the cost of getting it wrong
 *
 * This number cancels real orders if it is too small, and that is a worse
 * failure than the one it prevents. It has to be comfortably longer than the
 * shop's slowest honest call-back: an order placed on Thursday evening, with
 * nobody in on Friday, rung on Saturday morning. 72 hours clears that with a
 * day to spare.
 *
 * Only `new` is swept. The moment somebody at the shop presses Confirm the
 * order is a real one with a real person behind it, and no timer touches it
 * again however long the delivery takes.
 *
 * The customer is emailed, in the ordinary cancellation wording — which ends
 * "if this was a mistake, or you still want it, message us and we will sort it
 * out". A real customer who slipped through the window is not left guessing.
 *
 * Set ORDER_HOLD_HOURS to 0 to turn the sweep off entirely. That is the
 * rollback: it leaves the shop exactly as it was before this existed, which is
 * a shop whose stock can be held indefinitely by anyone.
 */
export const orderHoldHours = Math.max(0, Number(process.env.ORDER_HOLD_HOURS ?? 72) || 0);

/**
 * The shorter hold, for an order whose customer was actually warned.
 *
 * Once the WhatsApp confirmation is live, an order falls into one of three
 * cases and only the middle one is new:
 *
 *   replied      the number answered, so it is real. No timer at all - the
 *                order waits for a human like every order used to.
 *   delivered    Meta confirmed the message ARRIVED and nobody answered. The
 *                customer has been told, in writing, that it expires. Twelve
 *                hours.
 *   not delivered  the send failed, or nothing was sent because the WhatsApp
 *                half is not configured yet. Falls back to orderHoldHours
 *                above, because cancelling somebody who was never warned is
 *                exactly the unfairness the warning exists to prevent.
 *
 * That last case is also what makes this safe to deploy before the sending half
 * exists: with nothing sent, nothing is delivered, so every order takes the
 * long hold and the shop behaves precisely as it does today.
 *
 * Twelve rather than six, and the reason is overnight. Six hours cancels an
 * order placed at 2am before its customer has woken up; twelve carries it to a
 * civil hour of the same morning. It is only ever applied to somebody who was
 * handed a deadline and did not answer it.
 */
export const orderWarnedHoldHours =
  Math.max(0, Number(process.env.ORDER_WARNED_HOLD_HOURS ?? 12) || 0);

/**
 * The most distinct products one order may contain.
 *
 * A basket is not a catalogue. The quantity per line has always been capped at
 * twenty; the number of LINES was not capped at all, so a single request could
 * name every SKU in the shop and take twenty of each in one transaction — the
 * cheapest possible version of the attack described above, and one that fitted
 * comfortably inside the 128 KB body limit.
 *
 * Twenty lines is far more than any real order here (the busiest real basket in
 * the table is single digits) and it bounds the blast radius of one accepted
 * request to twenty products rather than all of them.
 */
export const maxOrderLines = 20;

export const mail = {
  key: process.env.RESEND_API_KEY || '',
  from: process.env.MAIL_FROM || 'orders@newstarseven.com',
  fromName: process.env.MAIL_FROM_NAME || 'New Star Seven',
  notifyTo: process.env.ORDER_NOTIFY_TO || process.env.MAIL_FROM || '',
};

/** Per-IP limits: [max hits, window in seconds]. */
export const limits = {
  subscribe: [5, 3600],
  order: [10, 3600],
  quiz: [60, 3600],

  /**
   * Orders per phone number per hour — a second bucket on the checkout, keyed
   * on something other than the network.
   *
   * Be clear about what this is and is not worth. It is NOT a defence against a
   * determined flood: an attacker who is already rotating networks will rotate
   * phone numbers in the same loop, and every order they place still has to
   * carry a plausible Egyptian mobile for normalizePhone() to accept it, which
   * costs them nothing. Anybody presenting this as the answer to stock draining
   * has misread it; the answer to that is orderHoldHours above.
   *
   * What it does buy, cheaply, is the naive version. The scripts that actually
   * show up on a small shop hammer one endpoint with one body and vary nothing,
   * and this stops those dead at six. It also catches the honest failure that
   * looks identical from the server: a customer on a flaky connection pressing
   * Confirm over and over. The idempotency key already deduplicates those into
   * one order, so this is the backstop for the case where the key is missing —
   * a tab opened before the deploy that introduced it.
   *
   * Six, and per hour, because a household genuinely does place two orders on
   * one number, and somebody ordering for their family might place three. Six
   * is past anything honest and far below anything useful to an attacker.
   */
  orderPhone: [6, 3600],

  /**
   * Discount codes, on their own bucket rather than sharing the quiz's.
   *
   * Codes are admin-chosen human words - WAX15, STAR10 - so the endpoint is a
   * dictionary target, and its replies distinguish "no such code" from "exists
   * but the minimum is N". At sixty guesses an hour that is a workable way to
   * discover live codes and their terms. Fifteen is still far more than any
   * real shopper types and makes grinding a word list pointless.
   */
  coupon: [15, 3600],
  login: [8, 900],

  /**
   * Asking for an order link again, at /order/find.
   *
   * Two limits, because they stop different things. The per-IP one is the
   * enumeration limit: the endpoint refuses to say whether a reference and an
   * email belong together, and ten guesses an hour from one network makes
   * grinding through the four random digits of a reference pointless anyway.
   *
   * The per-email one is the mailbox limit. Without it, anyone who knows a
   * customer address can have the shop send that address a message on demand,
   * for as long as they care to keep asking.
   *
   * The cost of the second is real and worth naming: burning somebody else
   * their hourly allowance stops that person recovering their own link for the
   * rest of the hour. Four is set where it is because a customer needs one and
   * asks twice when the first does not arrive, and an hour later they can ask
   * again — while the alternative is a stranger holding an open pipe into
   * someone else inbox.
   */
  orderFind: [10, 3600],
  orderFindEmail: [4, 3600],
  /*
   * The second factor gets its own allowance rather than sharing the login one.
   *
   * Sharing would mean a wrong password and a mistyped code drawing on the same
   * eight attempts, so an admin who fumbles the password twice has six goes at
   * a six-digit code that changes every thirty seconds. Six is not many when
   * the phone clock has drifted and the first two are stale.
   *
   * The window is longer and the count is not, which is the shape that matters
   * here: at ten attempts per fifteen minutes, working through a million codes
   * takes about three years, and every one of those codes has expired long
   * before it comes up. The screen also expires on its own after five minutes,
   * so the real ceiling is far lower than this.
   */
  login2fa: [10, 900],
};
