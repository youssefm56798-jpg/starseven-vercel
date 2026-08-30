/** Runtime configuration, all from environment variables (set in Vercel). */
export const site = {
  name: 'New Star Seven',
  url: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
  whatsapp: process.env.NEXT_PUBLIC_WHATSAPP || '201028282216',
  currency: 'EGP',
  shipping: Number(process.env.SHIPPING_FEE ?? 30),
  freeOver: Number(process.env.FREE_DELIVERY_OVER ?? 300),
};

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
