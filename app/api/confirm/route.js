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
    gone: ['إنت ألغيت اشتراكك قبل كده', 'سبناك بره القايمة زي ما طلبت. لو غيرت رأيك، تقدر تشترك تاني من الموقع.'],
    bad: ['اللينك مش صالح', 'يمكن يكون انتهى أو اتستخدم قبل كده. جرّب تشترك تاني من الموقع.'],
  },
  en: {
    done: ['Subscription confirmed ★', 'Your discount code is in your inbox. Every sale reaches you before it goes public.'],
    already: ['Already subscribed ★', 'Nothing to do — you are on the list.'],
    gone: ['You unsubscribed from this list', 'We have left you off it, as you asked. If you have changed your mind you can subscribe again from the site.'],
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
      /*
       * The confirm is a guarded UPDATE, not a read followed by a write, and
       * both halves of that matter.
       *
       * WHICH statuses it matches is a consent question. This used to activate
       * anything that was not already active, and `unsubscribed` is not
       * already active — so the opt-in email stayed a working re-subscribe
       * button forever. Someone who had left the list was put back on it and
       * sent a welcome, and because the confirm and unsubscribe links carry the
       * SAME token, the message they used to leave was also the message that
       * undid it. No click was even needed: a mailbox that prefetches links
       * does it on their behalf. app/api/order/route.js already states the rule
       * this route was missing — someone who opted out stays opted out.
       *
       * `bounced` is allowed through with `pending`. That status means mail to
       * the address failed; a person standing here clicking the link in it is
       * evidence to the contrary, and holding them out on the strength of a
       * delivery failure they have just disproved would be the wrong way round.
       *
       * That it is ONE statement is a duplicate-send question. The old shape
       * read the row, decided in JavaScript and then wrote, so two hits landing
       * together — the prefetch and the human a second later — both saw
       * `pending`, both updated, and both sent a welcome mail with a discount
       * code. Here only the first request matches; the second gets no row and
       * falls through to the branch below.
       */
      const claimed = await sql`
        UPDATE subscribers
           SET status = 'active', confirmed_at = COALESCE(confirmed_at, now())
         WHERE token = ${token} AND status IN ('pending', 'bounced')
        RETURNING id, email, lang, token`;

      const sub = claimed[0];

      if (sub) {
        lang = sub.lang === 'en' ? 'en' : 'ar';
        status = 200;
        {
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
          await sendMail({ to: sub.email, subject, html, kind: 'welcome', unsubToken: sub.token });
        }
      } else {
        /*
         * Nothing was claimed, and there are three reasons for that. Only now
         * is the row read, on the miss path, purely to choose the wording —
         * the UPDATE above is what decided anything, so nothing here can
         * change a subscription. Same split as lib/order-status.js: the
         * guarded write is the authority, the read afterwards is for the
         * message.
         */
        const rows = await sql`
          SELECT lang, status FROM subscribers WHERE token = ${token} LIMIT 1`;
        const row = rows[0];

        if (row) {
          lang = row.lang === 'en' ? 'en' : 'ar';
          status = 200;
          // Already active covers the second of two simultaneous clicks as
          // well as a link opened twice a week apart; both are "you are on the
          // list", which is true and needs no action from them.
          state = row.status === 'unsubscribed' ? 'gone' : 'already';
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
