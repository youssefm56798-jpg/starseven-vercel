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
};
