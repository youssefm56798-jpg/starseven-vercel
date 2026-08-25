/**
 * GET /api/confirm?t=TOKEN
 * Completes double opt-in, sends the welcome + coupon email, then shows a
 * branded landing page — this one is visited by a human, so it renders HTML
 * rather than the JSON every other route returns.
 */

import { sql } from '../../../lib/db.js';
import { sendMail, tplWelcome } from '../../../lib/mail.js';
import { brandPage } from '../_lib/shared.js';

export const dynamic = 'force-dynamic';

const COPY = {
  ar: {
    done: ['تم تأكيد اشتراكك ★', 'كود الخصم في إيميلك دلوقتي. أول ما ينزل عرض، هيوصلك قبل الناس.'],
    already: ['إنت مشترك بالفعل ★', 'مفيش حاجة محتاجة تعملها — إحنا معاك في القايمة.'],
    bad: ['اللينك مش صالح', 'يمكن يكون انتهى أو اتستخدم قبل كده. جرّب تشترك تاني من الموقع.'],
  },
  en: {
    done: ['Subscription confirmed ★', 'Your discount code is in your inbox. Every sale reaches you before it goes public.'],
    already: ['Already subscribed ★', 'Nothing to do — you are on the list.'],
    bad: ['This link is not valid', 'It may have expired or already been used. Subscribe again from the site.'],
  },
};

export async function GET(req) {
  const token = (new URL(req.url).searchParams.get('t') || '').trim();

  let state = 'bad';
  let lang = 'ar';
  let status = 404;

  // token40() is 20 random bytes as hex. Anything else never touches the query.
  if (/^[a-f0-9]{40}$/.test(token)) {
    try {
      const rows = await sql`
        SELECT id, email, lang, status, token FROM subscribers WHERE token = ${token} LIMIT 1`;
      const sub = rows[0];

      if (sub) {
        lang = sub.lang === 'en' ? 'en' : 'ar';
        status = 200;

        if (sub.status === 'active') {
          state = 'already';
        } else {
          await sql`
            UPDATE subscribers SET status = 'active', confirmed_at = now() WHERE id = ${sub.id}`;
          state = 'done';

          // The oldest live offer that actually carries a code — that is the
          // standing welcome coupon rather than whatever sale is running today.
          const offers = await sql`
            SELECT code FROM offers
             WHERE active = true AND code <> ''
               AND (starts_at IS NULL OR starts_at <= now())
               AND (ends_at   IS NULL OR ends_at   >= now())
             ORDER BY id ASC
             LIMIT 1`;

          const [subject, html] = tplWelcome(offers[0]?.code || 'STAR10', lang, sub.token);
          await sendMail({ to: sub.email, subject, html, kind: 'welcome' });
        }
      }
    } catch (e) {
      // The subscription may or may not have been confirmed. Say so honestly
      // with a 500 rather than claiming the link was bad.
      console.error('[s7] confirm failed:', e?.message || e);
      state = 'bad';
      status = 500;
    }
  }

  const [title, body] = COPY[lang][state];
  return brandPage({ lang, title, body, status, accent: state !== 'bad' });
}
