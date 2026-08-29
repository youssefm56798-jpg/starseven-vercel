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
  login: [8, 900],
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
